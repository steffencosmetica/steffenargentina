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

test('la ruta de cotización no existe', async ({ request }) => {
  const post = await request.post('/api/carrito/cotizar', { data: { items: [{ productId: IDS.productoBase, quantity: 1 }] } });
  expect(post.status()).toBe(404);
  expect(await post.text()).not.toContain('price');
  expect((await request.get('/api/carrito/cotizar')).status()).toBe(404);
});
