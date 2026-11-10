import type { NextRequest } from 'next/server';
import { clientIp } from '@/lib/checkout/server';
import { isOrderCode, isOrderToken } from '@/lib/checkout/order-view';
import { json, notFound, onlyPost, readJsonBody } from '@/lib/http/json-api';
import { paymentOrigin, startPayment } from '@/lib/orders/payment-server';

export async function POST(request: NextRequest) {
  const origin = paymentOrigin();
  if (!origin || request.nextUrl.origin !== origin) return notFound();
  const read = await readJsonBody(request, 1024);
  if ('response' in read) return read.response;
  const body = read.body as { code?: unknown; token?: unknown } | null;
  const valid = body && typeof body === 'object' && Object.keys(body).length === 2
    && isOrderCode(body.code) && isOrderToken(body.token);
  const ip = await clientIp();
  if (!ip) return notFound();

  try {
    const result = await startPayment(origin, valid ? body.code as string : '', valid ? body.token as string : '', ip);
    if (result.checkoutUrl) return json({ checkoutUrl: result.checkoutUrl });
    if (result.status === 'not_found') return notFound();
    if (result.status === 'rate_limited') return json({ error: 'retry' }, 429);
    if (result.status === 'unavailable') return json({ error: 'payment_unavailable' }, 409);
    if (result.status === 'busy') return json({ error: 'retry' }, 409);
    return json({ error: 'retry' }, 503);
  } catch {
    return json({ error: 'retry' }, 503);
  }
}

export const { GET, PUT, PATCH, DELETE } = onlyPost;
