import { expect, test, type Page } from '@playwright/test';
import { seedBaseCatalog } from './global-setup';
import { ADMIN_STATE } from './helpers';
import { localSql } from './local';
import { invalidateCatalog, seedStore, STORE } from './tienda-data';

// Carrito (Fase 4B.4), con el build local que habilita STEFFEN_CART_ENABLED=1 contra Supabase local.
// Cada test usa un navegador nuevo (localStorage vacío). Los cambios de precio, stock o estado se hacen
// por SQL en la base local y se restauran al terminar cada test.

const KEY = 'steffen-carrito-v1';
const NEUTRO = '/tienda/shampoo-neutro-1000cc';

test.beforeAll(async ({ browser }) => {
  seedStore();
  await invalidateCatalog(browser);
});

// deja el catálogo de partida para los specs siguientes (categorías, productos…)
test.afterAll(() => seedBaseCatalog());

const cartButton = (page: Page) => page.getByTestId('cart-button').filter({ visible: true });
const drawer = (page: Page) => page.getByTestId('cart-drawer');
const lineOf = (page: Page, name: string) => drawer(page).getByTestId('cart-line').filter({ hasText: name });
// el botón de compra de la ficha (los productos relacionados tienen el suyo)
const fichaAdd = (page: Page) => page.locator('.store-product-actions').getByTestId('add-to-cart');
const cardButton = (page: Page, name: string) =>
  page.locator('li', { has: page.getByTestId('store-card').filter({ hasText: name }) }).getByTestId('add-to-cart');

function preload(page: Page, items: { productId: string; quantity: number }[] | string) {
  const value = typeof items === 'string' ? items : JSON.stringify({ version: 1, items });
  return page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [KEY, value] as const);
}

async function openCart(page: Page) {
  await cartButton(page).click();
  await expect(drawer(page)).toBeVisible();
}

function rellenos(n: number) {
  return (localSql(`select id from public.products where sku like 'TND-REL-%' order by sku limit ${n}`) as { id: string }[]).map((r) => r.id);
}

// ---------------------------------------------------------------------------

test('agregar desde la ficha: abre el carrito, muestra la cantidad y actualiza el contador', async ({ page }) => {
  await page.goto(NEUTRO);
  // WhatsApp sigue disponible como alternativa
  await expect(page.getByTestId('whatsapp-consult')).toHaveAttribute('href', /wa\.me|whatsapp/);
  await expect(page.getByTestId('whatsapp-consult')).toHaveClass(/store-btn-ghost/);

  await page.getByRole('button', { name: 'Agregar Shampoo Neutro 1000cc al carrito' }).click();
  await expect(drawer(page)).toBeVisible();
  await expect(drawer(page).getByTestId('cart-feedback')).toHaveText('Agregaste Shampoo Neutro 1000cc. Cantidad en el carrito: 1.');
  await expect(lineOf(page, 'Shampoo Neutro 1000cc')).toContainText('$ 12.550 c/u');
  await expect(drawer(page).getByTestId('cart-subtotal')).toHaveText('$ 12.550');
  await expect(page.getByTestId('cart-count').filter({ visible: true })).toHaveText('1');
  await expect(page.getByTestId('cart-announcer')).toContainText('Agregaste Shampoo Neutro 1000cc');
});

test('agregar desde una tarjeta: el botón está fuera del enlace y la tarjeta sigue llevando a la ficha', async ({ page }) => {
  await page.goto('/tienda');
  const button = cardButton(page, 'Bálsamo Lino');
  expect(await button.evaluate((el) => el.closest('a') === null)).toBe(true);
  await button.click();
  await expect(lineOf(page, 'Bálsamo Lino')).toContainText('$ 5.000 c/u');
  await page.keyboard.press('Escape');
  await expect(drawer(page)).toHaveCount(0);

  await page.getByTestId('store-card').filter({ hasText: 'Bálsamo Lino' }).locator('.store-card-name').click();
  await expect(page).toHaveURL(/\/tienda\/balsamo-lino$/);
  await expect(page.getByTestId('cart-count').filter({ visible: true })).toHaveText('1');
});

