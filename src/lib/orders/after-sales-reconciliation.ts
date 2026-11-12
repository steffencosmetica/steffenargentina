import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '../supabase/database.types.ts';

// El simulador consulta su ledger durable dentro del RPC. Nunca envía un reintegro.
export async function reconcileAfterSales(db: SupabaseClient<Database>) {
  const claim = await db.rpc('tomar_posventa_simulada').abortSignal(AbortSignal.timeout(4000));
  if (claim.error) throw new Error('after_sales_claim_failed');
  const job = claim.data as { order: string; lease: string } | null;
  if (!job) return null;
  const result = await db.rpc('resolver_posventa_simulada', { p_order: job.order, p_lease: job.lease })
    .abortSignal(AbortSignal.timeout(4000));
  if (result.error) throw new Error('after_sales_finish_failed');
  return { order: job.order, result: result.data };
}
