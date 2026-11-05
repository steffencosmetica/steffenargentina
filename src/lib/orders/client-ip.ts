// IP del cliente para los límites antiabuso (crear_pedido, arrepentimiento, recuperación).
//
// Nunca se usa una IP que mande el navegador (un campo del formulario, o un X-Forwarded-For escrito por el
// cliente): solo la que agrega un proxy de confianza CONFIGURADO EXPLÍCITAMENTE. La base no guarda la IP:
// la convierte en un HMAC con una clave secreta propia.
//
// Proxies admitidos (ver docs/proxy-traefik.md):
//   - vercel:  VERCEL=1. El borde de Vercel reemplaza x-real-ip / x-forwarded-for con la IP real.
//   - traefik: STEFFEN_TRUSTED_PROXY=traefik (VPS con Dokploy). Traefik borra las cabeceras X-Forwarded-* y
//              X-Real-Ip que manda un cliente no confiable y fija X-Real-Ip con la dirección TCP real. Además
//              se exige una cabecera secreta que solo agrega nuestro middleware de Traefik, se valida la
//              cadena completa y se rechazan direcciones privadas (señal de que Traefik no ve al cliente real).
//   - none:    sin proxy. Solo en entorno local se usa LOCAL_DEV_IP.
// Cualquier configuración incompleta o desconocida falla CERRADO: sin IP confiable no hay operación.

import { BlockList, isIP } from 'node:net';
import { createHash, timingSafeEqual } from 'node:crypto';

export type TrustedProxy = 'vercel' | 'traefik' | 'none' | 'invalid';

type Env = Record<string, string | undefined>;
type HeaderSource = Pick<Headers, 'get'>;

/** Cabecera que agrega SOLO el middleware de Traefik (reemplaza la que mande el cliente). */
export const PROXY_AUTH_HEADER = 'x-steffen-proxy-auth';
/** Máximo de saltos aceptados en X-Forwarded-For (cadenas más largas se rechazan). */
const MAX_HOPS = 5;

/** Proxy de confianza según el entorno. Un valor desconocido de STEFFEN_TRUSTED_PROXY es «invalid». */
export function trustedProxyFromEnv(env: Env): TrustedProxy {
  if (env.VERCEL === '1') return 'vercel';
  const configured = env.STEFFEN_TRUSTED_PROXY;
  if (configured === undefined || configured === '') return 'none';
  return configured === 'traefik' ? 'traefik' : 'invalid';
}

/** IP válida en forma canónica (IPv4 mapeada a IPv6 → IPv4; IPv6 en minúsculas, sin corchetes ni zona). */
export function normalizeIp(value: string | null | undefined): string | null {
  if (!value) return null;
  let ip = value.trim().replace(/^\[(.*)\]$/, '$1');
  if (ip.length > 64) return null;
  if (isIP(ip) === 6) {
    ip = ip.toLowerCase();
    if (ip.includes('%')) return null; // zona de interfaz: nunca es una IP pública de cliente
    const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/.exec(ip);
    if (mapped && isIP(mapped[1]) === 4) return mapped[1];
    return ip;
  }
  return isIP(ip) === 4 ? ip : null;
}

const family = (ip: string) => (isIP(ip) === 6 ? 'ipv6' : 'ipv4');

function sameIp(a: string, b: string): boolean {
  if (isIP(a) !== isIP(b)) return false;
  const list = new BlockList();
  list.addAddress(a, family(a));
  return list.check(b, family(b));
}

// Direcciones que nunca identifican a un comprador en Internet.
const NON_PUBLIC = new BlockList();
for (const [net, prefix] of [['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8], ['169.254.0.0', 16], ['172.16.0.0', 12],
  ['192.0.0.0', 24], ['192.168.0.0', 16], ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4]] as const) NON_PUBLIC.addSubnet(net, prefix, 'ipv4');
