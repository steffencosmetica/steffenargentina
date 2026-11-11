import 'server-only';
import { json, notFound, onlyPost } from '@/lib/http/json-api';
import { orderNotification, paymentReconciliationEnabled, signedOrder } from '@/lib/orders/payment-webhook';
import { createServiceClient, hasServiceKey } from '@/lib/supabase/admin';

const MAX_BODY = 16_384;

async function readBody(request: Request) {
  const reader = request.body?.getReader();
  if (!reader) return null;
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks)));
      size += value.byteLength;
      if (size > MAX_BODY) {
        void reader.cancel().catch(() => {});
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  } finally {
    reader.releaseLock();
  }
}

export async function POST(request: Request) {
  const secret = process.env.STEFFEN_MP_MOCK_WEBHOOK_SECRET;
  if (!paymentReconciliationEnabled(process.env) || !secret || secret.length < 32 || !hasServiceKey()) return notFound();
  const signed = signedOrder(new URL(request.url), request.headers, secret);
  if (!signed) return json({ error: 'invalid_signature' }, 401);
  if (request.headers.get('content-type')?.split(';')[0].trim().toLowerCase() !== 'application/json') {
    return json({ error: 'invalid_notification' }, 415);
  }
  if (Number(request.headers.get('content-length')) > MAX_BODY) return json({ error: 'invalid_notification' }, 413);
  const event = orderNotification(await readBody(request), signed.provider);
  if (!event) return json({ error: 'invalid_notification' }, 400);

  try {
    const { data, error } = await createServiceClient().rpc('recibir_notificacion_pago', {
      p_request: signed.request, p_notification: event.id, p_provider: signed.provider, p_event: event.event,
    }).abortSignal(AbortSignal.timeout(4000));
    if (!error) return data ? json({ received: true }) : json({ error: 'invalid_notification' }, 409);
  } catch {
    // Mercado Pago puede repetir el envío si la confirmación del commit se perdió.
  }
  return json({ error: 'unavailable' }, 503);
}

export const { GET, PUT, PATCH, DELETE } = onlyPost;
