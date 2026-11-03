import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { ADMIN_STATE, authCookies } from './helpers';
import { localSql, setLocalCheckout } from './local';
import { IDS } from './global-setup';
test.use({ storageState: ADMIN_STATE });
const CLEAN_FIXTURES = `
  delete from public.orders where id::text like 'bb600000-%';
  delete from public.products where id::text like 'bb600000-%';
  delete from public.categories where id::text like 'bb600000-%';
`;
// Cada caso empieza con sus 26 pedidos: notas, incidencias y entregas no pasan al siguiente test.
test.beforeEach(() => {
  localSql(`do $$ begin ${CLEAN_FIXTURES} ${readFileSync('supabase/tests/fixtures/admin-pedidos.inc','utf8')} end $$`);
});
test.afterEach(() => {
  try { localSql(`do $$ begin ${CLEAN_FIXTURES} end $$`); }
  finally { setLocalCheckout(false); }
});
test('pedidos: listado, búsqueda privada y paginación', async ({ page, browser }) => {
  // Reproduce el diagnóstico: sin override explícito este contexto ES administrador.
  const inherited = await browser.newContext();
  try {
    expect((await authCookies(inherited)).length).toBeGreaterThan(0);
    const inheritedPage = await inherited.newPage();
    await inheritedPage.goto('/admin/pedidos');
    await expect(inheritedPage).toHaveURL(/\/admin\/pedidos$/);
  } finally { await inherited.close(); }
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  expect(await authCookies(anonymous)).toHaveLength(0);
  const publicPage = await anonymous.newPage();
  for (const path of ['/admin/pedidos','/admin/pedidos/bb600000-0000-4000-8000-000000000026']) {
    await publicPage.goto(path);
    await expect(publicPage).toHaveURL(/\/admin\/login/);
    await expect(publicPage.getByText('Comprador Ficticio 26',{exact:true})).toHaveCount(0);
  }
  await anonymous.close();
  await page.goto('/admin/pedidos');
  await expect(page.getByRole('heading',{name:'26 pedidos'})).toBeVisible();
  await page.getByRole('link',{name:'Siguiente'}).click();
  await expect(page.getByText('Página 2 de 2')).toBeVisible();
  await page.getByLabel('Buscar por código, nombre o email').fill('ficticio26@steffen.test');
  await page.getByRole('button',{name:'Aplicar filtros'}).click();
  await expect(page.getByRole('heading',{name:'1 pedidos'})).toBeVisible();
  expect(page.url()).not.toContain('ficticio');
  await page.getByLabel('Pago',{exact:true}).selectOption('pending');
  await page.getByRole('button',{name:'Aplicar filtros'}).click();
  await expect(page.getByText('No hay pedidos para mostrar')).toBeVisible();
});
test('pedidos: detalle histórico, notas y conflicto entre administradores', async ({ page, context, browser }) => {
  const route='/admin/pedidos/bb600000-0000-4000-8000-000000000026';
  await page.goto(route); const second = await context.newPage(); await second.goto(route);
  await expect(page.getByText('Producto histórico',{exact:true})).toBeVisible();
  await expect(page.getByText('Zona histórica: Zona histórica ficticia')).toBeVisible();
  await page.getByLabel('Notas (hasta 2000 caracteres)').fill('Preparar con cuidado');
  const mutation = page.waitForRequest(r => r.method() === 'POST' && Boolean(r.headers()['next-action']));
  await page.getByRole('button',{name:'Guardar notas'}).click(); await expect(page.getByText('Cambios guardados.')).toBeVisible();
  const captured = await mutation;
  const headers = { ...captured.headers() }; delete headers.cookie;
  // El POST histórico devolvía 200 porque APIRequestContext usaba las cookies heredadas.
  // Se reenvía la versión ya consumida: SR004 evita otro guardado y otro evento.
  const inherited = await browser.newContext();
  try {
    expect((await authCookies(inherited)).length).toBeGreaterThan(0);
    const authenticatedReplay = await inherited.request.post(captured.url(), { headers, data: captured.postDataBuffer()!, maxRedirects: 0 });
    expect(authenticatedReplay.status()).toBe(200);
    expect(localSql(`select count(*)::int as n from public.order_events where order_id='bb600000-0000-4000-8000-000000000026' and event_type='notes_updated'`)).toEqual([{ n: 1 }]);
  } finally { await inherited.close(); }
  const anonymous = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  expect(await authCookies(anonymous)).toHaveLength(0);
  const denied = await anonymous.request.post(captured.url(), { headers, data: captured.postDataBuffer()!, maxRedirects: 0 });
  expect([303,307,308]).toContain(denied.status());
  await anonymous.close();
  await second.getByLabel('Notas (hasta 2000 caracteres)').fill('Texto viejo'); await second.getByRole('button',{name:'Guardar notas'}).click();
  await expect(second.getByText(/El pedido cambió/)).toBeVisible(); await second.close();
  const response = await page.reload(); expect(response!.headers()['cache-control']).toContain('no-store');
  await expect(page.getByLabel('Notas (hasta 2000 caracteres)')).toHaveValue('Preparar con cuidado');
  expect(await page.locator('body').innerText()).not.toMatch(/access_token_hash|request_fingerprint|idempotency_key_hash/);
  // Incidencias simuladas únicamente por SQL de fixtures, nunca desde el panel.
  localSql(`do $$ begin
    perform private.aplicar_pago('bb600000-0000-4000-8000-000000000025','ficticio-monto','approved',1);
    perform set_config('request.jwt.claim.sub','${IDS.admin}',true);
    perform public.admin_cancelar_pedido('bb600000-0000-4000-8000-000000000024');
    update public.products set stock=0 where id='bb600000-0000-4000-8000-000000000002';
    perform private.aplicar_pago('bb600000-0000-4000-8000-000000000024','ficticio-faltante','approved',1250);
    perform private.aplicar_pago('bb600000-0000-4000-8000-000000000023','ficticio-pago','approved',1250);
    perform private.aplicar_pago('bb600000-0000-4000-8000-000000000023','ficticio-duplicado','approved',1250);
  end $$`);
  await page.goto('/admin/pedidos/bb600000-0000-4000-8000-000000000025');
  await expect(page.getByText(/Monto incorrecto · revisión/)).toBeVisible();
  await expect(page.getByRole('button',{name:'Comenzar preparación'})).toHaveCount(0);
  await page.goto('/admin/pedidos/bb600000-0000-4000-8000-000000000023');
  await expect(page.getByText(/Pago duplicado · reintegro/)).toBeVisible();
  await expect(page.getByRole('button',{name:/reembolsar|marcar resuelto|aprobar pago/i})).toHaveCount(0);
  await page.goto('/admin/pedidos/bb600000-0000-4000-8000-000000000024');
  await expect(page.getByText(/Pago sin stock/)).toBeVisible();
  localSql(`update public.products set stock=1 where id='bb600000-0000-4000-8000-000000000002'`);
  await page.getByRole('button',{name:'Resolver faltante con stock disponible'}).click();
  await page.getByRole('button',{name:'Confirmar',exact:true}).click();
  await expect(page.getByRole('button',{name:'Comenzar preparación'})).toBeVisible();
});
test('pedidos: preparar, despachar, entregar y cancelar con confirmación', async ({ page }) => {
  await page.goto('/admin/pedidos/bb600000-0000-4000-8000-000000000026');
  await page.getByRole('button',{name:'Comenzar preparación'}).click();
  await page.getByRole('button',{name:'Confirmar',exact:true}).click();
  await expect(page.getByRole('button',{name:'Registrar despacho'})).toBeVisible();
  await page.getByLabel('Transportista',{exact:true}).fill('Transporte ficticio');
  await page.getByLabel('Código de seguimiento (opcional)').fill('PRUEBA-123');
  await page.getByLabel('Fecha de despacho (hora local del dispositivo)').fill(new Date(Date.now()-60000).toLocaleString('sv-SE').slice(0,16).replace(' ','T'));
  await page.getByRole('button',{name:'Registrar despacho'}).click();
  await page.getByRole('button',{name:'Confirmar',exact:true}).click();
  await expect(page.getByRole('button',{name:'Marcar entregado'})).toBeVisible();
  await page.getByRole('button',{name:'Marcar entregado'}).click();
  await page.getByRole('button',{name:'Confirmar',exact:true}).click();
  await expect(page.getByText('No hay transiciones disponibles para este estado.')).toBeVisible();
  await expect(page.getByText('Seguimiento: PRUEBA-123')).toBeVisible();
  await page.goto('/admin/pedidos/bb600000-0000-4000-8000-000000000001');
  await page.getByRole('button',{name:'Cancelar pedido'}).click();
  await page.getByRole('button',{name:'Confirmar',exact:true}).click();
  await expect(page.getByText('No hay transiciones disponibles para este estado.')).toBeVisible();
});

for (const width of [390,768,1440]) test(`pedidos: responsive ${width}`,async ({ page }) => {
  await page.setViewportSize({width,height:950});
  for (const [name,path] of [['listado','/admin/pedidos'],['detalle','/admin/pedidos/bb600000-0000-4000-8000-000000000026']]) {
    await page.goto(path); await expect(page.getByRole('heading',{level:1})).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({path:`artifacts/pedidos-${name}-${width}.png`,fullPage:true});
  }
});
