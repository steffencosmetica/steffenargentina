// Pruebas de concurrencia REAL de pedidos y reservas (Fase 4B.3), contra Supabase local.
// Cada sesión es una conexión distinta a PostgreSQL (un proceso psql propio, o una llamada HTTP a la
// API con la clave secreta local). Para que compitan de verdad, todas esperan detrás de una barrera:
// un advisory lock exclusivo que el controlador suelta recién cuando las N sesiones están bloqueadas.
//
//   npm run db:start && npm run test:concurrency
//
// Solo corre contra el contenedor local (docker exec supabase_db_<project_id>); crea sus propios
// datos con ids cc000000-… y los borra al terminar. Deja checkout_enabled y los límites como estaban.

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { randomBytes, randomInt } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const CONTAINER = 'supabase_db_steffen-web';
const API_URL = 'http://127.0.0.1:55321';

// ---------------------------------------------------------------------------
// Sesiones psql
// ---------------------------------------------------------------------------

type PsqlResult = { code: number; out: string; err: string };

function psql(sql: string): Promise<PsqlResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(
      'docker',
      ['exec', '-i', CONTAINER, 'psql', '-U', 'postgres', '-d', 'postgres', '-At', '-q', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=verbose'],
      { stdio: ['pipe', 'pipe', 'pipe'] },
    );
    let out = '';
    let err = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (err += d));
    child.on('error', reject);
    child.on('close', (code) => resolve({ code: code ?? 1, out: out.trim(), err }));
    child.stdin.end(sql);
  });
}

/** Ejecuta SQL como postgres y devuelve la salida; falla si hay error. */
async function sql(query: string): Promise<string> {
  const r = await psql(query);
  if (r.code !== 0) throw new Error(`SQL falló (${r.code}): ${r.err}\n${query}`);
  return r.out;
}

/** Valor de la línea "RESULT:<json>" que imprime cada sesión. */
function result(r: PsqlResult): any {
  const line = r.out.split(/\r?\n/).find((l) => l.startsWith('RESULT:'));
  return line === undefined ? undefined : JSON.parse(line.slice('RESULT:'.length));
}

/** SQLSTATE del error de una sesión (VERBOSITY=verbose → "ERROR:  40P01: deadlock detected"). */
function sqlstate(r: PsqlResult): string | undefined {
  return /ERROR:\s+([0-9A-Z]{5}):/.exec(r.err)?.[1];
}

const lit = (s: string) => `'${s.replace(/'/g, "''")}'`;

test('Fase 5C: webhook y polling simultáneos, concesión vencida y una sola acreditación', async () => {
  const ip = nextIp();
  const order = result(await psql(crearSql(newKey('conciliacion'), `conciliacion-${RUN}@test.com`, ip, [{ product: 'pago', quantity: 1 }])));
  const claim = JSON.parse(await sql(`select public.iniciar_intento_pago(${lit(order.code)},${lit(order.token)},${lit(ip)})::text`));
  const remote = await sql(`select public.simular_order_pago(${lit(claim.key)},${lit(claim.lease)},${lit(order.code)},${lit(claim.total)})`);
  const req = `conc-${RUN}`;
  const notification = String(BigInt('0x' + RUN) + BigInt(900_000_000_000));
  const receive = `select 'RESULT:' || to_json(public.recibir_notificacion_pago(${lit(req)},${lit(notification)},${lit(remote)},'order.processed'))::text;`;
  const take = "select 'RESULT:' || public.tomar_trabajos_pago()::text;";
  const stockAfterCheckout = await stock('pago');
  try {
    await sql(`update private.payment_attempts set lease_until = clock_timestamp() - interval '1 second' where id = ${lit(claim.id)};
      update private.mock_checkout_orders set status='processed',status_detail='accredited',paid_amount=total_ars,
        payment_id='PAYMOCK' || replace(gen_random_uuid()::text,'-',''),revision=2 where id=${lit(remote)};`);
    const received = await simultaneas([receive, receive]);
    assert.deepEqual(received.map(result), [true, true]);
    assert.equal(await sql(`select count(*) from private.payment_jobs where request_id=${lit(req)}`), '1');
    const jobs = (await simultaneas([take, take])).map(result);
    assert.ok(jobs.every(Boolean));
    assert.notEqual(jobs[0].id, jobs[1].id);
    const hook = jobs.find(job => job.provider === remote);
    const poll = jobs.find(job => job.reference === order.code);
    assert.ok(hook && poll);
    await sql(`update private.payment_jobs set lease_until=clock_timestamp()-interval '1 second' where id=${lit(hook.id)}`);
    const recovered = result(await psql(take));
    assert.equal(recovered.id, hook.id);
    assert.notEqual(recovered.lease, hook.lease);
    const finish = (job: { id: string; lease: string }) =>
      `select 'RESULT:' || to_json(public.resolver_trabajo_pago(${lit(job.id)},${lit(job.lease)},
        (public.buscar_order_pago_simulada(${lit(remote)},null,null,null)->0),'accredited',null,false))::text;`;
    assert.equal(result(await psql(finish(hook))), 'stale');
    await sql(`alter table public.orders disable trigger orders_validar_cambios;
      update public.orders set reservation_expires_at=now()-interval '1 second' where id=${lit(order.order_id)};
      alter table public.orders enable trigger orders_validar_cambios;`);
    const [webhook, polling, expiry] = await simultaneas([finish(recovered), finish(poll),
      "select 'RESULT:' || to_json(public.liberar_reservas_vencidas(100))::text;"]);
    assert.equal(expiry.code, 0, expiry.err);
    const results = [result(webhook), result(polling)].sort();
    assert.equal(results[0], 'already_applied');
    assert.ok(['approved', 'approved_late'].includes(results[1]));
    assert.equal(await sql(`select count(*) from public.order_events where order_id=${lit(order.order_id)} and event_type in ('payment_approved','payment_approved_late')`), '1');
    assert.equal(await stock('pago'), stockAfterCheckout);
  } finally {
    await sql(`delete from private.payment_jobs where request_id=${lit(req)};
      delete from public.orders where id=${lit(order.order_id)};
      delete from private.payment_request_limits where ip_hash=private.hash_ip(${lit(ip)});`);
  }
});

