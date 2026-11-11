import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database, Json } from '../supabase/database.types.ts';
import { mockPaymentId, mockProviderId } from './payment-webhook.ts';

const states: Record<string, string> = {
  'created/created': 'created',
  'action_required/waiting_capture': 'pending',
  'action_required/waiting_payment': 'pending',
  'action_required/waiting_transfer': 'pending',
  'action_required/waiting_retry': 'pending',
  'action_required/pending_challenge': 'processing',
  'processing/in_process': 'processing',
  'processing/pending_review_manual': 'processing',
  'processing/in_review': 'processing',
  'processed/accredited': 'accredited',
  'processed/partially_refunded': 'partially_refunded',
  'canceled/canceled': 'cancelled',
  'canceled/expired': 'expired',
  'expired/expired': 'expired',
  'refunded/refunded': 'refunded',
  'charged_back/in_process': 'disputed',
  'charged_back/settled': 'disputed',
  'charged_back/reimbursed': 'disputed',
};
for (const detail of ['bad_filled_card_data', 'invalid_card_token', 'high_risk', 'rejected_by_issuer', 'required_call_for_authorize',
  'max_attempts_exceeded', 'card_disabled', 'insufficient_amount', 'amount_limit_exceeded', 'invalid_installments', 'processing_error']) {
  states['failed/' + detail] = 'rejected';
}

type Job = { id: string; lease: string; provider: string | null; reference: string | null; createdAt: string | null };
type Observation = { evidence: Json; state: string | null; error: string | null; retry: boolean };
const failure = (error: string, retry = false): Observation => ({ evidence: null, state: null, error, retry });
const amount = /^(0|[1-9][0-9]{0,9})\.[0-9]{2}$/;

export function inspectPayment(raw: Json, expected: Pick<Job, 'provider' | 'reference'>): Observation {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return failure('invalid_response');
  if (typeof raw.id !== 'string' || !mockProviderId.test(raw.id)
      || (expected.provider !== null && raw.id !== expected.provider)
      || (expected.reference !== null && raw.external_reference !== expected.reference)
      || typeof raw.external_reference !== 'string' || !/^STF-[0-9]{4}-[2-9A-HJ-NP-Z]{4}$/.test(raw.external_reference)
      || raw.user_id !== 'local-simulator' || raw.application_id !== 'local-payment-app' || raw.live_mode !== false || raw.currency !== 'ARS') {
    return failure('identity_mismatch');
  }
  if (typeof raw.total_amount !== 'string' || !amount.test(raw.total_amount) || raw.total_amount === '0.00'
      || typeof raw.total_paid_amount !== 'string' || !amount.test(raw.total_paid_amount)
      || typeof raw.revision !== 'number' || !Number.isSafeInteger(raw.revision) || raw.revision < 1
      || typeof raw.status !== 'string' || typeof raw.status_detail !== 'string') return failure('invalid_response');
  const key = raw.status + '/' + raw.status_detail;
  const state = Object.hasOwn(states, key) ? states[key] : undefined;
  if (!state) return failure('unknown_state');
  if (state === 'accredited' && (raw.total_amount !== raw.total_paid_amount
      || typeof raw.payment_id !== 'string' || !mockPaymentId.test(raw.payment_id))) return failure('invalid_accreditation');
  return { evidence: raw, state, error: null, retry: false };
}

export async function reconcilePayment(db: SupabaseClient<Database>) {
  const timeout = () => AbortSignal.timeout(4000);
  const claim = await db.rpc('tomar_trabajos_pago').abortSignal(timeout());
  if (claim.error) throw new Error('claim_failed');
  const job = claim.data as Job | null;
  if (!job) return null;
  const lookup = (id: string | null) => db.rpc('buscar_order_pago_simulada', {
    p_id: id,
    p_reference: id ? null : job.reference,
    p_begin: id || !job.createdAt ? null : new Date(Date.parse(job.createdAt) - 1000).toISOString(),
    p_end: id ? null : new Date(Date.now() + 1000).toISOString(),
  }).abortSignal(timeout());

  async function observe(): Promise<Observation> {
    let response = await lookup(job!.provider);
    if (!job!.provider && !response.error && Array.isArray(response.data) && response.data.length === 1) {
      const candidate = inspectPayment(response.data[0], job!);
      if (candidate.error) return candidate;
      const id = (response.data[0] as { id: string }).id;
      response = await lookup(id);
      if (!response.error && Array.isArray(response.data) && response.data.length === 1) {
        return inspectPayment(response.data[0], { ...job!, provider: id });
      }
    }
    if (response.error) return response.status === 0 || response.status === 408 || response.status === 429 || response.status >= 500
      ? failure('provider_unavailable', true) : failure('provider_rejected');
    if (!Array.isArray(response.data)) return failure('invalid_response');
    if (!response.data.length) return failure('provider_not_found', true);
    if (response.data.length !== 1) return failure('ambiguous_reference');
    return inspectPayment(response.data[0], job!);
  }

  let observation: Observation;
  try {
    observation = await observe();
  } catch {
    observation = failure('provider_unavailable', true);
  }
  const result = await db.rpc('resolver_trabajo_pago', {
    p_id: job.id, p_lease: job.lease, p_evidence: observation.evidence,
    p_state: observation.state, p_error: observation.error, p_retry: observation.retry,
  }).abortSignal(timeout());
  if (result.error) throw new Error('finish_failed');
  return { id: job.id, result: result.data };
}
