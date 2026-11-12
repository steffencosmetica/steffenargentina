import 'server-only';
import { createServiceClient } from '@/lib/supabase/admin';
import { providerError } from './payment';
import type { Json } from '@/lib/supabase/database.types';
import type { RefundTransaction } from './after-sales-model';
import { refundOutcome } from './refund-flow';

export type RefundClaim = {
  state: string; id?: string; key?: string; lease?: string; kind?: 'full' | 'partial';
  provider?: string; payment?: string | null; cents?: number; transactions?: RefundTransaction[];
};

export async function executeMockRefund(claim: Required<RefundClaim>, body: Json) {
  const db = createServiceClient();
  const signal = AbortSignal.timeout(4_000);
  return refundOutcome(async () => {
    try {
      const sent = await db.rpc('simular_reembolso_posventa', {
        p_id: claim.id, p_key: claim.key, p_lease: claim.lease, p_payload: body,
      }).abortSignal(signal);
      if (sent.error) return signal.aborted ? 'timeout' : sent.status ? providerError(sent.status) : 'network';
      return sent.data === 'invalid_payload' ? 'invalid_payload' : null;
    } catch {
      return signal.aborted ? 'timeout' : 'network';
    }
  }, async classified => {
    // Consulta independiente después de enviar, incluido timeout o 409. No se interpreta el acuse como éxito.
    const result = await db.rpc('resolver_reembolso_posventa', {
      p_id: claim.id, p_lease: claim.lease, p_error: classified,
    }).abortSignal(AbortSignal.timeout(4_000));
    if (result.error) throw new Error('refund_observation_failed');
    return result.data;
  });
}
