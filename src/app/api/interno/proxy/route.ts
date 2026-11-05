import { createHash, timingSafeEqual } from 'node:crypto';
import { NextRequest } from 'next/server';
import { json, notFound } from '@/lib/http/json-api';
import { traefikClientIpDetail, traefikConfigFromEnv, trustedProxyFromEnv } from '@/lib/orders/client-ip';

// Diagnóstico de la IP del cliente para la ACEPTACIÓN en el VPS (docs/proxy-traefik.md §6), sin habilitar
// ventas ni el arrepentimiento. GET con `Authorization: Bearer <STEFFEN_PROXY_DIAGNOSTIC_TOKEN>` a través de
// Traefik: devuelve la IP que Next usaría para QUIEN HACE LA CONSULTA (su propia IP) o el motivo del rechazo.
// Sin token configurado (≥ 32 caracteres) la ruta no existe. Retirar el token después de verificar.
export async function GET(request: NextRequest) {
  const expected = process.env.STEFFEN_PROXY_DIAGNOSTIC_TOKEN ?? '';
  if (expected.length < 32) return notFound();
  const given = request.headers.get('authorization')?.replace(/^Bearer\s+/i, '') ?? '';
  if (!timingSafeEqual(createHash('sha256').update(given).digest(), createHash('sha256').update(expected).digest())) return notFound();
  const proxy = trustedProxyFromEnv(process.env);
  if (proxy !== 'traefik') return json({ proxy, ip: null, reason: 'sin_proxy', hops: 0 });
  const detail = traefikClientIpDetail(request.headers, traefikConfigFromEnv(process.env));
  return json({ proxy, ...detail, family: detail.ip ? (detail.ip.includes(':') ? 'ipv6' : 'ipv4') : null }, detail.ip ? 200 : 503);
}
export { notFound as POST, notFound as PUT, notFound as PATCH, notFound as DELETE, notFound as HEAD };
