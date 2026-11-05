// Ejecutor autónomo de la cola de comunicaciones del arrepentimiento.
//
//   node --env-file=.env.worker scripts/mail-worker.ts           # proceso continuo (VPS: systemd/Docker con reinicio)
//   node --env-file=.env.worker scripts/mail-worker.ts --once    # un ciclo y sale (pruebas, timers)
//   node --env-file=.env.worker scripts/mail-worker.ts --health  # sale con código 1 si hay problemas (monitor)
//
// No depende de que alguien visite la web ni de que haya un administrador conectado. Tras un reinicio
// retoma lo pendiente: las filas «enviando» de un proceso muerto se recuperan al vencer su arrendamiento.
// No se activa ningún servicio programado en Cloud: este proceso lo levanta el operador en su servidor.
//
// Variables: NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY y las MAIL_* de docs/zoho-correo.md.
// Registra solo eventos con ids y códigos (JSON por línea): nunca emails, tokens ni cuerpos.

import { hostname } from 'node:os';
import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/supabase/database.types.ts';
import { mailConfigFromEnv } from '../src/lib/mail/config.ts';
import { createTransport } from '../src/lib/mail/transports.ts';
import { drainOnce, supabaseQueue, type Logger } from '../src/lib/mail/worker.ts';
import { evaluateHealth, parseStats } from '../src/lib/mail/health.ts';
import { EMAIL, WHATSAPP_NUMERO } from '../src/lib/site.ts';

const args = new Set(process.argv.slice(2));
const log: Logger = (evento, data = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), evento, ...data }));

function fail(message: string): never {
  console.error(JSON.stringify({ evento: 'mail_worker_error', motivo: message }));
  process.exit(2);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY;
if (!url || !key) fail('Faltan NEXT_PUBLIC_SUPABASE_URL o SUPABASE_SECRET_KEY');
const client = createClient<Database>(url, key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });

if (args.has('--health')) {
  const { data, error } = await client.rpc('estado_comunicaciones');
  const stats = error ? null : parseStats(data);
  if (!stats) fail('No se pudo consultar el estado de comunicaciones');
  const health = evaluateHealth(stats, Number(process.env.MAIL_WORKER_MAX_SILENCE_MINUTES ?? 10));
  console.log(JSON.stringify(health));
  process.exit(health.ok ? 0 : 1);
}

const config = mailConfigFromEnv(process.env);
if (!config.ok) fail(config.error);
if (config.config.transport === 'desactivado') fail('MAIL_TRANSPORT=desactivado: no hay nada que ejecutar');
const transport = createTransport(config.config)!;
const context = { linkBaseUrl: config.config.linkBaseUrl, contactEmail: EMAIL, whatsapp: WHATSAPP_NUMERO };
const worker = (process.env.MAIL_WORKER_ID || `worker-${hostname()}-${process.pid}`).replace(/[^A-Za-z0-9._:-]/g, '-').slice(0, 80);
const intervalMs = Math.max(5, Math.min(300, Number(process.env.MAIL_WORKER_INTERVAL_SECONDS ?? 30))) * 1000;
const queue = supabaseQueue(client);

async function cycle() {
  const summary = await drainOnce({ queue, transport, context, worker, limit: 10, log });
  if (summary.claimed > 0) log('mail_ciclo', { ...summary });
  return summary;
}

if (args.has('--once')) {
  try {
    await cycle();
    process.exit(0);
  } catch (e) {
    fail(`ciclo: ${(e as Error).message.slice(0, 80)}`);
  }
}

let stopping = false;
let wake: (() => void) | undefined;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopping = true;
    wake?.();
  });
}
log('mail_worker_inicio', { worker, transporte: transport.name, intervalo_s: intervalMs / 1000 });
let failures = 0;
while (!stopping) {
  try {
    const summary = await cycle();
    failures = 0;
    // Si quedó trabajo (lote lleno), seguir sin esperar.
    if (summary.claimed >= 10) continue;
  } catch (e) {
    failures++;
    log('mail_ciclo_error', { error: (e as Error).message.slice(0, 80), consecutivos: failures });
  }
  // Espera creciente si la base no responde (hasta 5 minutos); el monitor externo detecta la falta de latido.
  const wait = failures ? Math.min(300_000, intervalMs * 2 ** Math.min(failures, 4)) : intervalMs;
  await new Promise<void>((resolve) => {
    wake = resolve;
    setTimeout(resolve, wait);
  });
}
log('mail_worker_fin', { worker });
