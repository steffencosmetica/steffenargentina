import { expect, test } from '@playwright/test';
import { IDS } from './global-setup';

// Con el carrito apagado (build sin STEFFEN_CART_ENABLED=1) el sitio queda como antes de la Fase 4B.4.

const PAGES = ['/', '/tienda', '/tienda/shampoo-base-e2e', '/productos', '/triples'];

for (const path of PAGES) {
  test(`sin carrito en ${path}`, async ({ page }) => {
    await page.goto(path);
    await expect(page.locator('body')).toBeVisible();
    await expect(page.getByTestId('cart-button')).toHaveCount(0);
    await expect(page.getByTestId('add-to-cart')).toHaveCount(0);
    await expect(page.getByTestId('cart-drawer')).toHaveCount(0);
    expect(await page.content()).not.toContain('steffen-carrito-v1');
  });
}

test('la ficha sigue ofreciendo la consulta por WhatsApp como acción principal', async ({ page }) => {
  await page.goto('/tienda/shampoo-base-e2e');
  const whatsapp = page.getByTestId('whatsapp-consult');
  await expect(whatsapp).toBeVisible();
  await expect(whatsapp).toHaveClass('store-btn');
});

test('el checkout y el seguimiento no existen (aunque esté la clave de servidor)', async ({ page, request }) => {
  for (const path of ['/checkout', '/pedido/STF-2611-ABCD']) {
    const response = await page.goto(path);
    expect(response?.status(), path).toBe(404);
    await expect(page.getByTestId('ck-form')).toHaveCount(0);
  }
  const item = { productId: IDS.productoBase, quantity: 1 };
  const calls = [
    request.post('/api/checkout/resumen', { data: { items: [item], provinceCode: 'AR-B' } }),
    request.post('/api/checkout/pedido', { data: { idempotencyKey: 'x'.repeat(43), form: {}, items: [item], expectedTotalCentavos: 100, acceptTerms: true } }),
    request.post('/api/pedido/consultar', { data: { code: 'STF-2611-ABCD', token: 'a'.repeat(43) } }),
  ];
  for (const response of await Promise.all(calls)) expect(response.status(), response.url()).toBe(404);
});

test('la ruta de cotización no existe', async ({ request }) => {
  const post = await request.post('/api/carrito/cotizar', { data: { items: [{ productId: IDS.productoBase, quantity: 1 }] } });
  expect(post.status()).toBe(404);
  expect(await post.text()).not.toContain('price');
  expect((await request.get('/api/carrito/cotizar')).status()).toBe(404);
});

// Fase 4B.7: sin STEFFEN_LEGAL_PAGES ni STEFFEN_REVOCATION_ENABLED (producción por defecto) los borradores
// legales y el Botón de Arrepentimiento no se publican, y el resto del sitio queda igual.
test('borradores legales y arrepentimiento ocultos por defecto', async ({ page, request }) => {
  for (const path of ['/terminos-y-condiciones', '/politica-de-privacidad', '/envios-y-entregas', '/cambios-y-devoluciones', '/arrepentimiento', '/arrepentimiento/recuperar']) {
    expect((await page.goto(path))?.status(), path).toBe(404);
  }
  for (const path of ['/api/arrepentimiento', '/api/arrepentimiento/recuperar', '/api/arrepentimiento/constancia']) {
    expect((await request.post(path, { data: {} })).status(), path).toBe(404);
  }
  for (const path of ['/', '/productos', '/tienda']) {
    expect((await page.goto(path))?.status(), path).toBe(200);
    await expect(page.locator('.repentance-access')).toHaveCount(0);
    await expect(page.locator('footer .footer-legal')).toHaveCount(0);
    await expect(page.locator('footer a[href="/productos"]')).toHaveCount(1);
  }
});
