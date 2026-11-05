import { test, expect } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PROXY_E2E, localSql } from './local';
import { IDS, seedBaseCatalog } from './global-setup';

// Fase 4B.8 — IP del cliente detrás de Traefik REAL. Cada request la hace un contenedor curl con su propia IP
// en la red Docker del arnés, contra Traefik (no contra Next). La IP que usó Next se verifica por su efecto
// en la base: revocation_requests.ip_hash = private.hash_ip(<IP esperada>). Nunca se expone la IP en la API.

type Reply = { status: number; body: string };

function curl(fromIp: string, url: string, headers: Record<string, string>, body?: unknown): Reply {
  const args = ['run', '--rm', '--network', PROXY_E2E.network, fromIp.includes(':') ? '--ip6' : '--ip', fromIp,
    ...(url.includes('host.docker.internal') ? ['--add-host', 'host.docker.internal:host-gateway'] : []),
    PROXY_E2E.curlImage, '-sS', '-m', '30', '-o', '-', '-w', '\n__STATUS__%{http_code}'];
  for (const [k, v] of Object.entries(headers)) args.push('-H', `${k}: ${v}`);
  if (body !== undefined) args.push('-H', 'Content-Type: application/json', '-X', 'POST', '--data', JSON.stringify(body));
  args.push(url);
  const out = execFileSync('docker', args, { encoding: 'utf8' });
  const at = out.lastIndexOf('\n__STATUS__');
  return { status: Number(out.slice(at + '\n__STATUS__'.length)), body: out.slice(0, at) };
}

const viaTraefik = (fromIp: string, headers: Record<string, string> = {}) =>
  curl(fromIp, `http://${PROXY_E2E.traefik.ip4}/api/arrepentimiento`, headers, revocation());
const revocation = () => ({ purchaseReference: `PROXY-${randomUUID().slice(0, 8)}`, email: 'proxy@example.test', idempotencyKey: randomUUID(), website: '' });

/** ¿La última solicitud registrada se asoció a esta IP? (sin leer ni exponer la IP real) */
function lastHashIs(ip: string): boolean {
  const [row] = localSql(`select r.ip_hash = private.hash_ip('${ip}'::inet) as ok from public.revocation_requests r order by received_at desc limit 1`) as { ok: boolean }[];
  return row?.ok === true;
}
const count = () => (localSql('select count(*)::int as n from public.revocation_requests') as { n: number }[])[0].n;

const FORGED = { 'X-Forwarded-For': '1.2.3.4', 'X-Real-Ip': '9.9.9.9', 'X-Steffen-Proxy-Auth': 'falsificado-por-el-cliente-0000000000000' };

test.beforeEach(() => { localSql('delete from public.revocation_requests'); });

test('Traefik real: borra las cabeceras falsificadas y Next usa la IP TCP del cliente', () => {
  const r = viaTraefik(PROXY_E2E.clients.a, FORGED);
  expect(r.status, r.body).toBe(201);
  expect(lastHashIs(PROXY_E2E.clients.a)).toBe(true);
  expect(lastHashIs('1.2.3.4')).toBe(false);
  expect(lastHashIs('9.9.9.9')).toBe(false);
  expect(r.body).not.toContain(PROXY_E2E.clients.a);
});

test('usuarios distintos no se agrupan: cada IP tiene su propio límite antiabuso', () => {
  for (let i = 0; i < 5; i++) expect(viaTraefik(PROXY_E2E.clients.a).status).toBe(201);
  // el sexto de A queda limitado (5 por hora y por IP)…
  expect(viaTraefik(PROXY_E2E.clients.a).status).toBe(429);
  // …ni siquiera falsificando otra IP…
  expect(viaTraefik(PROXY_E2E.clients.a, FORGED).status).toBe(429);
  // …mientras B, otra persona, sigue pudiendo enviar su solicitud
  expect(viaTraefik(PROXY_E2E.clients.b).status).toBe(201);
  expect(lastHashIs(PROXY_E2E.clients.b)).toBe(true);
  expect(count()).toBe(6);
});

test('IPv6: el cliente se identifica por su dirección IPv6', () => {
  const r = curl(PROXY_E2E.clients.c6, `http://[${PROXY_E2E.traefik.ip6}]/api/arrepentimiento`, FORGED, revocation());
  expect(r.status, r.body).toBe(201);
  expect(lastHashIs(PROXY_E2E.clients.c6)).toBe(true);
});

test('acceso directo a Next sin pasar por Traefik: se rechaza aunque falsifique todas las cabeceras', () => {
  const direct = curl(PROXY_E2E.clients.a, `http://host.docker.internal:${PROXY_E2E.port}/api/arrepentimiento`, FORGED, revocation());
  expect(direct.status).toBe(503);
  const noHeaders = curl(PROXY_E2E.clients.a, `http://host.docker.internal:${PROXY_E2E.port}/api/arrepentimiento`, {}, revocation());
  expect(noHeaders.status).toBe(503);
  expect(count()).toBe(0);
});