test('Fase 5B: dos conexiones compiten por el pago y se recupera el mismo intento tras dos interrupciones', async () => {
  const ip = nextIp();
  const order = result(await psql(crearSql(newKey('checkout-pro'), `checkout-pro-${RUN}@test.com`, ip, [{ product: 'pago', quantity: 1 }])));
  assert.equal(order.status, 'created');
  const claimSql = `select 'RESULT:' || public.iniciar_intento_pago(${lit(order.code)}, ${lit(order.token)}, ${lit(ip)})::text;`;
  const expireLease = `update private.payment_attempts set lease_until = clock_timestamp() - interval '1 second' where order_id = ${lit(order.order_id)};`;
  const stockAfterCheckout = await stock('pago');
  try {
    const claims = (await simultaneas([claimSql, claimSql])).map(result);
    assert.deepEqual(claims.map((claim) => claim.status).sort(), ['busy', 'creating']);
    const first = claims.find((claim) => claim.status === 'creating');

    // Se cortó antes de llamar al proveedor.
    await sql(expireLease);
    const retry = result(await psql(claimSql));
    assert.equal(retry.key, first.key);
    assert.notEqual(retry.lease, first.lease);
    const staleCreate = `select public.simular_order_pago(${lit(first.key)}, ${lit(first.lease)}, ${lit(order.code)}, ${lit(retry.total)});`;
    assert.equal(await sql(staleCreate), '', 'la petición anterior no puede crear una order tras ceder la concesión');
    const create = `select public.simular_order_pago(${lit(retry.key)}, ${lit(retry.lease)}, ${lit(order.code)}, ${lit(retry.total)});`;
    const providerId = await sql(create);
    assert.match(providerId, /^ORDMOCK/);
    assert.equal(await sql(create), providerId);

    // La order remota hizo commit, pero el proceso no pudo guardar su respuesta.
    await sql(expireLease);
    const recovery = result(await psql(claimSql));
    assert.equal(recovery.key, first.key);
    const found = JSON.parse(await sql(`select public.buscar_order_pago_simulada(null, ${lit(order.code)},
      clock_timestamp() - interval '1 minute', clock_timestamp())::text;`));
    assert.deepEqual(found.map(({ id }: { id: string }) => id), [providerId]);
    const finish = (lease: string) => `select public.finalizar_intento_pago(${lit(first.id)}, ${lit(lease)}, ${lit(providerId)}, null);`;
    assert.equal(await sql(finish(retry.lease)), 'f');
    assert.equal(await sql(finish(recovery.lease)), 't');
    assert.equal(result(await psql(claimSql)).provider_order_id, providerId);
    assert.equal(await stock('pago'), stockAfterCheckout);
  } finally {
    await sql(`delete from private.payment_request_limits where ip_hash = private.hash_ip(${lit(ip)});`);
  }
});

/**
 * Lanza las sesiones y las libera a la vez. Devuelve el resultado de cada una.
 * El controlador toma el lock exclusivo, espera a que las N sesiones estén encoladas (pg_locks) y lo suelta.
 */
async function simultaneas(sessions: string[]): Promise<PsqlResult[]> {
  const key = randomInt(1, 2 ** 31 - 1);
  const n = sessions.length;
  const controller = psql(`
    select pg_advisory_lock(${key});
    select 'RESULT:"locked"';
    do $$ begin
      for i in 1..3000 loop
        exit when (select count(*) from pg_locks where locktype = 'advisory' and objid = ${key} and not granted) >= ${n};
        perform pg_sleep(0.01);
      end loop;
    end $$;
    select pg_advisory_unlock(${key});
  `);
  // esperar a que el controlador tenga el lock antes de lanzar las sesiones
  for (let i = 0; ; i++) {
    const held = await sql(`select count(*) from pg_locks where locktype = 'advisory' and objid = ${key} and granted and mode = 'ExclusiveLock'`);
    if (held === '1') break;
    if (i > 500) throw new Error('El controlador no tomó el lock de la barrera');
    await new Promise((r) => setTimeout(r, 20));
  }
  const results = await Promise.all(
    sessions.map((s) => psql(`select pg_advisory_lock_shared(${key}); select pg_advisory_unlock_shared(${key});\n${s}`)),
  );
  const c = await controller;
  assert.equal(c.code, 0, `controlador: ${c.err}`);
  return results;
}

// ---------------------------------------------------------------------------
// Datos de prueba
// ---------------------------------------------------------------------------

