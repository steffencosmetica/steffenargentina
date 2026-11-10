import 'server-only';
import { humanCheck, isCheckoutAvailable } from '@/lib/checkout/server';
import { createServiceClient } from '@/lib/supabase/admin';
import { buildPaymentOrder, localPaymentOrigin, mockOrderId, validatedCheckoutUrl, validateMockOrder, type PaymentSnapshot } from './payment';
import { mockCheckoutUrl, mockPaymentProvider, PaymentProviderError } from './payment-provider';

export function paymentOrigin() {
  return isCheckoutAvailable() && humanCheck() ? localPaymentOrigin(process.env) : null;
}

type Claim =
  | { status: 'not_found' | 'rate_limited' | 'unavailable' | 'busy' }
  | { status: 'open'; provider_order_id: string }
  | (PaymentSnapshot & { status: 'creating'; id: string; key: string; lease: string; recover: boolean; createdAt: string });

export async function startPayment(origin: string, code: string, token: string, ip: string) {
  const db = createServiceClient();
  const { data, error } = await db.rpc('iniciar_intento_pago', {
    p_code: code, p_token: token, p_client_ip: ip,
  }).abortSignal(AbortSignal.timeout(4_000));
  if (error) throw error;
  const claim = data as Claim;
  if (claim.status === 'open' && mockOrderId(claim.provider_order_id)) {
    return { checkoutUrl: validatedCheckoutUrl(mockCheckoutUrl(origin, code), origin, code) };
  }
  if (claim.status !== 'creating') return { status: claim.status };

  const provider = mockPaymentProvider(db, origin);
  let result: ReturnType<typeof validateMockOrder>;
  try {
    const payload = buildPaymentOrder(claim, origin);
    const search = () => provider.search({
      external_reference: payload.external_reference,
      begin_date: new Date(Date.parse(claim.createdAt) - 1_000).toISOString(),
      end_date: new Date(Date.now() + 1_000).toISOString(),
    });
    const recover = async () => {
      const matches = await search();
      if (matches.length > 1) throw new PaymentProviderError('conflict');
      return matches.length === 1 ? validateMockOrder(matches[0], payload, origin).id : null;
    };
    const existing = claim.recover ? await recover() : null;
    if (existing) {
      result = validateMockOrder(await provider.get(existing), payload, origin);
    } else {
      try {
        result = validateMockOrder(await provider.create(payload, claim), payload, origin);
      } catch (error) {
        if (!(error instanceof PaymentProviderError) || error.reason !== 'conflict') throw error;
        const recovered = await recover();
        if (!recovered) throw error;
        result = validateMockOrder(await provider.get(recovered), payload, origin);
      }
    }
  } catch (error) {
    await db.rpc('finalizar_intento_pago', {
      p_id: claim.id, p_lease: claim.lease, p_provider_order_id: null,
      p_error: error instanceof PaymentProviderError ? error.reason : 'invalid_response',
    }).abortSignal(AbortSignal.timeout(4_000));
    return { status: 'retry' };
  }

  // Si este commit falla, el intento y su clave siguen disponibles al vencer la concesión.
  const saved = await db.rpc('finalizar_intento_pago', {
    p_id: claim.id, p_lease: claim.lease, p_provider_order_id: result.id, p_error: null,
  }).abortSignal(AbortSignal.timeout(4_000));
  if (saved.error) throw saved.error;
  return saved.data ? { checkoutUrl: result.checkoutUrl } : { status: 'retry' };
}
