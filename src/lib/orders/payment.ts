type Env = Record<string, string | undefined>;

export function localPaymentOrigin(env: Env): string | null {
  if (env.NODE_ENV !== 'development' || env.STEFFEN_MP_MODE !== 'mock') return null;
  try {
    const origin = new URL(env.STEFFEN_MP_LOCAL_ORIGIN ?? '');
    if (origin.origin !== env.STEFFEN_MP_LOCAL_ORIGIN || origin.protocol !== 'http:'
        || !['127.0.0.1', 'localhost'].includes(origin.hostname)) return null;
    return origin.origin;
  } catch {
    return null;
  }
}

export type PaymentSnapshot = {
  reference: string;
  total: string;
  shipping: string;
  expirationSeconds: number;
  items: { title: string; quantity: number; unitPrice: string }[] | null;
};

function cents(value: string): bigint {
  if (!/^(0|[1-9][0-9]{0,9})(\.[0-9]{2})?$/.test(value)) throw new Error('invalid_amount');
  const [whole, fraction = '00'] = value.split('.');
  return BigInt(whole) * BigInt(100) + BigInt(fraction);
}

export function buildPaymentOrder(snapshot: PaymentSnapshot, origin: string) {
  if (!/^STF-[0-9]{4}-[2-9A-HJ-NP-Z]{4}$/.test(snapshot.reference)
      || !Number.isInteger(snapshot.expirationSeconds) || snapshot.expirationSeconds < 1
      || snapshot.expirationSeconds > 1800 || !snapshot.items?.length) throw new Error('invalid_snapshot');

  let sum = BigInt(0);
  const items = snapshot.items.map(({ title, quantity, unitPrice }) => {
    if (!title.trim() || !Number.isSafeInteger(quantity) || quantity < 1) throw new Error('invalid_item');
    sum += cents(unitPrice) * BigInt(quantity);
    return { title, quantity, unit_price: unitPrice };
  });
  const shipping = cents(snapshot.shipping);
  if (shipping > 0) items.push({ title: 'Envío del pedido', quantity: 1, unit_price: snapshot.shipping });
  if (sum + shipping <= 0 || sum + shipping !== cents(snapshot.total)) throw new Error('amount_mismatch');
  const path = `${origin}/pedido/${snapshot.reference}?pago=`;

  return {
    type: 'online',
    processing_mode: 'manual',
    total_amount: snapshot.total,
    external_reference: snapshot.reference,
    expiration_time: `PT${snapshot.expirationSeconds}S`,
    items,
    config: {
      statement_descriptor: 'STEFFEN',
      online: { success_url: path + 'finalizado', pending_url: path + 'pendiente', failure_url: path + 'rechazado' },
      payment_method: { not_allowed_types: ['ticket'], max_installments: 6 },
    },
  } as const;
}

export type PaymentOrder = ReturnType<typeof buildPaymentOrder>;

export const mockOrderId = (value: unknown): value is string => typeof value === 'string' && /^ORDMOCK[0-9a-f]{32}$/.test(value);

export function validateMockOrder(raw: unknown, expected: PaymentOrder, origin: string) {
  const order = raw as Record<string, unknown> | null;
  if (!order || !mockOrderId(order.id) || order.status !== 'created' || order.currency !== 'ARS'
      || order.user_id !== 'local-simulator' || order.external_reference !== expected.external_reference
      || typeof order.total_amount !== 'string' || cents(order.total_amount) !== cents(expected.total_amount)
      || typeof order.checkout_url !== 'string') {
    throw new Error('invalid_response');
  }
  return { id: order.id, checkoutUrl: validatedCheckoutUrl(order.checkout_url, origin, expected.external_reference) };
}

export function validatedCheckoutUrl(raw: string, origin: string, reference: string): string {
  const url = new URL(raw);
  if (url.origin !== origin || url.username || url.password || url.hash
      || url.pathname !== `/pedido/${reference}` || url.search !== '?pago=simulado') {
    throw new Error('invalid_response');
  }
  return url.href;
}

export function providerError(status: number) {
  if (status === 409) return 'conflict';
  if (status === 408 || status === 504) return 'timeout';
  if (status === 429 || status >= 500) return 'unavailable';
  return 'invalid_response';
}
