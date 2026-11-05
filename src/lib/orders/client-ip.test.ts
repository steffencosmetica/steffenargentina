import { test } from 'node:test';
import assert from 'node:assert/strict';
import { clientIpFor, isLocalEnvironment, isPublicIp, normalizeIp, traefikClientIp, traefikConfigFromEnv, trustedProxyFromEnv, PROXY_AUTH_HEADER } from './client-ip.ts';

const SECRET = 's'.repeat(40);
const VPS = { NODE_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: 'https://zzxlghpopmccwsaqbsko.supabase.co', STEFFEN_TRUSTED_PROXY: 'traefik', STEFFEN_PROXY_SECRET: SECRET };
const CF = { ...VPS, STEFFEN_TRUSTED_UPSTREAM_CIDRS: '173.245.48.0/20, 2400:cb00::/32' };

/** Request tal como la entrega Traefik (cabeceras ya saneadas por Traefik + secreto del middleware). */
function viaTraefik(xff: string | null, realIp: string | null, extra: Record<string, string> = {}, secret: string | null = SECRET) {
  const h = new Headers(extra);
  if (xff !== null) h.set('x-forwarded-for', xff);
  if (realIp !== null) h.set('x-real-ip', realIp);
  if (secret !== null) h.set(PROXY_AUTH_HEADER, secret);
  return h;
}

test('modo de proxy: explícito; valores desconocidos son inválidos y Vercel tiene prioridad', () => {
  assert.equal(trustedProxyFromEnv({}), 'none');
  assert.equal(trustedProxyFromEnv({ STEFFEN_TRUSTED_PROXY: 'traefik' }), 'traefik');
  for (const v of ['Traefik', 'nginx', 'true', '1', ' traefik']) assert.equal(trustedProxyFromEnv({ STEFFEN_TRUSTED_PROXY: v }), 'invalid', v);
  assert.equal(trustedProxyFromEnv({ VERCEL: '1', STEFFEN_TRUSTED_PROXY: 'traefik' }), 'vercel');
});

