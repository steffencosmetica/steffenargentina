import { NextRequest } from 'next/server';
import { json, notFound, onlyPost } from '@/lib/http/json-api';
import { createServiceClient, hasServiceKey } from '@/lib/supabase/admin';
import { parseRevocation } from '@/lib/legal/request';
import { readBoundedJson, revocationClientIp } from '@/lib/legal/api';
import { isRevocationEnabled } from '@/lib/legal/flag';
import { scheduleMailDrain } from '@/lib/mail/server';

export async function POST(request: NextRequest) {
  // Apagado (predeterminado): la ruta no existe.
  if (!isRevocationEnabled()) return notFound();
  const read = await readBoundedJson(request, 4096);
  if ('response' in read) return read.response;
  const input = parseRevocation(read.body);
  if (!input) return json({ error: 'invalid_request' }, 422);
  const ip = revocationClientIp(request);
  if (!ip || !hasServiceKey()) return json({ error: 'unavailable' }, 503);
  try {
    // La solicitud y su comunicación por email se guardan en la misma transacción.
    const { data, error } = await createServiceClient().rpc('registrar_arrepentimiento', { p_reference: input.purchaseReference, p_email: input.email, p_key: input.idempotencyKey, p_ip: ip });
    if (error) return json({ error: 'unavailable' }, 503);
    const result = data as { code?: string; received_at?: string; limited?: boolean } | null;
    if (result?.limited) return json({ error: 'rate_limited' }, 429);
    if (!result?.code || !result.received_at) return json({ error: 'unavailable' }, 503);
    // El email de respaldo sale después de responder; la constancia web no depende del correo.
    scheduleMailDrain();
    return json({ code: result.code, receivedAt: result.received_at }, 201);
  } catch { return json({ error: 'unavailable' }, 503); }
}
export const { GET, PUT, PATCH, DELETE } = onlyPost;
export const HEAD = notFound;