const ADMIN_ID = 'cc000000-0000-0000-0000-0000000000a1';
const CATEGORY_ID = 'cc000000-0000-0000-0000-000000000c01';
const ZONE_ID = 'cc000000-0000-0000-0000-000000000e01';
const P = {
  unica: 'cc000000-0000-0000-0000-000000000001', // 1 unidad
  m1: 'cc000000-0000-0000-0000-000000000011',
  m2: 'cc000000-0000-0000-0000-000000000012',
  m3: 'cc000000-0000-0000-0000-000000000013',
  idem: 'cc000000-0000-0000-0000-000000000021',
  venc: 'cc000000-0000-0000-0000-000000000031',
  pago: 'cc000000-0000-0000-0000-000000000041',
} as const;
const PRICE: Record<string, number> = { unica: 1000, m1: 100, m2: 200, m3: 300, idem: 500, venc: 100, pago: 100 };
const STOCK: Record<string, number> = { unica: 1, m1: 10000, m2: 10000, m3: 10000, idem: 100, venc: 1000, pago: 1000 };
const SHIPPING = 1000;
const RUN = randomBytes(4).toString('hex');
let province = '';
let savedSettings = '';
let ipCounter = 0;

const nextIp = () => {
  ipCounter++;
  return `10.${(ipCounter >> 16) & 255}.${(ipCounter >> 8) & 255}.${ipCounter & 255}`;
};
const newKey = (label: string) => `conc-${RUN}-${label}-${randomBytes(12).toString('hex')}`;

type Item = { product: keyof typeof P; quantity: number };

function totalOf(items: Item[]) {
  return items.reduce((sum, i) => sum + PRICE[i.product] * i.quantity, 0) + SHIPPING;
}

function crearArgs(key: string, email: string, ip: string, items: Item[], total = totalOf(items)) {
  const buyer = { name: 'Comprador Concurrente', email, phone: '+54 11 5555-0000' };
  const shipping = { street: 'Calle de Prueba', number: '123', city: 'Ciudad', postal_code: '1000', province_code: province };
  const itemsJson = items.map((i) => ({ product_id: P[i.product], quantity: i.quantity }));
  return { buyer, shipping, itemsJson, total, key, ip };
}

/** Sesión que crea un pedido como service_role (el rol del servidor de Next). */
function crearSql(key: string, email: string, ip: string, items: Item[], total?: number) {
  const a = crearArgs(key, email, ip, items, total);
  return `set role service_role;
select 'RESULT:' || public.crear_pedido(${lit(a.key)}, ${lit(JSON.stringify(a.buyer))}::jsonb, ${lit(JSON.stringify(a.shipping))}::jsonb,
  ${lit(JSON.stringify(a.itemsJson))}::jsonb, ${a.total}, ${lit(a.ip)}::inet)::text;`;
}

async function stock(product: keyof typeof P): Promise<number> {
  return Number(await sql(`select stock from public.products where id = '${P[product]}'`));
}

/**
 * Crea pedidos (secuencialmente) y recién después adelanta el vencimiento de todos juntos (si se vencieran
 * de a uno, cada pedido nuevo liberaría los anteriores por la vía oportunista). Devuelve los ids.
 */
async function pedidosVencidos(n: number, items: Item[] | Item[][]): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const these = Array.isArray(items[0]) ? (items as Item[][])[i] : (items as Item[]);
    const r = result(await psql(crearSql(newKey('venc'), `venc-${RUN}-${ipCounter}@test.com`, nextIp(), these)));
    assert.equal(r.status, 'created', JSON.stringify(r));
    ids.push(r.order_id);
  }
  await sql(`
    begin;
    alter table public.orders disable trigger orders_validar_cambios;
    update public.orders set reservation_expires_at = now() - interval '1 minute' where id = any (array[${ids.map(lit).join(',')}]::uuid[]);
    alter table public.orders enable trigger orders_validar_cambios;
    commit;`);
  return ids;
}

async function limpiar() {
  await sql(`
    begin;
    delete from public.orders where id in (select order_id from public.order_items where product_id::text like 'cc000000-%');
    delete from public.checkout_attempts where order_id is null and created_at > now() - interval '2 hours'
      and ip_hash in (select private.hash_ip(('10.' || a || '.' || b || '.' || c)::inet)
                        from generate_series(0, 0) a, generate_series(0, 3) b, generate_series(0, 255) c);
    delete from public.products where id::text like 'cc000000-%';
    delete from public.categories where id = '${CATEGORY_ID}';
    delete from public.shipping_zone_provinces where zone_id = '${ZONE_ID}';
    delete from public.shipping_zones where id = '${ZONE_ID}';
    delete from public.admin_users where user_id = '${ADMIN_ID}';
    delete from auth.users where id = '${ADMIN_ID}';
    commit;`);
}

