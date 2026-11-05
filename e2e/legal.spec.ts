import { test, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import { CLIENTE, LOCAL_SUPABASE, localSql } from './local';
import { ADMIN_STATE } from './helpers';
import { IDS } from './global-setup';

const routes = ['terminos-y-condiciones','politica-de-privacidad','envios-y-entregas','cambios-y-devoluciones','arrepentimiento'];
test.beforeEach(() => { localSql('delete from public.revocation_requests'); });
test.afterEach(() => { localSql('delete from public.revocation_requests'); });

test('cinco páginas: metadata, enlaces, borradores y navegación', async ({ page }) => {
  for (const route of routes) {
    await page.goto(`/${route}`);
    await expect(page.locator('main h1')).toHaveCount(1);
    await expect(page.getByText('Borrador pendiente de aprobación', { exact: true })).toBeVisible();
    await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', `https://steffenargentina.com.ar/${route}`);
    await expect(page.locator('main')).not.toContainText('undefined');
  }
  await page.goto('/');
  await expect(page.locator('a.repentance-access')).toBeInViewport();
  for (const route of routes.slice(0,4)) await expect(page.locator(`footer a[href="/${route}"]`)).toHaveCount(1);
  await page.locator('a.repentance-access').click();
  await expect(page).toHaveURL(/\/arrepentimiento$/);
});

for (const width of [390,768,1440]) test(`legales responsive y accesibilidad básica ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  mkdirSync('artifacts/4b7', { recursive: true });
  for (const route of routes) {
    await page.goto(`/${route}`);
    await expect(page.locator('main h1')).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await expect(page.locator('main')).toHaveAttribute('id','contenido');
    await page.screenshot({ path: `artifacts/4b7/${route}-${width}.png`, fullPage: true });
  }
  await expect(page.getByLabel('Número de pedido o referencia de compra')).toBeVisible();
  await page.getByLabel('Número de pedido o referencia de compra').focus();
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Email de contacto', { exact: true })).toBeFocused();
});

test('solicitud anónima real: constancia, privacidad e idempotencia', async ({ page, request }) => {
  await page.goto('/arrepentimiento');
  await page.getByLabel('Número de pedido o referencia de compra').fill('COMPRA-FICTICIA-LEGAL');
  await page.getByLabel('Email de contacto', { exact: true }).fill('solicitud@example.test');
  await page.getByRole('button', { name: 'Solicitar arrepentimiento' }).click();
  await expect(page.getByRole('heading', { name: 'Solicitud recibida' })).toBeVisible();
  await expect(page.locator('.legal-receipt')).toContainText(/ARR-[A-F0-9]{32}/);
  await expect(page.locator('.legal-receipt')).toBeFocused();
  await page.emulateMedia({media:'print'});
  await expect(page.locator('.legal-receipt')).toBeVisible();
  await expect(page.locator('.legal-heading')).toBeHidden();
  await expect(page.locator('.repentance-access')).toBeHidden();
  await page.emulateMedia({media:'screen'});
  expect(page.url()).not.toContain('example');
  const input = { purchaseReference: 'OTRA-FICTICIA', email: 'otra@example.test', idempotencyKey: randomUUID(), website: '' };
  const response = await request.post('/api/arrepentimiento', { data: input });
  expect(response.status()).toBe(201);
  expect(response.headers()['cache-control']).toBe('no-store');
  expect(response.headers()['referrer-policy']).toBe('no-referrer');
  const receipt = await response.json();
  expect(Object.keys(receipt).sort()).toEqual(['code','receivedAt']);
  expect(await (await request.post('/api/arrepentimiento', { data: input })).json()).toEqual(receipt);
  expect(localSql("select count(*)::int as n from public.revocation_requests")).toEqual([{ n: 2 }]);
});

test('rechaza inválidos, otro origen, honeypot, cuerpos grandes y limita abuso', async ({ request }) => {
  const data = { purchaseReference: 'FICTICIA', email: 'persona@example.test', idempotencyKey: randomUUID(), website: '' };
  expect((await request.post('/api/arrepentimiento',{ data: { ...data, email: 'mal' } })).status()).toBe(422);
  expect((await request.post('/api/arrepentimiento',{ data: { ...data, website: 'bot' } })).status()).toBe(422);
  expect((await request.post('/api/arrepentimiento',{ data, headers: { origin: 'https://otro.test' } })).status()).toBe(403);
  expect((await request.post('/api/arrepentimiento',{ data: { ...data, purchaseReference: 'x'.repeat(5000) } })).status()).toBe(413);
  expect((await request.get('/api/arrepentimiento')).status()).toBe(404);
  const concurrent = await Promise.all(Array.from({length:10}, () => request.post('/api/arrepentimiento',{ data: { ...data, idempotencyKey: randomUUID() } })));
  expect(concurrent.filter(r => r.status() === 201)).toHaveLength(5);
  expect(concurrent.filter(r => r.status() === 429)).toHaveLength(5);
  const limited = await request.post('/api/arrepentimiento',{ data: { ...data, idempotencyKey: randomUUID() } });
  expect(limited.status()).toBe(429); expect(await limited.text()).not.toContain(data.email);
});

test('constancia perdida después de persistir: reintento recupera el mismo código', async ({ page }) => {
  let committed: {code:string;receivedAt:string} | undefined;
  let originalKey: string | undefined;
  await page.route('**/api/arrepentimiento', async route => {
    originalKey = route.request().postDataJSON().idempotencyKey;
    const response = await route.fetch();
    expect(response.status()).toBe(201);
    committed = await response.json();
    await route.abort('failed');
  }, {times:1});
  await page.goto('/arrepentimiento');
  await page.getByLabel('Número de pedido o referencia de compra').fill('CONSTANCIA-PERDIDA-FICTICIA');
  await page.getByLabel('Email de contacto', {exact:true}).fill('constancia@example.test');
  await page.getByRole('button',{name:'Solicitar arrepentimiento'}).click();
  await expect(page.locator('main [role="alert"]')).toBeVisible();
  expect(committed?.code).toMatch(/^ARR-[A-F0-9]{32}$/);
  expect(localSql('select count(*)::int as n from public.revocation_requests')).toEqual([{n:1}]);
  const retry = page.waitForRequest(r=>r.url().endsWith('/api/arrepentimiento') && r.method()==='POST');
  await page.getByRole('button',{name:'Solicitar arrepentimiento'}).click();
  expect((await retry).postDataJSON().idempotencyKey).toBe(originalKey);
  await expect(page.locator('.legal-receipt')).toContainText(committed!.code);
  expect(localSql('select count(*)::int as n from public.revocation_requests')).toEqual([{n:1}]);
  expect(localSql('select count(*)::int as n from public.revocation_events')).toEqual([{n:1}]);
});

test('recepción inaccesible no muestra constancia ficticia y duplicados simultáneos conservan código', async ({ page, request }) => {
  await page.route('**/api/arrepentimiento', route=>route.fulfill({status:503,contentType:'application/json',body:'{"error":"unavailable"}'}));
  await page.goto('/arrepentimiento');
  await page.getByLabel('Número de pedido o referencia de compra').fill('SIN-RECEPCION-FICTICIA');
  await page.getByLabel('Email de contacto',{exact:true}).fill('sinrecepcion@example.test');
  await page.getByRole('button',{name:'Solicitar arrepentimiento'}).click();
  await expect(page.locator('main [role="alert"]')).toBeVisible();
  await expect(page.locator('.legal-receipt')).toHaveCount(0);
  expect(localSql('select count(*)::int as n from public.revocation_requests')).toEqual([{n:0}]);
  const data={purchaseReference:'DUPLICADO-FICTICIO',email:'duplicado@example.test',idempotencyKey:randomUUID(),website:''};
  const responses=await Promise.all(Array.from({length:10},()=>request.post('/api/arrepentimiento',{data})));
  expect(responses.every(r=>r.status()===201)).toBe(true);
  const receipts=await Promise.all(responses.map(r=>r.json()));
  expect(new Set(receipts.map(r=>r.code)).size).toBe(1);
  expect(localSql('select count(*)::int as n from public.revocation_requests')).toEqual([{n:1}]);
});

test('administración protegida: gestión e historial; dos administradores evitan sobrescritura', async ({ browser, request }) => {
  expect((await request.get('/admin/arrepentimientos', { maxRedirects: 0 })).status()).toBe(307);
  await request.post('/api/arrepentimiento',{ data: { purchaseReference: 'ADMIN-FICTICIA', email: 'adminsolicitud@example.test', idempotencyKey: randomUUID(), website: '' } });
  const a = await browser.newContext({ storageState: ADMIN_STATE }); const b = await browser.newContext({ storageState: ADMIN_STATE });
  try {
    const first = await a.newPage(), second = await b.newPage();
    const adminResponse = await first.goto('/admin/arrepentimientos'); await second.goto('/admin/arrepentimientos');
    expect(adminResponse?.headers()['cache-control']).toContain('no-store');
    for (const width of [390,768,1440]) {
      await first.setViewportSize({width,height:1000});
      expect(await first.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await first.screenshot({path:`artifacts/4b7/admin-arrepentimientos-${width}.png`,fullPage:true});
    }
    first.on('dialog', d => d.accept()); second.on('dialog', d => d.accept());
    await first.getByRole('button',{name:'Comenzar gestión'}).click();
    await expect(first.getByRole('button',{name:'Cerrar solicitud'})).toBeVisible();
    await second.getByRole('button',{name:'Comenzar gestión'}).click();
    await expect(second.locator('main [role="alert"]')).toContainText('La solicitud cambió');
    await first.getByRole('button',{name:'Cerrar solicitud'}).click();
    await expect(first.getByText('Cerrada',{exact:true})).toBeVisible();
    expect(localSql('select count(*)::int as n from public.revocation_events')).toEqual([{n:3}]);
  } finally { await a.close(); await b.close(); }
});

test('API Supabase no expone solicitudes ni permite gestión a anon o cliente', async ({ request }) => {
  await request.post('/api/arrepentimiento',{data:{purchaseReference:'PRIVADO-FICTICIO',email:'privado@example.test',idempotencyKey:randomUUID(),website:''}});
  const auth = await request.post(`${LOCAL_SUPABASE.url}/auth/v1/token?grant_type=password`, {headers:{apikey:LOCAL_SUPABASE.publishableKey},data:{email:CLIENTE.email,password:CLIENTE.password}});
  expect(auth.ok()).toBe(true);
  const session = await auth.json();
  for (const token of [null,session.access_token]) {
    const headers: Record<string,string> = {apikey:LOCAL_SUPABASE.publishableKey,...(token ? {Authorization:`Bearer ${token}`} : {})};
    const read = await request.get(`${LOCAL_SUPABASE.url}/rest/v1/revocation_requests?select=code,contact_email`,{headers});
    if (token) { expect(read.status()).toBe(200); expect(await read.json()).toEqual([]); }
    else expect(read.status()).toBe(401);
    const write = await request.post(`${LOCAL_SUPABASE.url}/rest/v1/rpc/admin_gestionar_arrepentimiento`,{headers,data:{p_id:randomUUID(),p_version:0,p_status:'en_gestion'}});
    expect([401,403]).toContain(write.status());
    expect(await write.text()).not.toContain('privado@example.test');
  }
});

test('checkout local enlaza documentos y exige aceptación sin habilitar compras', async ({ page }) => {
  await page.addInitScript((id) => localStorage.setItem('steffen-carrito-v1', JSON.stringify({version:1,items:[{productId:id,quantity:1}]})), IDS.productoBase);
  await page.goto('/checkout');
  const form = page.getByTestId('ck-form');
  await expect(form).toBeVisible();
  await expect(form.locator('a[href="/terminos-y-condiciones"]')).toBeVisible();
  await expect(form.locator('a[href="/politica-de-privacidad"]')).toBeVisible();
  await expect(form.getByRole('checkbox')).not.toBeChecked();
  await form.getByRole('checkbox').check();
  await expect(form.getByRole('checkbox')).toBeChecked();
  await expect(page.getByTestId('ck-disabled')).toBeVisible();
  await expect(page.getByTestId('ck-submit')).toBeDisabled();
  await page.setViewportSize({width:390,height:844});
  const button = await page.locator('.repentance-access').boundingBox();
  const bar = await page.getByTestId('ck-bar').boundingBox();
  expect(button && bar && button.y + button.height <= bar.y).toBeTruthy();
  expect(localSql('select checkout_enabled from public.store_settings where id')).toEqual([{checkout_enabled:false}]);
});
