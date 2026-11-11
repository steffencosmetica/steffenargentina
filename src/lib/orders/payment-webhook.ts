import { createHmac, timingSafeEqual } from 'node:crypto';

export function paymentReconciliationEnabled(env: Record<string, string | undefined>) {
  return env.NODE_ENV === 'development' && env.STEFFEN_MP_MODE === 'mock'
    && env.STEFFEN_MP_RECONCILIATION === '1' && !env.VERCEL && !env.VERCEL_ENV
    && !env.STEFFEN_TRUSTED_PROXY && ['http://localhost:55321', 'http://127.0.0.1:55321'].includes(env.NEXT_PUBLIC_SUPABASE_URL ?? '');
}

export const mockProviderId = /^ORDMOCK[0-9a-f]{32}$/;
export const mockPaymentId = /^PAYMOCK[0-9a-f]{32}$/;

export function signedOrder(url: URL, headers: Headers, secret: string, now = Date.now()) {
  const ids = url.searchParams.getAll('data.id');
  const topics = url.searchParams.getAll('type');
  if (ids.length !== 1 || !mockProviderId.test(ids[0]) || topics.length !== 1 || topics[0] !== 'order') return null;
  const request = headers.get('x-request-id') ?? '';
  const signature = headers.get('x-signature') ?? '';
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(request) || signature.length > 120) return null;
  const fields = signature.split(',').map(part => part.trim().split('='));
  if (fields.length !== 2 || fields.some(field => field.length !== 2)) return null;
  const values = new Map(fields.map(([key, value]) => [key, value]));
  const ts = values.get('ts') ?? '';
  const digest = values.get('v1') ?? '';
  if (!/^(?:[0-9]{10}|[0-9]{13})$/.test(ts) || !/^[a-f0-9]{64}$/.test(digest)) return null;
  const timestamp = Number(ts) * (ts.length === 10 ? 1000 : 1);
  if (now - timestamp > 300_000 || timestamp - now > 30_000) return null;
  const manifest = `id:${ids[0]};request-id:${request};ts:${ts};`;
  const expected = createHmac('sha256', secret).update(manifest).digest();
  return timingSafeEqual(expected, Buffer.from(digest, 'hex')) ? { provider: ids[0], request } : null;
}

export function orderNotification(value: unknown, provider: string) {
  const body = value as { type?: unknown; api_version?: unknown; id?: unknown; action?: unknown; live_mode?: unknown;
    user_id?: unknown; application_id?: unknown; data?: { id?: unknown } } | null;
  if (!body || body.type !== 'order' || body.api_version !== 'v1' || body.live_mode !== false || body.data?.id !== provider
      || (body.user_id !== undefined && body.user_id !== 'local-simulator')
      || (body.application_id !== undefined && body.application_id !== 'local-payment-app')
      || typeof body.action !== 'string' || !/^order\.[a-z_]{1,40}$/.test(body.action)) return null;
  const id = typeof body.id === 'number' && Number.isSafeInteger(body.id) ? String(body.id) : body.id;
  return typeof id === 'string' && /^[0-9]{1,24}$/.test(id) ? { id, event: body.action } : null;
}