before(async () => {
  // el contenedor tiene que ser el local de este proyecto
  const name = execFileSync('docker', ['ps', '--filter', `name=^${CONTAINER}$`, '--format', '{{.Names}}'], { encoding: 'utf8' }).trim();
  if (name !== CONTAINER) throw new Error(`Supabase local no está levantado (${CONTAINER}). Ejecutá npm run db:start.`);

  await limpiar();
  savedSettings = await sql(`select row_to_json(s)::text from public.store_settings s`);
  province = await sql(`select code from public.provinces where code not in (select province_code from public.shipping_zone_provinces) order by code limit 1`);
  assert.ok(province, 'se necesita una provincia sin zona para la prueba');

  const products = (Object.keys(P) as (keyof typeof P)[])
    .map((k) => `('${P[k]}', 'CONC-${k}', 'Concurrencia ${k}', 'conc-${k}', '${CATEGORY_ID}', ${PRICE[k]}, ${STOCK[k]})`)
    .join(',\n');
  await sql(`
    begin;
    insert into auth.users (id, instance_id, aud, role, email)
    values ('${ADMIN_ID}', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'conc-admin@test.local');
    insert into public.admin_users (user_id) values ('${ADMIN_ID}');
    insert into public.categories (id, name, slug) values ('${CATEGORY_ID}', 'Concurrencia', 'concurrencia-test');
    insert into public.products (id, sku, name, slug, category_id, price_ars, stock) values ${products};
    insert into public.shipping_zones (id, name, price_ars) values ('${ZONE_ID}', 'Concurrencia (test)', ${SHIPPING});
    insert into public.shipping_zone_provinces (province_code, zone_id) values ('${province}', '${ZONE_ID}');
    update public.store_settings set checkout_enabled = true, max_units_per_product = 100, max_units_per_order = 500,
      max_pending_orders_per_email = 20, max_orders_per_ip_hour = 1000, max_attempts_per_ip_hour = 10000;
    commit;`);
});

after(async () => {
  try {
    await limpiar();
  } finally {
    const s = JSON.parse(savedSettings || '{}');
    if (savedSettings) {
      await sql(`update public.store_settings set checkout_enabled = ${s.checkout_enabled}, reservation_minutes = ${s.reservation_minutes},
        max_units_per_product = ${s.max_units_per_product}, max_units_per_order = ${s.max_units_per_order},
        max_pending_orders_per_email = ${s.max_pending_orders_per_email}, max_orders_per_ip_hour = ${s.max_orders_per_ip_hour},
        max_attempts_per_ip_hour = ${s.max_attempts_per_ip_hour}`);
    }
  }
});

// ---------------------------------------------------------------------------
// Escenarios
// ---------------------------------------------------------------------------

test('20 compradores simultáneos por la última unidad: exactamente uno la obtiene', async () => {
  const results = await simultaneas(
    Array.from({ length: 20 }, (_, i) => crearSql(newKey(`ultima${i}`), `ultima${i}-${RUN}@test.com`, nextIp(), [{ product: 'unica', quantity: 1 }])),
  );
  for (const r of results) assert.equal(r.code, 0, r.err);
  const outcomes = results.map((r) => result(r));
  const created = outcomes.filter((o) => o.status === 'created');
  const rejected = outcomes.filter((o) => o.status === 'rejected');
  assert.equal(created.length, 1, 'un solo pedido creado');
  assert.equal(rejected.length, 19, '19 rechazados');
  assert.ok(rejected.every((o) => o.error === 'insufficient_stock'), 'todos por stock insuficiente');
  assert.equal(await stock('unica'), 0, 'el stock quedó en 0, nunca negativo');
  assert.equal(await sql(`select count(*) from public.order_items where product_id = '${P.unica}'`), '1');
});

test('10 solicitudes simultáneas con la misma clave de idempotencia (psql): un pedido, mismo token', async () => {
  const key = newKey('idem-psql');
  const ip = nextIp();
  const results = await simultaneas(
    Array.from({ length: 10 }, () => crearSql(key, `idem-psql-${RUN}@test.com`, ip, [{ product: 'idem', quantity: 2 }])),
  );
  for (const r of results) assert.equal(r.code, 0, r.err);
  const outcomes = results.map((r) => result(r));
  assert.equal(outcomes.filter((o) => o.status === 'created').length, 1);
  assert.equal(outcomes.filter((o) => o.status === 'replayed').length, 9);
  assert.equal(new Set(outcomes.map((o) => o.code)).size, 1, 'mismo código');
  assert.equal(new Set(outcomes.map((o) => o.token)).size, 1, 'mismo token');
  assert.equal(await stock('idem'), STOCK.idem - 2, 'stock descontado una sola vez');
});