test('sumar, restar, quitar y carrito vacío', async ({ page }) => {
  await preload(page, [{ productId: STORE.neutro, quantity: 1 }]);
  await page.goto('/tienda');
  await openCart(page);
  const line = lineOf(page, 'Shampoo Neutro 1000cc');
  await line.getByRole('button', { name: /^Sumar una unidad/ }).click();
  await expect(line.getByTestId('cart-line-qty')).toHaveText('2');
  await expect(line.getByTestId('cart-line-total')).toHaveText('$ 25.100');
  await expect(drawer(page).getByTestId('cart-subtotal')).toHaveText('$ 25.100');
  await line.getByRole('button', { name: /^Restar una unidad/ }).click();
  await expect(line.getByTestId('cart-line-qty')).toHaveText('1');
  await expect(line.getByRole('button', { name: /^Restar una unidad/ })).toBeDisabled();
  await line.getByRole('button', { name: /^Quitar/ }).click();
  await expect(drawer(page).getByTestId('cart-empty')).toContainText('Tu carrito está vacío.');
  await expect(page.getByTestId('cart-count')).toHaveCount(0);
  await drawer(page).getByRole('link', { name: 'Ir a la tienda' }).click();
  await expect(page).toHaveURL(/\/tienda$/);
  expect(await page.evaluate((k) => localStorage.getItem(k), KEY)).toBeNull();
});

test('persistencia: el carrito sobrevive a recargar, y solo se guarda producto y cantidad', async ({ page }) => {
  await page.goto(NEUTRO);
  await fichaAdd(page).click();
  await expect(page.getByTestId('cart-count').filter({ visible: true })).toHaveText('1');
  await page.reload();
  await expect(page.getByTestId('cart-count').filter({ visible: true })).toHaveText('1');
  const stored = JSON.parse((await page.evaluate((k) => localStorage.getItem(k), KEY)) ?? '{}');
  expect(stored).toEqual({ version: 1, items: [{ productId: STORE.neutro, quantity: 1 }] });
});

test('localStorage corrupto: la página carga con el carrito vacío', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await preload(page, '{esto no es json');
  await page.goto('/tienda');
  await openCart(page);
  await expect(drawer(page).getByTestId('cart-empty')).toBeVisible();
  expect(errors).toEqual([]);
});

test('localStorage manipulado: duplicados unidos, precios guardados ignorados, límites aplicados', async ({ page }) => {
  await preload(
    page,
    JSON.stringify({
      version: 1,
      items: [
        { productId: STORE.neutro, quantity: 2, price: 1 },
        { productId: STORE.neutro, quantity: 1 },
        { productId: 'no-es-uuid', quantity: 3 },
        { productId: STORE.balsamo, quantity: 50 },
      ],
    }),
  );
  await page.goto('/tienda');
  await openCart(page);
  const neutro = lineOf(page, 'Shampoo Neutro 1000cc');
  await expect(neutro.getByTestId('cart-line-qty')).toHaveText('3');
  await expect(neutro).toContainText('$ 12.550 c/u');
  await expect(drawer(page).getByTestId('cart-line')).toHaveCount(2);
  // 50 unidades guardadas → se ajusta al máximo (5) con aviso
  await expect(lineOf(page, 'Bálsamo Lino').getByTestId('cart-line-qty')).toHaveText('5');
  await expect(drawer(page).getByTestId('cart-notice').first()).toContainText('Ajustamos Bálsamo Lino a 5 unidades');
});

test('máximo por producto (configurado en store_settings)', async ({ page }) => {
  await page.goto(NEUTRO);
  const add = fichaAdd(page);
  for (let i = 1; i <= 5; i++) {
    await add.click();
    await expect(drawer(page).getByTestId('cart-feedback')).toContainText(`Cantidad en el carrito: ${i}.`);
    await page.keyboard.press('Escape');
  }
  await add.click();
  await expect(drawer(page).getByTestId('cart-feedback')).toHaveText('Podés agregar hasta 5 unidades de este producto.');
  await expect(lineOf(page, 'Shampoo Neutro 1000cc').getByRole('button', { name: /^Sumar una unidad/ })).toBeDisabled();

  // si el administrador cambia el límite, la interfaz usa el nuevo (no hay constantes en el código)
  localSql('update public.store_settings set max_units_per_product = 3');
  try {
    const page2 = await page.context().newPage();
    await page2.goto('/tienda/balsamo-lino');
    for (let i = 0; i < 4; i++) {
      await fichaAdd(page2).click();
      await expect(drawer(page2).getByTestId('cart-feedback')).toBeVisible();
      await page2.keyboard.press('Escape');
      await expect(drawer(page2)).toHaveCount(0);
    }
    await fichaAdd(page2).click();
    await expect(drawer(page2).getByTestId('cart-feedback')).toHaveText('Podés agregar hasta 3 unidades de este producto.');
  } finally {
    localSql('update public.store_settings set max_units_per_product = 5');
  }
});