for (const [net, prefix] of [['::', 128], ['::1', 128], ['fc00::', 7], ['fe80::', 10], ['ff00::', 8], ['64:ff9b:1::', 48]] as const) NON_PUBLIC.addSubnet(net, prefix, 'ipv6');

export function isPublicIp(ip: string): boolean {
  return !NON_PUBLIC.check(ip, family(ip));
}

export type TraefikConfig = { secretDigest: Buffer; upstream: BlockList | null; allowPrivateClients: boolean };

/**
 * Configuración de Traefik desde el entorno, o null si está incompleta o es inválida (→ falla cerrado):
 *   STEFFEN_PROXY_SECRET               ≥ 32 caracteres; el middleware de Traefik lo envía en X-Steffen-Proxy-Auth.
 *   STEFFEN_TRUSTED_UPSTREAM_CIDRS     opcional: proxies ANTERIORES a Traefik (p. ej. rangos de Cloudflare),
 *                                      separados por coma. Deben coincidir con forwardedHeaders.trustedIPs.
 *   STEFFEN_PROXY_ALLOW_PRIVATE_CLIENTS=1  SOLO pruebas locales con clientes en una red Docker privada.
 */
export function traefikConfigFromEnv(env: Env): TraefikConfig | null {
  const secret = env.STEFFEN_PROXY_SECRET ?? '';
  if (secret.length < 32 || /\s/.test(secret)) return null;
  let upstream: BlockList | null = null;
  const cidrs = (env.STEFFEN_TRUSTED_UPSTREAM_CIDRS ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  if (cidrs.length) {
    upstream = new BlockList();
    for (const cidr of cidrs) {
      const match = /^([^/]+)\/(\d{1,3})$/.exec(cidr);
      const ip = match ? normalizeIp(match[1]) : null;
      const prefix = match ? Number(match[2]) : NaN;
      if (!ip || !Number.isInteger(prefix) || prefix < 0 || prefix > (isIP(ip) === 6 ? 128 : 32)) return null;
      upstream.addSubnet(ip, prefix, family(ip));
    }
  }
  return { secretDigest: createHash('sha256').update(secret).digest(), upstream, allowPrivateClients: env.STEFFEN_PROXY_ALLOW_PRIVATE_CLIENTS === '1' };
}

/**
 * IP del cliente detrás de Traefik, o null si no se puede determinar con confianza.
 * 1. La cabecera secreta prueba que la request pasó por nuestro middleware de Traefik.
 * 2. X-Forwarded-For: todas las entradas deben ser IPs válidas (máx. MAX_HOPS).
 * 3. Sin proxies anteriores: exactamente UNA entrada, igual a X-Real-Ip (lo que Traefik escribe cuando el par
 *    TCP no es de confianza). Más entradas = Traefik confía en alguien que no declaramos → se rechaza.
 * 4. Con proxies anteriores: de derecha a izquierda, se saltean SOLO los declarados; la primera IP restante es
 *    el cliente. La entrada más a la derecha (el par TCP de Traefik) debe coincidir con X-Real-Ip o ser un
 *    proxy declarado.
 * 5. La IP resultante debe ser pública (salvo pruebas locales explícitas).
 */
export function traefikClientIp(headers: HeaderSource, config: TraefikConfig | null): string | null {
  return traefikClientIpDetail(headers, config).ip;
}

/** Motivo por el que no hay IP confiable (diagnóstico interno; nunca se expone en las API públicas). */
export type ProxyRejection = 'configuracion' | 'secreto' | 'sin_xff' | 'xff_invalido' | 'sin_x_real_ip' | 'cadena_inesperada' | 'sin_cliente' | 'ip_no_publica' | 'sin_proxy';

export function traefikClientIpDetail(headers: HeaderSource, config: TraefikConfig | null): { ip: string | null; reason: ProxyRejection | null; hops: number } {
  const fail = (reason: ProxyRejection, hops = 0) => ({ ip: null, reason, hops });
  if (!config) return fail('configuracion');
  const auth = headers.get(PROXY_AUTH_HEADER) ?? '';
  if (!auth || !timingSafeEqual(createHash('sha256').update(auth).digest(), config.secretDigest)) return fail('secreto');

  const raw = headers.get('x-forwarded-for');
  if (!raw) return fail('sin_xff');
  const parts = raw.split(',').map((p) => p.trim());
  if (parts.length > MAX_HOPS || parts.some((p) => !p)) return fail('xff_invalido', parts.length);
  const chain = parts.map(normalizeIp);
  if (chain.some((ip) => ip === null)) return fail('xff_invalido', parts.length);
  const hops = chain as string[];
  const realIp = normalizeIp(headers.get('x-real-ip'));
  if (!realIp) return fail('sin_x_real_ip', hops.length);

  let client: string | null = null;
  if (!config.upstream) {
    if (hops.length !== 1 || !sameIp(hops[0], realIp)) return fail('cadena_inesperada', hops.length);
    client = hops[0];
  } else {
    const upstream = config.upstream;
    const isUpstream = (ip: string) => upstream.check(ip, family(ip));
    const edge = hops[hops.length - 1];
    if (!sameIp(edge, realIp) && !isUpstream(edge)) return fail('cadena_inesperada', hops.length);
    for (let i = hops.length - 1; i >= 0; i--) {
      if (!isUpstream(hops[i])) {
        client = hops[i];
        break;
      }
    }
  }
  if (!client) return fail('sin_cliente', hops.length);
  if (!isPublicIp(client) && !config.allowPrivateClients) return fail('ip_no_publica', hops.length);
  return { ip: client, reason: null, hops: hops.length };
}

/**
 * IP del cliente según el proxy de confianza, o null si no hay una confiable.
 * - vercel: x-real-ip (la escribe Vercel); si faltara, el primer valor de x-vercel-forwarded-for.
 * - traefik: ver traefikClientIp (requiere la configuración del entorno).
 * - none / invalid: null. En desarrollo local el llamador usa LOCAL_DEV_IP explícitamente.
 */
export function trustedClientIp(headers: HeaderSource, proxy: TrustedProxy, env: Env = {}): string | null {
  if (proxy === 'vercel') return normalizeIp(headers.get('x-real-ip')) ?? normalizeIp(headers.get('x-vercel-forwarded-for')?.split(',')[0] ?? null);
  if (proxy === 'traefik') return traefikClientIp(headers, traefikConfigFromEnv(env));
  return null;
}

/** IP fija para `next dev` (sin proxy): todos los intentos locales cuentan como el mismo cliente. */
export const LOCAL_DEV_IP = '127.0.0.1';

/**
 * Entorno local de desarrollo o pruebas: fuera de Vercel, sin proxy configurado y con Supabase local o
 * `next dev`. Solo ahí se usa LOCAL_DEV_IP y se omite el desafío humano. En cualquier despliegue (Vercel o
 * VPS con Traefik) se falla CERRADO: sin IP confiable no se crean pedidos ni solicitudes, y sin Turnstile
 * implementado no se pasa el control antibots.
 */
export function isLocalEnvironment(env: Env): boolean {
  if (env.VERCEL || env.VERCEL_ENV) return false;
  if (env.STEFFEN_TRUSTED_PROXY) return false;
  let host = '';
  try {
    host = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname;
  } catch {
    host = '';
  }
  return host === '127.0.0.1' || host === 'localhost' || env.NODE_ENV !== 'production';
}

/**
 * IP para los límites antiabuso: la del proxy de confianza o, SOLO sin proxy configurado y en entorno local,
 * LOCAL_DEV_IP. Con un proxy configurado nunca se usa la IP fija: si el proxy no entrega una IP confiable,
 * null (nunca una identidad compartida por todos los compradores).
 */
export function clientIpFor(headers: HeaderSource, env: Env): string | null {
  const proxy = trustedProxyFromEnv(env);
  if (proxy !== 'none') return trustedClientIp(headers, proxy, env);
  return isLocalEnvironment(env) ? LOCAL_DEV_IP : null;
}