test('10 solicitudes simultáneas con la misma clave por la API (service_role, como el servidor de Next)', async () => {
  const status = JSON.parse(
    execFileSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
      .replace(/^[^{]*/, ''),
  );
  assert.equal(status.API_URL, API_URL, 'solo contra la API local');
  const supabase = createClient(API_URL, status.SECRET_KEY, { auth: { persistSession: false } });

  const before = await stock('idem');
  const a = crearArgs(newKey('idem-api'), `idem-api-${RUN}@test.com`, nextIp(), [{ product: 'idem', quantity: 3 }]);
  const call = () =>
    supabase.rpc('crear_pedido', {
      p_idempotency_key: a.key,
      p_buyer: a.buyer,
      p_shipping: a.shipping,
      p_items: a.itemsJson,
      p_expected_total_ars: a.total,
      p_client_ip: a.ip,
    });
  const responses = await Promise.all(Array.from({ length: 10 }, call));
  for (const r of responses) assert.equal(r.error, null, JSON.stringify(r.error));
  const outcomes = responses.map((r) => r.data as any);
  assert.equal(outcomes.filter((o) => o.status === 'created').length, 1);
  assert.equal(outcomes.filter((o) => o.status === 'replayed').length, 9);
  assert.equal(new Set(outcomes.map((o) => o.token)).size, 1);
  assert.equal(await stock('idem'), before - 3);

  // la misma clave con otro contenido se rechaza
  const conflict = await supabase.rpc('crear_pedido', {
    p_idempotency_key: a.key,
    p_buyer: a.buyer,
    p_shipping: a.shipping,
    p_items: [{ product_id: P.idem, quantity: 1 }],
    p_expected_total_ars: PRICE.idem + SHIPPING,
    p_client_ip: a.ip,
  });
  assert.equal((conflict.data as any).error, 'idempotency_conflict');

  // la clave publicable (navegador) no puede crear pedidos
  const anon = createClient(API_URL, status.PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const denied = await anon.rpc('crear_pedido', {
    p_idempotency_key: newKey('anon'),
    p_buyer: a.buyer,
    p_shipping: a.shipping,
    p_items: a.itemsJson,
    p_expected_total_ars: a.total,
    p_client_ip: '1.2.3.4',
  });
  assert.ok(denied.error, 'anon recibe un error');
  assert.equal(denied.error.code, '42501');
  const listed = await anon.from('orders').select('id');
  assert.ok(listed.error, 'anon no lista pedidos por la API');
});

test('pedidos simultáneos con varios productos en distinto orden: sin deadlocks y stock exacto', async () => {
  const combos: Item[][] = [
    [{ product: 'm1', quantity: 1 }, { product: 'm2', quantity: 2 }, { product: 'm3', quantity: 3 }],
    [{ product: 'm3', quantity: 1 }, { product: 'm2', quantity: 1 }, { product: 'm1', quantity: 1 }],
    [{ product: 'm2', quantity: 2 }, { product: 'm1', quantity: 2 }],
    [{ product: 'm3', quantity: 2 }, { product: 'm1', quantity: 1 }],
  ];
  const before = { m1: await stock('m1'), m2: await stock('m2'), m3: await stock('m3') };
  const orders = Array.from({ length: 40 }, (_, i) => combos[i % combos.length]);
  const results = await simultaneas(orders.map((items, i) => crearSql(newKey(`multi${i}`), `multi${i}-${RUN}@test.com`, nextIp(), items)));

  for (const r of results) {
    assert.notEqual(sqlstate(r), '40P01', 'no hubo deadlocks');
    assert.equal(r.code, 0, r.err);
    assert.equal(result(r).status, 'created');
  }
  const used = { m1: 0, m2: 0, m3: 0 };
  for (const items of orders) for (const i of items) used[i.product as 'm1' | 'm2' | 'm3'] += i.quantity;
  assert.equal(await stock('m1'), before.m1 - used.m1);
  assert.equal(await stock('m2'), before.m2 - used.m2);
  assert.equal(await stock('m3'), before.m3 - used.m3);
});

test('creaciones y vencimientos simultáneos sobre los mismos productos: sin deadlocks', async () => {
  const items: Item[] = [{ product: 'm3', quantity: 1 }, { product: 'm2', quantity: 1 }, { product: 'm1', quantity: 1 }];
  const vencidos = await pedidosVencidos(15, items);
  const before = { m1: await stock('m1'), m2: await stock('m2'), m3: await stock('m3') };

  const sessions = [
    ...Array.from({ length: 15 }, (_, i) => crearSql(newKey(`mix${i}`), `mix${i}-${RUN}@test.com`, nextIp(), [...items].reverse())),
    ...Array.from({ length: 4 }, () => `select 'RESULT:' || public.liberar_reservas_vencidas()::text;`),
  ];
  const results = await simultaneas(sessions);
  for (const r of results) {
    assert.notEqual(sqlstate(r), '40P01', 'no hubo deadlocks');
    assert.equal(r.code, 0, r.err);
  }
  const liberados = results.slice(15).reduce((sum, r) => sum + Number(result(r)), 0);
  assert.equal(liberados, 15, 'cada pedido vencido se liberó una sola vez entre las 4 ejecuciones');
  // +15 liberadas −15 reservadas por los pedidos nuevos
  assert.equal(await stock('m1'), before.m1);
  assert.equal(await stock('m2'), before.m2);
  assert.equal(await stock('m3'), before.m3);
  assert.equal(
    await sql(`select count(*) from public.order_events where event_type = 'reservation_expired' and order_id = any (array[${vencidos.map(lit).join(',')}]::uuid[])`),
    '15',
  );
});

test('cancelación del administrador simultánea con el vencimiento: el stock vuelve exactamente una vez', async (t) => {
  const ids = await pedidosVencidos(10, [{ product: 'venc', quantity: 3 }]);
  const before = await stock('venc');

  const cancel = (id: string) => `set role authenticated;
select set_config('request.jwt.claims', '{"sub":"${ADMIN_ID}","role":"authenticated"}', false);
select public.admin_cancelar_pedido('${id}');
select 'RESULT:"cancelled"';`;
  const sessions = ids.flatMap((id) => [cancel(id), `select 'RESULT:' || public.liberar_reservas_vencidas()::text;`]);
  const results = await simultaneas(sessions);

  let cancelled = 0;
  let expired = 0;
  results.forEach((r, i) => {
    if (i % 2 === 0) {
      if (r.code === 0) cancelled++;
      else assert.equal(sqlstate(r), '55000', `la cancelación perdedora falla limpio: ${r.err}`);
    } else {
      assert.equal(r.code, 0, r.err);
      expired += Number(result(r));
    }
  });
  t.diagnostic(`ganaron la carrera: ${cancelled} cancelaciones, ${expired} vencimientos`);
  assert.equal(cancelled + expired, 10, `cada pedido se liberó una vez (cancelados ${cancelled}, vencidos ${expired})`);
  assert.equal(await stock('venc'), before + 30, 'se devolvieron exactamente 30 unidades');
  assert.equal(
    await sql(`select count(*) from public.order_events where event_type in ('cancelled', 'reservation_expired') and order_id = any (array[${ids.map(lit).join(',')}]::uuid[])`),
    '10',
    'un solo evento de liberación por pedido',
  );
  assert.equal(
    await sql(`select count(*) from public.orders where stock_state = 'released' and id = any (array[${ids.map(lit).join(',')}]::uuid[])`),
    '10',
  );
});

test('notificaciones de pago simultáneas: el mismo pago se aplica una vez; dos pagos distintos dejan un duplicado', async () => {
  const r = result(await psql(crearSql(newKey('pago'), `pago-${RUN}@test.com`, nextIp(), [{ product: 'pago', quantity: 2 }])));
  const total = PRICE.pago * 2 + SHIPPING;
  const before = await stock('pago');

  const mismo = await simultaneas(
    Array.from({ length: 10 }, () => `select 'RESULT:' || to_json(private.aplicar_pago('${r.order_id}', 'cc-mp-${RUN}', 'approved', ${total}))::text;`),
  );
  for (const s of mismo) assert.equal(s.code, 0, s.err);
  const outcomes = mismo.map((s) => result(s));
  assert.equal(outcomes.filter((o) => o === 'approved').length, 1);
  assert.equal(outcomes.filter((o) => o === 'already_applied').length, 9);
  assert.equal(await stock('pago'), before, 'el pago no tocó el stock');

  const r2 = result(await psql(crearSql(newKey('pago2'), `pago2-${RUN}@test.com`, nextIp(), [{ product: 'pago', quantity: 1 }])));
  const distintos = await simultaneas(
    ['a', 'b'].map((s) => `select 'RESULT:' || to_json(private.aplicar_pago('${r2.order_id}', 'cc-mp2-${RUN}-${s}', 'approved', ${PRICE.pago + SHIPPING}))::text;`),
  );
  assert.deepEqual(distintos.map((s) => result(s)).sort(), ['approved', 'duplicate']);
  assert.equal(await sql(`select resolution_reason from public.orders where id = '${r2.order_id}'`), 'duplicate_payment');
});

test('pago simultáneo con el vencimiento: nunca se pierde ni se duplica stock', async (t) => {
  const ids = await pedidosVencidos(10, [{ product: 'pago', quantity: 1 }]);
  const before = await stock('pago');
  const sessions = ids.flatMap((id, i) => [
    `select 'RESULT:' || to_json(private.aplicar_pago('${id}', 'cc-mpv-${RUN}-${i}', 'approved', ${PRICE.pago + SHIPPING}))::text;`,
    `select 'RESULT:' || public.liberar_reservas_vencidas()::text;`,
  ]);
  const results = await simultaneas(sessions);
  for (const r of results) assert.equal(r.code, 0, r.err);
  const pagos = results.filter((_, i) => i % 2 === 0).map((r) => result(r));
  t.diagnostic(`pagos antes de liberar: ${pagos.filter((p) => p === 'approved').length}, después (re-reserva): ${pagos.filter((p) => p === 'approved_late').length}`);
  assert.ok(pagos.every((p) => p === 'approved' || p === 'approved_late'), JSON.stringify(pagos));
  // todos pagados y consumidos: el stock final es el mismo que con las reservas originales
  assert.equal(await stock('pago'), before);
  assert.equal(
    await sql(`select count(*) from public.orders where payment_status = 'approved' and stock_state = 'consumed' and id = any (array[${ids.map(lit).join(',')}]::uuid[])`),
    '10',
  );
});

test('vencimientos de pedidos con productos distintos + compras de varios productos: sin deadlocks', async (t) => {
  // los pedidos vencidos alternan productos (m3, luego m1…): un liberador que los procese de a uno
  // tomaría m3 y después m1, al revés que crear_pedido (m1 → m3)
  const ids = await pedidosVencidos(
    12,
    Array.from({ length: 12 }, (_, i): Item[] => [{ product: i % 2 === 0 ? 'm3' : 'm1', quantity: 1 }]),
  );
  const before = { m1: await stock('m1'), m3: await stock('m3') };
  const sessions = [
    ...Array.from({ length: 4 }, () => `select 'RESULT:' || public.liberar_reservas_vencidas()::text;`),
    ...Array.from({ length: 16 }, (_, i) =>
      crearSql(newKey(`alt${i}`), `alt${i}-${RUN}@test.com`, nextIp(), [{ product: 'm1', quantity: 1 }, { product: 'm3', quantity: 1 }]),
    ),
  ];
  const results = await simultaneas(sessions);
  const deadlocks = results.filter((r) => sqlstate(r) === '40P01').length;
  t.diagnostic(`deadlocks: ${deadlocks}`);
  assert.equal(deadlocks, 0, 'no hubo deadlocks');
  for (const r of results) assert.equal(r.code, 0, r.err);
  const liberados = results.slice(0, 4).reduce((sum, r) => sum + Number(result(r)), 0);
  const creados = results.slice(4).filter((r) => result(r)?.status === 'created').length;
  assert.equal(creados, 16);
  // si alguna compra liberó reservas al pasar (liberación oportunista), igual se liberan 12 en total
  const released = Number(await sql(`select count(*) from public.orders where stock_state = 'released' and id = any (array[${ids.map(lit).join(',')}]::uuid[])`));
  assert.equal(released, 12, `todas liberadas (por la tarea: ${liberados})`);
  assert.equal(await stock('m1'), before.m1 + 6 - 16);
  assert.equal(await stock('m3'), before.m3 + 6 - 16);
});

// ---------------------------------------------------------------------------
// Revisión 4B.3
// ---------------------------------------------------------------------------

/** Sesión de administrador (rol authenticated con el JWT del admin de prueba; RLS incluida). */
const comoAdmin = (body: string) => `set role authenticated;
select set_config('request.jwt.claims', '{"sub":"${ADMIN_ID}","role":"authenticated"}', false);
${body}`;

async function settings(values: string) {
  await sql(`update public.store_settings set ${values}`);
}

test('admin guarda stock mientras compradores reservan (edición rápida y formulario completo): nunca pisa una reserva', async (t) => {
  let conflicts = 0;
  let saved = 0;
  for (let round = 0; round < 12; round++) {
    await sql(`update public.products set stock = 20 where id = '${P.m2}'`);
    // el admin "abre" el producto: lee stock y versión
    const version = Number(await sql(`select stock_version from public.products where id = '${P.m2}'`));
    const full = round % 2 === 1;
    const adminUpdate = full
      ? `update public.products set name = 'Concurrencia m2', price_ars = ${PRICE.m2}, is_featured = false, stock = 25, stock_version = ${version + 1} where id = '${P.m2}';`
      : `update public.products set stock = 25, stock_version = ${version + 1} where id = '${P.m2}';`;
    // el admin aprieta Guardar en distintos momentos respecto de las compras (0 a 110 ms)
    const results = await simultaneas([
      comoAdmin(`select pg_sleep(${round * 0.01});\n${adminUpdate}\nselect 'RESULT:"saved"';`),
      ...Array.from({ length: 5 }, (_, i) =>
        crearSql(newKey(`adm${round}-${i}`), `adm${round}-${i}-${RUN}@test.com`, nextIp(), [{ product: 'm2', quantity: 1 }]),
      ),
    ]);
    const admin = results[0];
    for (const r of results.slice(1)) assert.equal(result(r).status, 'created', r.err);
    const final = await stock('m2');
    if (admin.code === 0) {
      saved++;
      // el admin solo pudo guardar si ninguna reserva se le adelantó: todas se descontaron de su 25
      assert.equal(final, 20, `ronda ${round}: guardado antes de las reservas → 25 − 5`);
    } else {
      conflicts++;
      assert.equal(sqlstate(admin), 'SR003', admin.err);
      assert.match(admin.err, /"stock_version"/, 'el conflicto informa la versión actual para recargar');
      assert.equal(final, 15, `ronda ${round}: conflicto → el 20 viejo no pisó las reservas (20 − 5)`);
    }
  }
  t.diagnostic(`guardados ${saved}, conflictos detectados ${conflicts}`);
  assert.ok(conflicts > 0, 'la prueba provocó al menos un conflicto real');
});

test('intentos fallidos en conexiones separadas: quedan confirmados y el límite se aplica', async () => {
  await settings('max_attempts_per_ip_hour = 5, max_orders_per_ip_hour = 5');
  try {
    const ip = nextIp();
    // de a uno, cada uno en su conexión y su transacción (confirmada)
    for (let i = 0; i < 3; i++) {
      const r = result(await psql(crearSql(`mala-${i}`, `mala${i}-${RUN}@test.com`, ip, [{ product: 'm1', quantity: 1 }])));
      assert.equal(r.error, 'invalid_input');
    }
    for (let i = 0; i < 2; i++) {
      const r = result(await psql(crearSql(newKey(`total${i}`), `total${i}-${RUN}@test.com`, ip, [{ product: 'm1', quantity: 1 }], 1)));
      assert.equal(r.error, 'total_mismatch');
    }
    const ok = result(await psql(crearSql(newKey('valida'), `valida-${RUN}@test.com`, ip, [{ product: 'm1', quantity: 1 }])));
    assert.equal(ok.error, 'too_many_attempts', 'el sexto, aunque válido, se rechaza');
    assert.equal(await sql(`select count(*) from public.checkout_attempts where ip_hash = private.hash_ip('${ip}')`), '6', 'los 6 intentos quedaron confirmados');

    // ráfaga simultánea de errores desde otra IP: se registran todos y el límite se respeta igual
    const ip2 = nextIp();
    const burst = await simultaneas(
      Array.from({ length: 20 }, (_, i) => crearSql(`corta-${i}`, `burst${i}-${RUN}@test.com`, ip2, [{ product: 'm1', quantity: 1 }])),
    );
    for (const r of burst) assert.equal(r.code, 0, r.err);
    const errors = burst.map((r) => result(r).error);
    assert.equal(errors.filter((e) => e === 'invalid_input').length, 5, 'solo 5 llegan a procesarse');
    assert.equal(errors.filter((e) => e === 'too_many_attempts').length, 15, 'el resto se corta antes de hacer trabajo');
    assert.equal(await sql(`select count(*) from public.checkout_attempts where ip_hash = private.hash_ip('${ip2}')`), '20');
  } finally {
    await settings('max_attempts_per_ip_hour = 10000, max_orders_per_ip_hour = 1000');
  }
});

test('ráfaga de pedidos válidos desde una IP: exactamente el máximo por hora', async () => {
  await settings('max_orders_per_ip_hour = 5');
  try {
    const ip = nextIp();
    const before = await stock('m1');
    const results = await simultaneas(
      Array.from({ length: 12 }, (_, i) => crearSql(newKey(`ipb${i}`), `ipb${i}-${RUN}@test.com`, ip, [{ product: 'm1', quantity: 1 }])),
    );
    const outcomes = results.map((r) => result(r));
    assert.equal(outcomes.filter((o) => o.status === 'created').length, 5);
    assert.equal(outcomes.filter((o) => o.error === 'too_many_orders').length, 7);
    assert.equal(await stock('m1'), before - 5);
  } finally {
    await settings('max_orders_per_ip_hour = 1000');
  }
});

test('cancelación, vencimiento y pago simultáneos sobre los mismos pedidos: estados válidos y stock exacto', async (t) => {
  const ids = await pedidosVencidos(10, [{ product: 'pago', quantity: 2 }]);
  const before = await stock('pago');
  const total = PRICE.pago * 2 + SHIPPING;
  const sessions = ids.flatMap((id, i) => [
    comoAdmin(`select public.admin_cancelar_pedido('${id}');\nselect 'RESULT:"cancelled"';`),
    `select 'RESULT:' || public.liberar_reservas_vencidas()::text;`,
    `select 'RESULT:' || to_json(private.aplicar_pago('${id}', 'cc-tri-${RUN}-${i}', 'approved', ${total}))::text;`,
  ]);
  const results = await simultaneas(sessions);
  const pagos: string[] = [];
  results.forEach((r, i) => {
    if (i % 3 === 0 && r.code !== 0) assert.equal(sqlstate(r), '55000', r.err);
    if (i % 3 !== 0) assert.equal(r.code, 0, r.err);
    if (i % 3 === 2) pagos.push(result(r));
  });
  t.diagnostic(`pagos: ${pagos.filter((p) => p === 'approved').length} a tiempo, ${pagos.filter((p) => p === 'approved_late').length} tardíos`);
  // todos terminan pagados con stock consumido (había stock para volver a reservar)
  assert.equal(
    await sql(`select count(*) from public.orders where payment_status = 'approved' and stock_state = 'consumed' and id = any (array[${ids.map(lit).join(',')}]::uuid[])`),
    '10',
  );
  // a lo sumo una liberación por pedido
  assert.equal(
    await sql(`select count(*) from (select order_id from public.order_events where event_type in ('cancelled', 'reservation_expired')
                and order_id = any (array[${ids.map(lit).join(',')}]::uuid[]) group by order_id having count(*) > 1) x`),
    '0',
  );
  assert.equal(await stock('pago'), before, 'reservadas al inicio y consumidas al final: el stock disponible es el mismo');
});

test('dos administradores guardan notas a la vez: solo uno confirma y deja un evento', async () => {
  const created = result(await psql(crearSql(newKey('notas-admin'), `notas-${RUN}@test.com`, nextIp(), [{ product: 'idem', quantity: 1 }])));
  assert.equal(created.status, 'created');
  const id = created.order_id;
  const version = await sql(`select admin_version from public.orders where id = '${id}'`);
  const sessions = ['Primero', 'Segundo'].map(note => `set role authenticated; set request.jwt.claim.sub = '${ADMIN_ID}'; select public.admin_operar_pedido('${id}',${version},'notes','${note}');`);
  const responses = await simultaneas(sessions);
  assert.equal(responses.filter(r => r.code === 0).length, 1);
  assert.equal(responses.filter(r => /SR004/.test(r.err)).length, 1, responses.map(r => r.err).join('\n'));
  assert.equal(await sql(`select count(*) from public.order_events where order_id='${id}' and event_type='notes_updated'`), '1');
});

test('API: la clave publicable no consulta pedidos y las funciones internas de pago no están expuestas', async () => {
  const status = JSON.parse(
    execFileSync('npx', ['supabase', 'status', '-o', 'json'], { encoding: 'utf8', shell: process.platform === 'win32', stdio: ['ignore', 'pipe', 'pipe'] })
      .replace(/^[^{]*/, ''),
  );
  const anon = createClient(API_URL, status.PUBLISHABLE_KEY, { auth: { persistSession: false } });
  const server = createClient(API_URL, status.SECRET_KEY, { auth: { persistSession: false } });

  const consulta = await anon.rpc('consultar_pedido', { p_code: 'STF-2611-AAAA', p_token: 'x'.repeat(43) });
  assert.equal(consulta.error?.code, '42501', 'anon no puede consultar pedidos');
  for (const client of [anon, server]) {
    const pago = await client.rpc('aplicar_pago' as never, { p_order_id: P.pago, p_payment_ref: 'x', p_status: 'approved', p_amount_ars: 1 } as never);
    assert.ok(pago.error, 'aplicar_pago no existe en la API');
    const priv = await client.schema('private' as never).rpc('aplicar_pago' as never, {} as never);
    assert.ok(priv.error, 'el esquema private no está expuesto');
  }
  const anonStock = await anon.from('products').update({ stock: 999 }).eq('id', P.m1).select('id');
  assert.ok(anonStock.error, 'anon no modifica stock');
  const serverStock = await server.from('products').update({ stock: 999 }).eq('id', P.m1).select('id');
  assert.equal(serverStock.error?.code, 'SR003', 'service_role tampoco cambia stock sin la versión');
});
