import { createClient } from '@supabase/supabase-js';
import type { Database } from '../src/lib/supabase/database.types.ts';
import { paymentReconciliationEnabled } from '../src/lib/orders/payment-webhook.ts';
import { reconcilePayment } from '../src/lib/orders/payment-reconciliation.ts';

const env = process.env;
if (!paymentReconciliationEnabled(env) || !env.SUPABASE_SECRET_KEY) {
  console.error('La conciliación solo se habilita explícitamente con Supabase local y el simulador.');
  process.exit(2);
}
const db = createClient<Database>(env.NEXT_PUBLIC_SUPABASE_URL!, env.SUPABASE_SECRET_KEY, {
  auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
});
const once = process.argv.includes('--once');
const health = process.argv.includes('--health');
if (health) {
  const { data, error } = await db.rpc('estado_trabajos_pago').abortSignal(AbortSignal.timeout(4000));
  if (error || !data || typeof data !== 'object' || Array.isArray(data)) process.exit(2);
  console.log(JSON.stringify(data));
  process.exit(Object.values(data).some(value => typeof value === 'number' && value > 0) ? 1 : 0);
}

let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.on(signal, () => { stopping = true; });
let failures = 0;
while (!stopping) {
  let count = 0;
  try {
    while (!stopping && count < 20) {
      const work = await reconcilePayment(db);
      if (!work) break;
      count++;
      console.log(JSON.stringify({ event: 'payment_job', ...work }));
    }
    failures = 0;
  } catch {
    failures++;
    console.error(JSON.stringify({ event: 'payment_worker_failure', consecutive: failures }));
    if (once) process.exitCode = 1;
  }
  if (once || stopping) break;
  if (count < 20 || failures) await new Promise(resolve => setTimeout(resolve, Math.min(60_000, 5000 * 2 ** Math.min(failures, 4))));
}
