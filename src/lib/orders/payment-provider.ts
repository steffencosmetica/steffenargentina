import 'server-only';
import { createServiceClient } from '@/lib/supabase/admin';
import { providerError, type PaymentOrder } from './payment';

export class PaymentProviderError extends Error {
  constructor(readonly reason: ReturnType<typeof providerError> | 'network') {
    super(reason);
  }
}

export interface PaymentProvider {
  create(order: PaymentOrder, context: { key: string; lease: string }): Promise<unknown>;
  get(id: string): Promise<unknown>;
  search(query: { external_reference: string; begin_date: string; end_date: string }): Promise<unknown[]>;
}

export function mockCheckoutUrl(origin: string, reference: string) {
  return `${origin}/pedido/${reference}?pago=simulado`;
}

const timeout = () => AbortSignal.timeout(4_000);

async function providerResult<T>(signal: AbortSignal, request: PromiseLike<{ data: T; error: unknown; status: number }>) {
  try {
    const result = await request;
    if (!result.error) return result.data;
    throw new PaymentProviderError(signal.aborted ? 'timeout' : result.status ? providerError(result.status) : 'network');
  } catch (error) {
    if (error instanceof PaymentProviderError) throw error;
    throw new PaymentProviderError(signal.aborted ? 'timeout' : 'network');
  }
}

export function mockPaymentProvider(db: ReturnType<typeof createServiceClient>, origin: string): PaymentProvider {
  async function lookup(id: string | null, reference: string | null, begin: string | null, end: string | null) {
    const signal = timeout();
    const data = await providerResult(signal, db.rpc('buscar_order_pago_simulada', {
      p_id: id, p_reference: reference, p_begin: begin, p_end: end,
    }).abortSignal(signal));
    if (!Array.isArray(data)) throw new PaymentProviderError('invalid_response');
    return data.map((row) => {
      if (!row || typeof row !== 'object' || Array.isArray(row) || typeof row.external_reference !== 'string') {
        throw new PaymentProviderError('invalid_response');
      }
      return { ...row, checkout_url: mockCheckoutUrl(origin, row.external_reference) };
    });
  }

  return {
    async create(order, { key, lease }) {
      const signal = timeout();
      const id = await providerResult(signal, db.rpc('simular_order_pago', {
        p_key: key, p_lease: lease, p_reference: order.external_reference, p_total: order.total_amount,
      }).abortSignal(signal));
      if (!id) throw new PaymentProviderError('unavailable');
      return {
        id, external_reference: order.external_reference, total_amount: order.total_amount,
        status: 'created', currency: 'ARS', user_id: 'local-simulator',
        checkout_url: mockCheckoutUrl(origin, order.external_reference),
      };
    },
    async get(id) {
      const matches = await lookup(id, null, null, null);
      return matches.length === 1 ? matches[0] : null;
    },
    search(query) {
      return lookup(null, query.external_reference, query.begin_date, query.end_date);
    },
  };
}
