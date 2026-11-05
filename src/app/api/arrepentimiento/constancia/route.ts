import { NextRequest } from 'next/server';
import { json, notFound, onlyPost } from '@/lib/http/json-api';
import { createServiceClient, hasServiceKey } from '@/lib/supabase/admin';
import { parseRecoveryToken } from '@/lib/legal/request';
import { readBoundedJson, revocationClientIp } from '@/lib/legal/api';
import { isRevocationEnabled } from '@/lib/legal/flag';

type Item = { code: string; received_at: string; status: string };

// Canje del enlace privado (un solo uso, 30 minutos). El token llega por POST desde el fragmento (#t=...)
// de la URL: nunca viaja en la ruta ni en la query, así no queda en registros ni en el Referer.
export async function POST(request: NextRequest) {
  // Apagado (predeterminado): la ruta no existe.
  if (!isRevocationEnabled()) return notFound();
  const read = await readBoundedJson(request, 512);
  if ('response' in read) return read.response;
  const token = parseRecoveryToken(read.body);
  if (!token) return json({ error: 'invalid_or_expired' }, 404);
  const ip = revocationClientIp(request);
  if (!ip || !hasServiceKey()) return json({ error: 'unavailable' }, 503);
  try {
    const { data, error } = await createServiceClient().rpc('canjear_constancia_arrepentimiento', { p_token: token, p_ip: ip });
    if (error) return json({ error: 'unavailable' }, 503);
    const result = data as { limited?: boolean; invalid?: boolean; items?: Item[] } | null;
    if (result?.limited) return json({ error: 'rate_limited' }, 429);
    if (!result?.items) return json({ error: 'invalid_or_expired' }, 404);
    // Información mínima de la constancia: código, fecha de recepción y estado.
    return json({ items: result.items.map((i) => ({ code: i.code, receivedAt: i.received_at, status: i.status })) });
  } catch { return json({ error: 'unavailable' }, 503); }
}
export const { GET, PUT, PATCH, DELETE } = onlyPost;
export const HEAD = notFound;
