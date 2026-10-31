import { expect, request as playwrightRequest, test, type Request } from '@playwright/test';
import { ADMIN_STATE } from './helpers';
import { CLIENTE, LOCAL_SUPABASE, localSql } from './local';

// Intenta ejecutar operaciones administrativas por fuera de la interfaz:
// reenvía una llamada real a un Server Action sin sesión y con un usuario sin permisos,
// y prueba escribir directo en la API de Supabase con la clave publicable.

const BASE_ID = '00000000-0000-4000-8000-00000000e2d1'; // producto de global-setup

function priceOfBase() {
  const [row] = localSql(`select price_ars::text as price from public.products where id = '${BASE_ID}'`) as { price: string }[];
  return row.price;
}

/** Hace un cambio de precio real como administrador y devuelve la request del Server Action. */
async function captureAdminAction(browser: import('@playwright/test').Browser) {
  const context = await browser.newContext({ storageState: ADMIN_STATE });
  const page = await context.newPage();
  await page.goto('/admin/productos');
  const row = page.getByTestId('product-row').filter({ hasText: 'E2E-BASE' });
  await row.getByLabel(/^Precio de /).fill('10.000');

  const actionRequest = page.waitForRequest((req: Request) => req.method() === 'POST' && Boolean(req.headers()['next-action']));
  await row.getByRole('button', { name: /^Guardar precio/ }).click();
  const req = await actionRequest;
  await expect(row.getByRole('status')).toHaveText('✓');
  const captured = { url: req.url(), headers: req.headers(), body: req.postDataBuffer() };
  await context.close();
  return captured;
}

function withPrice(body: Buffer, newPrice: string) {
  // el cuerpo es multipart/form-data; se reemplaza el valor del campo "price"
  return Buffer.from(body.toString('latin1').replace(/(name="[^"]*price"\r\n\r\n)[^\r]*/, `$1${newPrice}`), 'latin1');
}

test.describe('acceso directo a operaciones administrativas', () => {
  test('sin sesión, un Server Action reenviado no modifica nada', async ({ browser, baseURL }) => {
    const captured = await captureAdminAction(browser);
    expect(priceOfBase()).toBe('10000.00');

    const anon = await playwrightRequest.newContext({ baseURL });
    const headers = { ...captured.headers };
    delete headers.cookie;
    const res = await anon.post(captured.url, {
      headers,
      data: withPrice(captured.body!, '1'),
      maxRedirects: 0,
    });
    // el proxy corta antes de llegar a la acción y manda al login
    expect([303, 307, 308]).toContain(res.status());
    expect(res.headers().location).toContain('/admin/login');
    expect(priceOfBase()).toBe('10000.00');
    await anon.dispose();
  });

  test('con un usuario que no es administrador, el Server Action tampoco modifica nada', async ({ browser, baseURL }) => {
    const captured = await captureAdminAction(browser);

    // sesión válida de un usuario común, pedida directo a Supabase Auth local
    // (el login del panel la cerraría enseguida), guardada como la guarda @supabase/ssr
    const auth = await playwrightRequest.newContext({ extraHTTPHeaders: { apikey: LOCAL_SUPABASE.publishableKey } });
    const tokenRes = await auth.post(`${LOCAL_SUPABASE.url}/auth/v1/token?grant_type=password`, {
      data: { email: CLIENTE.email, password: CLIENTE.password },
    });
    expect(tokenRes.ok()).toBe(true);
    const session = await tokenRes.json();
    await auth.dispose();
    const cookie = `sb-127-auth-token=base64-${Buffer.from(JSON.stringify(session)).toString('base64url')}`;

    const other = await playwrightRequest.newContext({ baseURL });
    const headers = { ...captured.headers, cookie };
    const res = await other.post(captured.url, { headers, data: withPrice(captured.body!, '1'), maxRedirects: 0 });
    expect([303, 307, 308]).toContain(res.status());
    expect(res.headers().location).toContain('/admin/login');
    expect(priceOfBase()).toBe('10000.00');
    await other.dispose();
  });

  test('la API de Supabase rechaza escrituras con la clave publicable', async () => {
    const api = await playwrightRequest.newContext({ extraHTTPHeaders: { apikey: LOCAL_SUPABASE.publishableKey } });

    const patch = await api.patch(`${LOCAL_SUPABASE.url}/rest/v1/products?id=eq.${BASE_ID}`, { data: { price_ars: 1 } });
    expect(patch.status()).toBe(401);
    expect((await patch.json()).code).toBe('42501');

    const insert = await api.post(`${LOCAL_SUPABASE.url}/rest/v1/categories`, { data: { name: 'x', slug: 'x-anon' } });
    expect(insert.status()).toBe(401);

    const rpc = await api.post(`${LOCAL_SUPABASE.url}/rest/v1/rpc/set_primary_product_image`, { data: { p_image_id: BASE_ID } });
    expect(rpc.status()).toBe(401);

    const upload = await api.post(`${LOCAL_SUPABASE.url}/storage/v1/object/catalogo/productos/anon.png`, {
      headers: { 'content-type': 'image/png' },
      data: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    });
    expect(upload.ok()).toBe(false);

    // lectura pública: solo lo activo
    const read = await api.get(`${LOCAL_SUPABASE.url}/rest/v1/products?select=sku`);
    expect(read.ok()).toBe(true);
    expect(priceOfBase()).toBe('10000.00');
    await api.dispose();
  });
});

test.describe('con sesión de administrador', () => {
  test.use({ storageState: ADMIN_STATE });

  test('las páginas del panel no se guardan en caché compartida', async ({ page }) => {
    const res = await page.goto('/admin/productos');
    const cacheControl = res?.headers()['cache-control'] ?? '';
    expect(cacheControl).toMatch(/private|no-store|no-cache/);
  });
});