test('máximo por carrito', async ({ page }) => {
  await preload(page, rellenos(4).map((productId) => ({ productId, quantity: 5 })));
  await page.goto(NEUTRO);
  await expect(page.getByTestId('cart-count').filter({ visible: true })).toHaveText('20');
  await fichaAdd(page).click();
  await expect(drawer(page).getByTestId('cart-feedback')).toHaveText('Tu carrito puede tener hasta 20 unidades en total.');
  await expect(drawer(page).getByTestId('cart-line')).toHaveCount(4);
});

test('producto sin stock: botón deshabilitado en la ficha y en la tarjeta', async ({ page }) => {
  await page.goto('/tienda/acondicionador-acido');
  await expect(fichaAdd(page)).toBeDisabled();
  await expect(fichaAdd(page)).toHaveText('Sin stock');
  // los productos sin stock van al final: se muestran todos
  await page.goto('/tienda?mostrar=48');
  await expect(cardButton(page, 'Acondicionador Ácido')).toBeDisabled();
});

test('producto desactivado mientras está en el carrito', async ({ page }) => {
  await preload(page, [{ productId: STORE.neutro, quantity: 1 }, { productId: STORE.balsamo, quantity: 1 }]);
  await page.goto('/tienda');
  await openCart(page);
  await expect(drawer(page).getByTestId('cart-subtotal')).toHaveText('$ 17.550');
  localSql(`update public.products set is_active = false where id = '${STORE.balsamo}'`);
  try {
    await page.keyboard.press('Escape');
    await openCart(page); // al abrirse vuelve a cotizar
    // la base no revela datos de un producto oculto: sin nombre, precio ni imagen
    await expect(drawer(page)).not.toContainText('Bálsamo Lino');
    const line = lineOf(page, 'Producto no disponible');
    await expect(line.getByTestId('cart-line-status')).toHaveText('Ya no está disponible');
    await expect(drawer(page).getByTestId('cart-notice').first()).toContainText('Un producto ya no está disponible');
    await expect(drawer(page).getByTestId('cart-subtotal')).toHaveText('$ 12.550');
    await expect(line.getByRole('button', { name: /^Sumar una unidad/ })).toBeDisabled();
    await line.getByRole('button', { name: /^Quitar/ }).click();
    await expect(drawer(page).getByTestId('cart-line')).toHaveCount(1);
  } finally {
    localSql(`update public.products set is_active = true where id = '${STORE.balsamo}'`);
  }
});

test('categoría desactivada mientras está en el carrito', async ({ page }) => {
  await preload(page, [{ productId: STORE.argan, quantity: 1 }]);
  await page.goto('/tienda');
  await openCart(page);
  await expect(lineOf(page, 'Máscara Argán')).toContainText('$ 15.000 c/u');
  localSql(`update public.categories set is_active = false where id = '${STORE.mascaras}'`);
  try {
    await page.keyboard.press('Escape');
    await openCart(page);
    await expect(drawer(page)).not.toContainText('Máscara Argán');
    await expect(lineOf(page, 'Producto no disponible').getByTestId('cart-line-status')).toHaveText('Ya no está disponible');
    await expect(drawer(page).getByTestId('cart-subtotal')).toHaveText('$ 0');
  } finally {
    localSql(`update public.categories set is_active = true where id = '${STORE.mascaras}'`);
  }
});

test('cambio de precio: aviso con el precio anterior y el nuevo', async ({ page }) => {
  await page.goto(NEUTRO);
  await fichaAdd(page).click();
  await expect(lineOf(page, 'Shampoo Neutro 1000cc')).toContainText('$ 12.550 c/u');
  localSql(`update public.products set price_ars = 13000 where id = '${STORE.neutro}'`);
  try {
    await page.keyboard.press('Escape');
    await openCart(page);
    await expect(drawer(page).getByTestId('cart-notice').first()).toHaveText(
      'El precio de Shampoo Neutro 1000cc cambió de $ 12.550 a $ 13.000.',
    );
    await expect(lineOf(page, 'Shampoo Neutro 1000cc')).toContainText('$ 13.000 c/u');
    await expect(drawer(page).getByTestId('cart-subtotal')).toHaveText('$ 13.000');
  } finally {
    localSql(`update public.products set price_ars = 12550 where id = '${STORE.neutro}'`);
  }
});

