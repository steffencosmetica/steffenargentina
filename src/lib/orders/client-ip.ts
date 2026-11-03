// IP del comprador para los límites antiabuso de crear_pedido().
//
// Nunca se usa una IP que mande el navegador (un campo del formulario, o un X-Forwarded-For escrito
// por el cliente): solo la que agrega un proxy de confianza. En Vercel, el borde reemplaza
// x-real-ip y x-forwarded-for con la IP real de la conexión y no reenvía los valores que manda el
// cliente, así que en ese entorno son confiables. Fuera de un proxy conocido no hay IP confiable.
//
// La base no guarda la IP: crear_pedido() la convierte en un HMAC con una clave secreta propia.

import { isIP } from 'node:net';

export type TrustedProxy = 'vercel' | 'none';

type HeaderSource = Pick<Headers, 'get'>;

/** Proxy de confianza según el entorno: Vercel define VERCEL=1 en build y runtime. */
export function trustedProxyFromEnv(env: Record<string, string | undefined>): TrustedProxy {
  return env.VERCEL === '1' ? 'vercel' : 'none';
}

function normalize(value: string | null): string | null {
  if (!value) return null;
  const ip = value.trim().replace(/^\[(.*)\]$/, '$1');
  return isIP(ip) ? ip : null;
}

/**
 * IP del cliente según el proxy de confianza, o null si no hay una confiable.
 * - vercel: x-real-ip (la escribe Vercel); si faltara, el primer valor de x-vercel-forwarded-for.
 * - none: null. En desarrollo local el llamador usa LOCAL_DEV_IP explícitamente.
 */
export function trustedClientIp(headers: HeaderSource, proxy: TrustedProxy): string | null {
  if (proxy !== 'vercel') return null;
  return normalize(headers.get('x-real-ip')) ?? normalize(headers.get('x-vercel-forwarded-for')?.split(',')[0] ?? null);
}

/** IP fija para `next dev` (sin proxy): todos los intentos locales cuentan como el mismo cliente. */
export const LOCAL_DEV_IP = '127.0.0.1';