test('configuración de Traefik incompleta o inválida: falla cerrado', () => {
  assert.equal(traefikConfigFromEnv({}), null, 'sin secreto');
  assert.equal(traefikConfigFromEnv({ STEFFEN_PROXY_SECRET: 'corto' }), null);
  assert.equal(traefikConfigFromEnv({ STEFFEN_PROXY_SECRET: `${'a'.repeat(32)} b` }), null, 'con espacios');
  assert.equal(traefikConfigFromEnv({ STEFFEN_PROXY_SECRET: SECRET, STEFFEN_TRUSTED_UPSTREAM_CIDRS: '10.0.0.0/33' }), null);
  assert.equal(traefikConfigFromEnv({ STEFFEN_PROXY_SECRET: SECRET, STEFFEN_TRUSTED_UPSTREAM_CIDRS: 'cloudflare' }), null);
  assert.ok(traefikConfigFromEnv(CF));
  // proxy inválido o incompleto: nunca IP, ni siquiera la local
  assert.equal(clientIpFor(viaTraefik('203.0.113.10', '203.0.113.10'), { ...VPS, STEFFEN_TRUSTED_PROXY: 'nginx' }), null);
  assert.equal(clientIpFor(viaTraefik('203.0.113.10', '203.0.113.10'), { ...VPS, STEFFEN_PROXY_SECRET: undefined }), null);
  assert.equal(clientIpFor(new Headers(), { STEFFEN_TRUSTED_PROXY: 'traefik', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321' }), null, 'sin respaldo local');
});

test('Traefik directo: IPv4 e IPv6 válidos y usuarios distintos no se agrupan', () => {
  const a = clientIpFor(viaTraefik('203.0.113.10', '203.0.113.10'), VPS);
  const b = clientIpFor(viaTraefik('198.51.100.20', '198.51.100.20'), VPS);
  assert.equal(a, '203.0.113.10');
  assert.equal(b, '198.51.100.20');
  assert.notEqual(a, b);
  assert.equal(clientIpFor(viaTraefik('2001:DB8:0:0::7', '2001:db8::7'), VPS), '2001:db8:0:0::7'.toLowerCase());
  assert.equal(clientIpFor(viaTraefik('::ffff:203.0.113.5', '203.0.113.5'), VPS), '203.0.113.5', 'IPv4 mapeada');
});

test('Traefik: cabecera secreta ausente, incorrecta o falsificada por el cliente → sin IP', () => {
  assert.equal(clientIpFor(viaTraefik('203.0.113.10', '203.0.113.10', {}, null), VPS), null, 'acceso directo a Next sin pasar por Traefik');
  assert.equal(clientIpFor(viaTraefik('203.0.113.10', '203.0.113.10', {}, 'x'.repeat(40)), VPS), null);
  assert.equal(clientIpFor(viaTraefik('203.0.113.10', '203.0.113.10', {}, SECRET.slice(1)), VPS), null);
});

test('Traefik: cadenas que no coinciden con la configuración real se rechazan (sin posición fija)', () => {
  // el cliente intentó anteponer IPs y Traefik confió en un proxy que no declaramos: más de un salto
  assert.equal(clientIpFor(viaTraefik('1.2.3.4, 203.0.113.10', '203.0.113.10'), VPS), null);
  // X-Real-Ip distinto del salto registrado
  assert.equal(clientIpFor(viaTraefik('203.0.113.10', '198.51.100.20'), VPS), null);
  // ausencias
  assert.equal(clientIpFor(viaTraefik(null, '203.0.113.10'), VPS), null);
  assert.equal(clientIpFor(viaTraefik('203.0.113.10', null), VPS), null);
  assert.equal(clientIpFor(viaTraefik(null, null), VPS), null);
});

test('Traefik: valores inválidos o maliciosos en las cabeceras', () => {
  for (const xff of ['evil', '203.0.113.10;drop', '203.0.113.10,', ',203.0.113.10', '203.0.113.256', '203.0.113.10:443', 'fe80::1%eth0', '', 'x'.repeat(200)]) {
    assert.equal(clientIpFor(viaTraefik(xff, '203.0.113.10'), VPS), null, JSON.stringify(xff));
  }
  assert.equal(clientIpFor(viaTraefik(Array(6).fill('173.245.48.1').join(', '), '173.245.48.1'), CF), null, 'demasiados saltos');
});

test('Traefik: direcciones privadas, loopback o internas nunca identifican a un comprador', () => {
  for (const ip of ['127.0.0.1', '10.0.0.5', '172.17.0.1', '192.168.1.10', '100.64.0.1', '169.254.1.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::']) {
    assert.equal(isPublicIp(normalizeIp(ip)!), false, ip);
    assert.equal(clientIpFor(viaTraefik(ip, ip), VPS), null, `Traefik detrás de NAT/Docker vería ${ip} para todos`);
  }
  assert.equal(isPublicIp('203.0.113.10'), true);
  assert.equal(clientIpFor(viaTraefik('172.30.0.11', '172.30.0.11'), { ...VPS, STEFFEN_PROXY_ALLOW_PRIVATE_CLIENTS: '1' }), '172.30.0.11', 'solo pruebas locales');
});

test('Traefik con proxies anteriores declarados (p. ej. Cloudflare): se saltean solo los declarados', () => {
  assert.equal(clientIpFor(viaTraefik('203.0.113.10, 173.245.48.7', '173.245.48.7'), CF), '203.0.113.10');
  assert.equal(clientIpFor(viaTraefik('2001:db8::9, 2400:cb00::1', '2400:cb00::1'), CF), '2001:db8::9');
  // el cliente intenta inyectar una IP a la izquierda: se toma la más cercana no declarada
  assert.equal(clientIpFor(viaTraefik('1.2.3.4, 203.0.113.10, 173.245.48.7', '173.245.48.7'), CF), '203.0.113.10');
  // acceso directo a Traefik (sin pasar por Cloudflare): el par TCP es el cliente
  assert.equal(clientIpFor(viaTraefik('198.51.100.20', '198.51.100.20'), CF), '198.51.100.20');
  // el salto más cercano no es un proxy declarado ni coincide con X-Real-Ip
  assert.equal(clientIpFor(viaTraefik('203.0.113.10, 198.51.100.99', '173.245.48.7'), CF), null);
  // toda la cadena son proxies: no hay cliente
  assert.equal(clientIpFor(viaTraefik('173.245.48.8, 173.245.48.7', '173.245.48.7'), CF), null);
  assert.equal(traefikClientIp(viaTraefik('203.0.113.10', '203.0.113.10'), null), null);
});

test('sin proxy: IP local solo en entorno local; Vercel conserva su comportamiento', () => {
  const spoofed = new Headers({ 'x-forwarded-for': '203.0.113.9', 'x-real-ip': '203.0.113.9' });
  assert.equal(clientIpFor(spoofed, { NODE_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321' }), '127.0.0.1');
  assert.equal(clientIpFor(spoofed, { NODE_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: VPS.NEXT_PUBLIC_SUPABASE_URL }), null, 'VPS sin proxy configurado');
  assert.equal(clientIpFor(new Headers({ 'x-real-ip': '198.51.100.7' }), { VERCEL: '1' }), '198.51.100.7');
  assert.equal(clientIpFor(new Headers(), { VERCEL: '1' }), null);
  // con un proxy configurado nunca es entorno local: el control antibots no se omite
  assert.equal(isLocalEnvironment({ NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321', STEFFEN_TRUSTED_PROXY: 'traefik' }), false);
  assert.equal(isLocalEnvironment(VPS), false);
});

test('diagnóstico: informa el motivo del rechazo sin cambiar el resultado', async () => {
  const { traefikClientIpDetail } = await import('./client-ip.ts');
  const config = traefikConfigFromEnv(VPS);
  assert.deepEqual(traefikClientIpDetail(viaTraefik('203.0.113.10', '203.0.113.10'), config), { ip: '203.0.113.10', reason: null, hops: 1 });
  assert.equal(traefikClientIpDetail(viaTraefik('203.0.113.10', '203.0.113.10', {}, null), config).reason, 'secreto');
  assert.equal(traefikClientIpDetail(viaTraefik('1.2.3.4, 203.0.113.10', '203.0.113.10'), config).reason, 'cadena_inesperada');
  assert.equal(traefikClientIpDetail(viaTraefik('172.17.0.1', '172.17.0.1'), config).reason, 'ip_no_publica');
  assert.equal(traefikClientIpDetail(viaTraefik(null, '203.0.113.10'), config).reason, 'sin_xff');
  assert.equal(traefikClientIpDetail(viaTraefik('203.0.113.10', '203.0.113.10'), null).reason, 'configuracion');
});
