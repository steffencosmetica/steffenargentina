import { NextRequest } from 'next/server';
import { json, notFound, onlyPost } from '@/lib/http/json-api';
import { createServiceClient, hasServiceKey } from '@/lib/supabase/admin';
import { parseRecoveryRequest } from '@/lib/legal/request';
import { readBoundedJson, revocationClientIp } from '@/lib/legal/api';
import { isRevocationEnabled } from '@/lib/legal/flag';
import { scheduleMailDrain } from '@/lib/mail/server';

// Respuesta idéntica exista o no una solicitud con ese email (sin enumeración). El email con el enlace
// privado solo se encola si hay solicitudes para esa dirección y dentro de los límites; nunca se informa.
export async function POST(request: NextRequest) {
  // Apagado (predeterminado): la ruta no existe.
  if (!isRevocationEnabled()) return notFound();
  const read = await readBoundedJson(request, 1024);
  if ('response' in read) return read.response;
  const input = parseRecoveryRequest(read.body);
  if (!input) return json({ error: 'invalid_request' }, 422);
  const ip = revocationClientIp(request);
  if (!ip || !hasServiceKey()) return json({ error: 'unavailable' }, 503);
  try {
    const { data, error } = await createServiceClient().rpc('solicitar_recuperacion_arrepentimiento', { p_email: input.email, p_ip: ip });
    if (error) return json({ error: 'unavailable' }, 503);
    if ((data as { limited?: boolean } | null)?.limited) return json({ error: 'rate_limited' }, 429);
    scheduleMailDrain();
    return json({ ok: true }, 202);
  } catch { return json({ error: 'unavailable' }, 503); }
}
export const { GET, PUT, PATCH, DELETE } = onlyPost;
export const HEAD = notFound;
