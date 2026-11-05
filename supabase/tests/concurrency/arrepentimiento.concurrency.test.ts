// Concurrencia REAL de las comunicaciones del arrepentimiento (Fase 4B.7), contra Supabase local.
// Cada sesión es un proceso psql distinto (rol service_role, como el servidor y el ejecutor); todas esperan
// detrás de una barrera (advisory lock) y se liberan a la vez.
//
//   npm run db:start && npm run test:concurrency
//
// Crea datos marcados (referencias CONC-<run>, emails @conc-<run>.test, ejecutores conc-<run>-*) y los borra al terminar.

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomBytes, randomInt, randomUUID } from 'node:crypto';

const CONTAINER = 'supabase_db_steffen-web';
const RUN = randomBytes(4).toString('hex');
const DOMAIN = `conc-${RUN}.test`;
const START = new Date().toISOString();
let ipCounter = 0;
const nextIp = () => {
  ipCounter++;
  return `10.77.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
};

type PsqlResult = { code: number; out: string; err: string };

function psql(sql: string): Promise<PsqlResult> {
  return new Promise((resolve, reject) => {
    const child = spawn('docker', ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'], { stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, out: out.trim(), err }));
    child.stdin.end(sql);
  });
}

async function sql(query: string): Promise<string> {
  const r = await psql(query);
  if (r.code !== 0) throw new Error(`SQL falló (${r.code}): ${r.err}\n${query}`);
  return r.out;
}

function results(r: PsqlResult): any[] {
  return r.out.split(/\r?\n/).filter((l) => l.startsWith('RESULT:')).map((l) => JSON.parse(l.slice('RESULT:'.length)));
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

async function simultaneas(sessions: string[]): Promise<PsqlResult[]> {
  const key = randomInt(1, 2 ** 31 - 1);
  const n = sessions.length;
  const controller = psql(`
    select pg_advisory_lock(${key});
    do $$ begin
      for i in 1..3000 loop
        exit when (select count(*) from pg_locks where locktype = 'advisory' and objid = ${key} and not granted) >= ${n};
        perform pg_sleep(0.01);
      end loop;
    end $$;
    select pg_advisory_unlock(${key});
  `);
  for (let i = 0; ; i++) {
    const held = await sql(`select count(*) from pg_locks where locktype = 'advisory' and objid = ${key} and granted and mode = 'ExclusiveLock'`);
    if (held === '1') break;
    if (i > 500) throw new Error('El controlador no tomó el lock de la barrera');
    await new Promise((r) => setTimeout(r, 20));
  }
  const out = await Promise.all(sessions.map((s) => psql(`select pg_advisory_lock_shared(${key}); select pg_advisory_unlock_shared(${key});\nset role service_role;\n${s}`)));
  const c = await controller;
  assert.equal(c.code, 0, `controlador: ${c.err}`);
  for (const r of out) assert.equal(r.code, 0, `sesión: ${r.err}`);
  return out;
}

async function register(label: string, email = `persona-${label}@${DOMAIN}`) {
  const out = await sql(`select public.registrar_arrepentimiento(${lit(`CONC-${RUN}-${label}`)}, ${lit(email)}, ${lit(randomUUID())}, ${lit(nextIp())})->>'code'`);
  return out;
}

after(async () => {
  await sql(`
    delete from public.revocation_messages where recipient like ${lit(`%@${DOMAIN}`)};
    delete from public.revocation_requests where purchase_reference like ${lit(`CONC-${RUN}-%`)};
    delete from private.revocation_rate_events where created_at >= ${lit(START)};
    delete from private.mail_workers where worker like ${lit(`conc-${RUN}-%`)};
  `);
});

test('10 envíos simultáneos con la misma clave: una solicitud, un código y UNA comunicación', async () => {
  const key = randomUUID();
  const ip = nextIp();
  const sessions = Array.from({ length: 10 }, () => `select 'RESULT:' || to_json(public.registrar_arrepentimiento(${lit(`CONC-${RUN}-idem`)}, ${lit(`idem@${DOMAIN}`)}, ${lit(key)}, ${lit(ip)})->>'code');`);
  const codes = (await simultaneas(sessions)).map((r) => results(r)[0]);
  assert.equal(new Set(codes).size, 1, 'mismo código para todos');
  assert.match(codes[0], /^ARR-[A-F0-9]{32}$/);
  assert.equal(await sql(`select count(*) from public.revocation_requests where purchase_reference = ${lit(`CONC-${RUN}-idem`)}`), '1');
  assert.equal(await sql(`select count(*) from public.revocation_messages m join public.revocation_requests r on r.id = m.request_id where r.purchase_reference = ${lit(`CONC-${RUN}-idem`)}`), '1');
});

test('8 ejecutores simultáneos sobre 20 comunicaciones: cada una se reclama exactamente una vez', async () => {
  for (let i = 0; i < 20; i++) await register(`lote-${i}`);
  const ours = new Set((await sql(`select m.id from public.revocation_messages m join public.revocation_requests r on r.id = m.request_id where r.purchase_reference like ${lit(`CONC-${RUN}-lote-%`)}`)).split(/\r?\n/));
  assert.equal(ours.size, 20);
  const sessions = Array.from({ length: 8 }, (_, i) => `select 'RESULT:' || to_json(id) from public.comunicaciones_reclamar(${lit(`conc-${RUN}-w${i}`)}, 5, 120);`);
  const claimed = (await simultaneas(sessions)).flatMap((r) => results(r)).filter((id) => ours.has(id));
  assert.equal(claimed.length, 20, 'todas reclamadas');
  assert.equal(new Set(claimed).size, 20, 'ninguna reclamada dos veces');
  assert.equal(await sql(`select count(*) from public.revocation_message_attempts where message_id in (${[...ours].map(lit).join(',')})`), '20', 'un intento por comunicación');
});

test('resultado del ejecutor caído compitiendo con la recuperación: nunca se aplican los dos', async () => {
  for (let round = 0; round < 5; round++) {
    await register(`carrera-${round}`);
    const row = await sql(`set role service_role; select id || '|' || lease_id from public.comunicaciones_reclamar(${lit(`conc-${RUN}-viejo`)}, 50, 30) c
                           where c.recipient = ${lit(`persona-carrera-${round}@${DOMAIN}`)};`);
    const [id, lease] = row.split('|');
    assert.ok(id && lease, 'reclamada');
    await sql(`update public.revocation_messages set locked_until = clock_timestamp() - interval '1 second' where id = ${lit(id)}`);
    const [late, rescue] = await simultaneas([
      `select 'RESULT:' || to_json(public.comunicaciones_resultado(${lit(id)}, ${lit(lease)}, 'aceptado'));`,
      `select 'RESULT:' || to_json(c.id) from public.comunicaciones_reclamar(${lit(`conc-${RUN}-nuevo`)}, 50, 120) c;`,
    ]);
    const lateResult = results(late)[0];
    const rescued = results(rescue).includes(id);
    assert.ok((lateResult === 'aceptado' && !rescued) || (lateResult === 'sin_cambios' && rescued), `ronda ${round}: ${lateResult} / ${rescued}`);
    const status = await sql(`select status from public.revocation_messages where id = ${lit(id)}`);
    assert.equal(status, rescued ? 'enviando' : 'aceptado');
  }
});

test('6 pedidos de recuperación simultáneos para el mismo email: un solo email encolado', async () => {
  const email = `recupera@${DOMAIN}`;
  await register('recupera', email);
  const sessions = Array.from({ length: 6 }, () => `select 'RESULT:' || public.solicitar_recuperacion_arrepentimiento(${lit(email)}, ${lit(nextIp())})::text;`);
  const responses = (await simultaneas(sessions)).map((r) => JSON.stringify(results(r)[0]));
  assert.equal(new Set(responses).size, 1, 'todas las respuestas son idénticas');
  assert.equal(await sql(`select count(*) from public.revocation_messages where kind = 'recuperacion' and recipient = ${lit(email)}`), '1');
});

test('10 canjes simultáneos del mismo enlace: exactamente uno ve la constancia', async () => {
  const email = `canje@${DOMAIN}`;
  const code = await register('canje', email);
  await sql(`select public.solicitar_recuperacion_arrepentimiento(${lit(email)}, ${lit(nextIp())})`);
  const row = await sql(`set role service_role; select id || '|' || lease_id || '|' || (payload->>'token') from public.comunicaciones_reclamar(${lit(`conc-${RUN}-canje`)}, 50, 120) c where c.recipient = ${lit(email)} and c.kind = 'recuperacion';`);
  const [id, lease, token] = row.split('|');
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);
  await sql(`set role service_role; select public.comunicaciones_resultado(${lit(id)}, ${lit(lease)}, 'aceptado');`);
  const sessions = Array.from({ length: 10 }, () => `select 'RESULT:' || public.canjear_constancia_arrepentimiento(${lit(token)}, ${lit(nextIp())})::text;`);
  const answers = (await simultaneas(sessions)).map((r) => results(r)[0]);
  const winners = answers.filter((a) => Array.isArray(a.items));
  assert.equal(winners.length, 1, 'un solo canje exitoso');
  assert.equal(winners[0].items[0].code, code, 'muestra el código original');
  assert.equal(answers.filter((a) => a.invalid).length, 9);
});