test('cambio de disponibilidad: la cantidad se ajusta y luego queda sin stock', async ({ page }) => {
  await preload(page, [{ productId: STORE.argan, quantity: 2 }]);
  await page.goto('/tienda');
  await openCart(page);
  const line = lineOf(page, 'Máscara Argán');
  await expect(line.getByTestId('cart-line-qty')).toHaveText('2');
  localSql(`update public.products set stock = 1 where id = '${STORE.argan}'`);
  try {
    await page.keyboard.press('Escape');
    await openCart(page);
    await expect(line.getByTestId('cart-line-qty')).toHaveText('1');
    await expect(drawer(page).getByTestId('cart-notice').first()).toContainText('Ajustamos Máscara Argán a 1 unidad: no hay más disponibles.');
    await expect(line.getByRole('button', { name: /^Sumar una unidad/ })).toBeDisabled();

    localSql(`update public.products set stock = 0 where id = '${STORE.argan}'`);
    await page.keyboard.press('Escape');
    await openCart(page);
    await expect(line.getByTestId('cart-line-status')).toHaveText('Sin stock');
    await expect(drawer(page).getByText('Máscara Argán se quedó sin stock. Podés quitarlo del carrito.')).toBeVisible();
    // nunca se muestran unidades exactas
    await expect(drawer(page)).not.toContainText(/quedan \d|\d unidades disponibles/i);
  } finally {
    localSql(`update public.products set stock = 2 where id = '${STORE.argan}'`);
  }
});

test('cotización: datos públicos, sin stock exacto', async ({ request }) => {
  const r = await request.post('/api/carrito/cotizar', { data: { items: [{ productId: STORE.neutro, quantity: 1 }] } });
  expect(r.status()).toBe(200);
  expect(r.headers()['cache-control']).toContain('no-store');
  const body = await r.json();
  expect(body.lines[0]).toMatchObject({ productId: STORE.neutro, status: 'ok', priceCentavos: 1_255_000, maxQuantity: 5 });
  // el stock real es 20: no hay ningún campo de stock y el máximo comprable es el límite (5), no 20
  expect(JSON.stringify(body)).not.toMatch(/stock"\s*:/i);
  expect(Object.keys(body.lines[0]).sort()).toEqual(
    ['imageUrl', 'lineTotalCentavos', 'maxQuantity', 'name', 'priceCentavos', 'productId', 'quantity', 'slug', 'status'],
  );
  expect(body.limits).toEqual({ maxUnitsPerProduct: 5, maxUnitsPerOrder: 20 });
  expect(body.checkoutEnabled).toBe(false);
});

test('seguridad de la ruta de cotización', async ({ request, baseURL }) => {
  const url = '/api/carrito/cotizar';
  const bad = async (data: unknown) => (await request.post(url, { data })).status();
  expect(await bad({ items: [{ productId: 'x', quantity: 1 }] })).toBe(400);
  expect(await bad({ items: [{ productId: STORE.neutro, quantity: 1, price: 1 }] })).toBe(400);
  expect(await bad({ items: [{ productId: STORE.neutro, quantity: 0 }] })).toBe(400);
  expect(await bad({ items: [{ productId: STORE.neutro, quantity: 1 }, { productId: STORE.neutro, quantity: 1 }] })).toBe(400);
  expect(await bad({ items: [], admin: true })).toBe(400);
  expect((await request.post(url, { data: 'no json', headers: { 'Content-Type': 'text/plain' } })).status()).toBe(415);
  expect((await request.post(url, { data: '{', headers: { 'Content-Type': 'application/json' } })).status()).toBe(400);
  expect((await request.post(url, { data: 'x'.repeat(9000), headers: { 'Content-Type': 'application/json' } })).status()).toBe(413);
  expect((await request.post(url, { data: { items: [] }, headers: { Origin: 'https://otro-sitio.example' } })).status()).toBe(403);
  expect((await request.post(url, { data: { items: [] }, headers: { Origin: baseURL! } })).status()).toBe(200);
  expect((await request.get(url)).status()).toBe(404);
  // nada de lo anterior crea pedidos ni toca el stock
  const [db] = localSql(`select (select count(*) from public.orders)::int as pedidos, (select stock from public.products where id = '${STORE.neutro}') as stock`) as {
    pedidos: number;
    stock: number;
  }[];
  expect(db).toEqual({ pedidos: 0, stock: 20 });
});

test('drawer: teclado, foco atrapado, Escape, foco restaurado y scroll bloqueado', async ({ page }) => {
  await preload(page, [{ productId: STORE.neutro, quantity: 1 }]);
  await page.goto('/tienda');
  const button = cartButton(page);
  await button.focus();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Mi carrito' });
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute('aria-modal', 'true');
  await expect(dialog.getByRole('button', { name: 'Cerrar carrito' })).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.classList.contains('cart-open'))).toBe(true);
  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="cart-drawer"]'))).toBe(true);
  }
  await page.keyboard.press('Shift+Tab');
  expect(await page.evaluate(() => !!document.activeElement?.closest('[data-testid="cart-drawer"]'))).toBe(true);
  await page.keyboard.press('Escape');
  await expect(dialog).toHaveCount(0);
  await expect(button).toBeFocused();
  expect(await page.evaluate(() => document.documentElement.classList.contains('cart-open'))).toBe(false);
  await expect(button).toHaveAttribute('aria-label', 'Abrir carrito, 1 unidad');
});