test('Traefik mal configurado (forwardedHeaders.insecure): Next detecta la cadena y falla cerrado', () => {
  const r = curl(PROXY_E2E.clients.a, `http://${PROXY_E2E.insecure.ip4}/api/arrepentimiento`, FORGED, revocation());
  expect(r.status).toBe(503);
  // sin cabeceras falsificadas, el Traefik inseguro se comporta igual que el correcto
  const clean = curl(PROXY_E2E.clients.b, `http://${PROXY_E2E.insecure.ip4}/api/arrepentimiento`, {}, revocation());
  expect(clean.status).toBe(201);
  expect(lastHashIs(PROXY_E2E.clients.b)).toBe(true);
  expect(count()).toBe(1);
});

test('la recuperación también exige IP confiable y el checkout sigue cerrado', () => {
  const ok = curl(PROXY_E2E.clients.a, `http://${PROXY_E2E.traefik.ip4}/api/arrepentimiento/recuperar`, FORGED, { email: 'proxy@example.test', website: '' });
  expect(ok.status).toBe(202);
  const direct = curl(PROXY_E2E.clients.a, `http://host.docker.internal:${PROXY_E2E.port}/api/arrepentimiento/recuperar`, FORGED, { email: 'proxy@example.test', website: '' });
  expect(direct.status).toBe(503);
  // páginas legales apagadas en este build: el checkout no existe (enclavamiento 4B.8)
  const checkout = curl(PROXY_E2E.clients.a, `http://${PROXY_E2E.traefik.ip4}/api/checkout/pedido`, {}, {});
  expect(checkout.status).toBe(404);
  localSql(`do $$ begin delete from private.revocation_rate_events; delete from public.revocation_messages; end $$`);
});

test('regresión 4B.8: con carrito y clave de servidor pero sin páginas legales, no hay checkout', async ({ page, request }) => {
  seedBaseCatalog();
  await page.addInitScript((id) => localStorage.setItem('steffen-carrito-v1', JSON.stringify({ version: 1, items: [{ productId: id, quantity: 1 }] })), IDS.productoBase);
  // el carrito sí está encendido en este build…
  await page.goto('/tienda');
  await expect(page.getByTestId('cart-button').filter({ visible: true })).toHaveCount(1);
  // …pero Términos y Privacidad no están publicados, así que no se puede comprar
  expect((await request.get('/terminos-y-condiciones')).status()).toBe(404);
  expect((await request.get('/politica-de-privacidad')).status()).toBe(404);
  for (const path of ['/checkout', '/pedido/STF-2611-ABCD']) expect((await page.goto(path))?.status(), path).toBe(404);
  for (const path of ['/api/checkout/pedido', '/api/checkout/resumen', '/api/pedido/consultar']) {
    expect((await request.post(path, { data: {} })).status(), path).toBe(404);
  }
  await page.goto('/tienda');
  await page.getByTestId('cart-button').filter({ visible: true }).click();
  const drawer = page.getByTestId('cart-drawer');
  await expect(drawer).toBeVisible();
  await expect(drawer.getByTestId('cart-line')).toHaveCount(1);
  await expect(drawer.getByRole('link', { name: 'Finalizar compra' })).toHaveCount(0);
  await expect(drawer.getByRole('button', { name: 'Finalizar compra' })).toBeDisabled();
  expect(localSql('select count(*)::int as n from public.orders')).toEqual([{ n: 0 }]);
  localSql(`do $$ begin delete from public.products; delete from public.categories; end $$`);
});

test('diagnóstico de aceptación (mismo procedimiento que en el VPS): IP efectiva o motivo del rechazo', () => {
  const auth = { Authorization: `Bearer ${PROXY_E2E.diagnosticToken}` };
  const ok = curl(PROXY_E2E.clients.a, `http://${PROXY_E2E.traefik.ip4}/api/interno/proxy`, { ...auth, ...FORGED });
  expect(ok.status).toBe(200);
  expect(JSON.parse(ok.body)).toEqual({ proxy: 'traefik', ip: PROXY_E2E.clients.a, reason: null, hops: 1, family: 'ipv4' });
  const v6 = curl(PROXY_E2E.clients.c6, `http://[${PROXY_E2E.traefik.ip6}]/api/interno/proxy`, auth);
  expect(JSON.parse(v6.body)).toMatchObject({ ip: PROXY_E2E.clients.c6, family: 'ipv6' });
  const insecure = curl(PROXY_E2E.clients.a, `http://${PROXY_E2E.insecure.ip4}/api/interno/proxy`, { ...auth, ...FORGED });
  expect(insecure.status).toBe(503);
  expect(JSON.parse(insecure.body)).toMatchObject({ ip: null, reason: 'cadena_inesperada', hops: 2 });
  const direct = curl(PROXY_E2E.clients.a, `http://host.docker.internal:${PROXY_E2E.port}/api/interno/proxy`, { ...auth, ...FORGED });
  expect(JSON.parse(direct.body)).toMatchObject({ ip: null, reason: 'secreto' });
  // sin el token de diagnóstico la ruta no existe
  expect(curl(PROXY_E2E.clients.a, `http://${PROXY_E2E.traefik.ip4}/api/interno/proxy`, {}).status).toBe(404);
});