test('«Finalizar compra» deshabilitado: no lleva a ninguna ruta ni vacía el carrito', async ({ page }) => {
  await preload(page, [{ productId: STORE.neutro, quantity: 1 }]);
  await page.goto('/tienda');
  await openCart(page);
  const checkout = drawer(page).getByTestId('cart-checkout');
  await expect(checkout).toBeDisabled();
  await expect(drawer(page)).toContainText('La compra online estará disponible muy pronto.');
  await expect(drawer(page).locator('a[href="/checkout"]')).toHaveCount(0);
  await drawer(page).getByRole('button', { name: 'Seguir comprando' }).click();
  await expect(drawer(page)).toHaveCount(0);
  await expect(page.getByTestId('cart-count').filter({ visible: true })).toHaveText('1');
  const [s] = localSql('select checkout_enabled from public.store_settings') as { checkout_enabled: boolean }[];
  expect(s.checkout_enabled).toBe(false);
});

test('el carrito está en las páginas institucionales y no en el panel', async ({ page, browser }) => {
  for (const path of ['/', '/productos', '/triples']) {
    await page.goto(path);
    await expect(cartButton(page)).toBeVisible();
  }
  const admin = await browser.newContext({ storageState: ADMIN_STATE });
  const adminPage = await admin.newPage();
  await adminPage.goto('/admin/productos');
  await expect(adminPage.getByRole('heading', { name: 'Productos', level: 1 })).toBeVisible();
  await expect(adminPage.getByTestId('cart-button')).toHaveCount(0);
  await expect(adminPage.getByTestId('add-to-cart')).toHaveCount(0);
  await admin.close();
});

for (const size of [
  { name: '390', width: 390, height: 844 },
  { name: '768', width: 768, height: 1024 },
  { name: '1440', width: 1440, height: 900 },
]) {
  test(`responsive ${size.name}px: header, tarjetas y drawer sin desbordes`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await preload(page, [{ productId: STORE.neutro, quantity: 2 }, { productId: STORE.argan, quantity: 1 }, { productId: STORE.balsamo, quantity: 1 }]);
    await page.goto('/tienda');
    await expect(cartButton(page)).toBeVisible();
    await expect(page.getByTestId('cart-count').filter({ visible: true })).toHaveText('4');
    const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await test.info().attach(`carrito-${size.name}-tienda`, { body: await page.screenshot(), contentType: 'image/png' });

    await openCart(page);
    await expect(drawer(page).getByTestId('cart-line')).toHaveCount(3);
    await expect(drawer(page).getByTestId('cart-subtotal')).toHaveText('$ 45.100');
    const box = await drawer(page).boundingBox();
    if (size.width <= 600) expect(Math.round(box!.width)).toBe(size.width);
    else expect(Math.round(box!.width)).toBe(420);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await test.info().attach(`carrito-${size.name}-drawer`, { body: await page.screenshot(), contentType: 'image/png' });
    await page.screenshot({ path: test.info().outputPath(`carrito-${size.name}-drawer.png`) });

    await page.keyboard.press('Escape');
    await page.goto(NEUTRO);
    expect(await overflow()).toBeLessThanOrEqual(0);
    await page.screenshot({ path: test.info().outputPath(`carrito-${size.name}-ficha.png`) });
  });
}

test('header de escritorio angosto (769–1150 px): el carrito entra sin desbordes', async ({ page }) => {
  await preload(page, [{ productId: STORE.neutro, quantity: 3 }]);
  for (const width of [769, 820, 900, 1024, 1150, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto('/tienda');
    const button = cartButton(page);
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    expect(box.x + box.width, `ancho ${width}`).toBeLessThanOrEqual(width);
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `ancho ${width}`).toBeLessThanOrEqual(0);
  }
});
