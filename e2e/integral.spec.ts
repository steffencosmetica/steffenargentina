import { expect, test, type Browser, type Page } from '@playwright/test';
import { seedBaseCatalog } from './global-setup';
import { ADMIN_STATE } from './helpers';
import { localSql, setLocalCheckout } from './local';
import { invalidateCatalog, seedStore, STORE } from './tienda-data';

// Fase 4B.8 — validación integral: catálogo → carrito → checkout → reserva → pago SIMULADO → panel → seguimiento.
// Todo contra Supabase LOCAL. El pago aprobado se simula con private.aplicar_pago() (solo postgres, el mismo
// punto de entrada que usará el webhook de Mercado Pago en la Fase 5); el panel nunca puede aprobar pagos.

const ZONE = '00000000-0000-4000-8000-0000000c4b81';
const KEY = 'steffen-carrito-v1';
const BUYER = { firstName: 'Lucía', lastName: 'Integral', phone: '223 555-0000', province: 'AR-B', city: 'Mar del Plata', postalCode: '7600', street: 'Calle Ficticia', number: '100' };

test.describe.configure({ mode: 'serial' });

test.beforeAll(async ({ browser }) => {
  seedStore();
  localSql(`do $$ begin
    delete from public.shipping_zone_provinces; delete from public.shipping_zones;
    insert into public.shipping_zones (id, name, price_ars, free_from_ars, sort_order) values ('${ZONE}', 'AMBA', 3500.50, 60000, 1);
    insert into public.shipping_zone_provinces (zone_id, province_code) values ('${ZONE}', 'AR-B');
    update public.store_settings set max_orders_per_ip_hour = 1000, max_attempts_per_ip_hour = 10000, max_pending_orders_per_email = 20 where id;
  end $$`);
  setLocalCheckout(true);
  await invalidateCatalog(browser);
});

test.beforeEach(() => {
  localSql(`do $$ begin
    delete from public.orders; delete from public.checkout_attempts;
    update public.products set stock = 20, price_ars = 12550, name = 'Shampoo Neutro 1000cc', is_active = true where id = '${STORE.neutro}';
    update public.products set stock = 2, price_ars = 15000 where id = '${STORE.argan}';
    update public.categories set is_active = true where id in ('${STORE.shampoos}', '${STORE.mascaras}');
    update public.shipping_zones set price_ars = 3500.50, free_from_ars = 60000 where id = '${ZONE}';
    update public.store_settings set checkout_enabled = true, max_pending_orders_per_email = 20, max_units_per_product = 5 where id;
  end $$`);
});

test.afterAll(() => {
  setLocalCheckout(false);
  localSql(`do $$ begin
    delete from public.orders; delete from public.checkout_attempts;
    delete from public.shipping_zone_provinces; delete from public.shipping_zones;
    update public.store_settings set max_orders_per_ip_hour = 5, max_attempts_per_ip_hour = 30, max_pending_orders_per_email = 2, max_units_per_product = 5 where id;
  end $$`);
  seedBaseCatalog();
});

const drawer = (page: Page) => page.getByTestId('cart-drawer');
const banner = (page: Page) => page.getByTestId('ck-banner');
const submit = (page: Page) => page.getByTestId('ck-submit');
const barTotal = (page: Page) => page.getByTestId('ck-bar-total');
const stockOf = (id: string) => (localSql(`select stock from public.products where id = '${id}'`) as { stock: number }[])[0].stock;
const orderRows = () => localSql(`select id, code, total_ars::text as total, shipping_ars::text as shipping, payment_status as payment, stock_state, fulfillment_status as fulfillment from public.orders order by created_at`) as { id: string; code: string; total: string; shipping: string; payment: string; stock_state: string; fulfillment: string }[];

function preload(page: Page, items: { productId: string; quantity: number }[]) {
  return page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [KEY, JSON.stringify({ version: 1, items })] as const);
}

async function fillForm(page: Page, email: string) {
  await page.getByLabel('Nombre', { exact: true }).fill(BUYER.firstName);
  await page.getByLabel('Apellido').fill(BUYER.lastName);
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Teléfono').fill(BUYER.phone);
  await page.getByLabel('Provincia').selectOption(BUYER.province);
  await page.getByLabel('Localidad').fill(BUYER.city);
  await page.getByLabel('Código postal').fill(BUYER.postalCode);
  await page.getByLabel('Calle').fill(BUYER.street);
  await page.getByLabel('Número').fill(BUYER.number);
  await page.getByLabel(/Acepto los términos/).check();
}

/** Pago simulado ocurrido hace 10 minutos (fixture): el panel exige despacho posterior al pago, con precisión de minutos. */
function simulatePayment(orderId: string, ref: string, total: string) {
  localSql(`do $$ begin
    perform private.aplicar_pago('${orderId}', '${ref}', 'approved', ${total});
    alter table public.orders disable trigger orders_validar_cambios;
    update public.orders set created_at = created_at - interval '10 minutes', paid_at = paid_at - interval '10 minutes' where id = '${orderId}';
    alter table public.orders enable trigger orders_validar_cambios;
  end $$`);
}


/**
 * Confirma cuando el total ya está a la vista. Si se confirma antes de que llegue la cotización del envío, el
 * checkout (correctamente) no crea nada: muestra el total y pide confirmar otra vez. Las pruebas esperan el
 * total igual que lo haría un comprador, en lugar de aumentar tiempos de espera.
 */
async function confirmWithTotal(page: Page) {
  await expect(barTotal(page)).toHaveText(/^\$ \d/);
  await submit(page).click();
}

async function adminPage(browser: Browser) {
  const context = await browser.newContext({ storageState: ADMIN_STATE });
  return { context, page: await context.newPage() };
}

async function adminConfirm(page: Page, button: string) {
  await page.getByRole('button', { name: button }).click();
  await page.getByRole('button', { name: 'Confirmar', exact: true }).click();
}

test('compra integral desde el catálogo, pago simulado, gestión con Andreani y seguimiento del comprador', async ({ page, browser }) => {
  // 1-5. catálogo → ficha → carrito → cantidades
  await page.goto('/tienda');
  await page.getByTestId('store-card').filter({ hasText: 'Shampoo Neutro 1000cc' }).first().click();
  await expect(page).toHaveURL(/\/tienda\/shampoo-neutro-1000cc$/);
  await page.locator('.store-product-actions').getByTestId('add-to-cart').click();
  const line = drawer(page).getByTestId('cart-line').filter({ hasText: 'Shampoo Neutro 1000cc' });
  await line.getByRole('button', { name: /^Sumar una unidad/ }).click();
  await line.getByRole('button', { name: /^Sumar una unidad/ }).click();
  await expect(line.getByTestId('cart-line-qty')).toHaveText('3');
  await line.getByRole('button', { name: /^Restar una unidad/ }).click();
  await expect(line.getByTestId('cart-line-total')).toHaveText('$ 25.100');
  // agregar al carrito NO reserva stock ni crea nada en la base
  expect(stockOf(STORE.neutro)).toBe(20);
  expect(orderRows()).toEqual([]);

  // 6-11. checkout
  await drawer(page).getByRole('link', { name: 'Finalizar compra' }).click();
  await expect(page).toHaveURL(/\/checkout$/);
  await fillForm(page, 'integral@steffen.test');
  await expect(page.getByTestId('ck-subtotal')).toHaveText('$ 25.100');
  await expect(page.getByTestId('ck-shipping')).toHaveText('$ 3.500,50');
  await expect(barTotal(page)).toHaveText('$ 28.600,50');
  await confirmWithTotal(page);
  await page.waitForURL(/\/pedido\/STF-/);
  const code = await page.getByTestId('order-code').innerText();

  // 12. reserva transaccional con importes exactos (centavos) y snapshot de la línea
  const [order] = orderRows();
  expect(order).toMatchObject({ code, total: '28600.50', shipping: '3500.50', payment: 'pending', stock_state: 'reserved', fulfillment: 'pending' });
  expect(stockOf(STORE.neutro)).toBe(18);
  expect(localSql(`select sku, name, unit_price_ars::text as unit, quantity, line_total_ars::text as line from public.order_items where order_id = '${order.id}'`))
    .toEqual([{ sku: 'TND-NEUTRO', name: 'Shampoo Neutro 1000cc', unit: '12550.00', quantity: 2, line: '25100.00' }]);

  // snapshot histórico: cambiar precio y nombre del producto no altera el pedido
  localSql(`update public.products set price_ars = 99999, name = 'Shampoo Renombrado' where id = '${STORE.neutro}'`);
  await page.reload();
  await expect(page.getByTestId('order-line')).toContainText('Shampoo Neutro 1000cc');
  await expect(page.getByTestId('order-line')).toContainText('2 × $ 12.550');
  await expect(page.getByTestId('order-total')).toHaveText('$ 28.600,50');
  await expect(page.getByTestId('order-dispatch')).toHaveCount(0);

  // el panel no ofrece aprobar pagos
  const admin = await adminPage(browser);
  try {
    await admin.page.goto(`/admin/pedidos/${order.id}`);
    await expect(admin.page.getByRole('button', { name: /aprobar pago|marcar pagado|reembolsar/i })).toHaveCount(0);
    await expect(admin.page.getByRole('button', { name: 'Comenzar preparación' })).toHaveCount(0);

    // pago aprobado SIMULADO (punto de entrada del futuro webhook; solo postgres)
    simulatePayment(order.id, 'mp-simulado-integral', '28600.50');
    expect(orderRows()[0]).toMatchObject({ payment: 'approved', stock_state: 'consumed' });
    expect(stockOf(STORE.neutro)).toBe(18); // consumir la reserva no vuelve a descontar

    // preparación → despacho con Andreani y código manual → entrega
    await admin.page.reload();
    await adminConfirm(admin.page, 'Comenzar preparación');
    await expect(admin.page.getByRole('button', { name: 'Registrar despacho' })).toBeVisible();
    await admin.page.getByLabel('Transportista', { exact: true }).fill('Andreani');
    await admin.page.getByLabel('Código de seguimiento (opcional)').fill('AND-INTEGRAL-0001');
    await admin.page.getByLabel('Fecha de despacho (hora local del dispositivo)').fill(new Date(Date.now() - 60000).toLocaleString('sv-SE').slice(0, 16).replace(' ', 'T'));
    await adminConfirm(admin.page, 'Registrar despacho');
    await expect(admin.page.getByRole('button', { name: 'Marcar entregado' })).toBeVisible();

    // 13. el comprador ve el despacho en su seguimiento privado
    await page.reload();
    await expect(page.getByTestId('order-payment')).toHaveAttribute('data-status', 'approved');
    await expect(page.getByTestId('order-carrier')).toHaveText('Andreani');
    await expect(page.getByTestId('order-tracking')).toHaveText('AND-INTEGRAL-0001');
    await expect(page.locator('main')).not.toContainText('integral@steffen.test');
    await expect(page.locator('main')).not.toContainText('Calle Ficticia');

    await adminConfirm(admin.page, 'Marcar entregado');
    await expect(admin.page.getByText('No hay transiciones disponibles para este estado.')).toBeVisible();
    // ya entregado: no se puede cancelar ni cambiar el estado financiero
    await expect(admin.page.getByRole('button', { name: 'Cancelar pedido' })).toHaveCount(0);
  } finally { await admin.context.close(); }

  const final = orderRows()[0];
  expect(final).toMatchObject({ payment: 'approved', stock_state: 'consumed', fulfillment: 'delivered' });
  expect(stockOf(STORE.neutro)).toBe(18);
  const events = (localSql(`select event_type from public.order_events where order_id = '${order.id}' order by created_at, id`) as { event_type: string }[]).map((e) => e.event_type);
  expect(events[0]).toBe('created');
  expect(events).toEqual(expect.arrayContaining(['created', 'payment_approved']));
  expect(events.length).toBeGreaterThanOrEqual(5);
  // facturación: el modelo no tiene estado de factura (Factura C manual; registro pendiente de Fase 5)
  expect(localSql(`select count(*)::int as n from information_schema.columns where table_schema = 'public' and table_name = 'orders' and column_name ~ '(invoice|factura|cae|comprobante)'`)).toEqual([{ n: 0 }]);
});

test('despacho con otro transportista sin código: se informa al comprador sin inventar un seguimiento', async ({ page, browser }) => {
  await preload(page, [{ productId: STORE.neutro, quantity: 1 }]);
  await page.goto('/checkout');
  await fillForm(page, 'otro-transporte@steffen.test');
  await confirmWithTotal(page);
  await page.waitForURL(/\/pedido\/STF-/);
  const [order] = orderRows();
  simulatePayment(order.id, 'mp-simulado-otro', order.total);
  const admin = await adminPage(browser);
  try {
    await admin.page.goto(`/admin/pedidos/${order.id}`);
    await adminConfirm(admin.page, 'Comenzar preparación');
    await admin.page.getByLabel('Transportista', { exact: true }).fill('Correo Argentino');
    await admin.page.getByLabel('Fecha de despacho (hora local del dispositivo)').fill(new Date(Date.now() - 60000).toLocaleString('sv-SE').slice(0, 16).replace(' ', 'T'));
    await adminConfirm(admin.page, 'Registrar despacho');
    await expect(admin.page.getByRole('button', { name: 'Marcar entregado' })).toBeVisible();
  } finally { await admin.context.close(); }
  await page.reload();
  await expect(page.getByTestId('order-carrier')).toHaveText('Correo Argentino');
  await expect(page.getByTestId('order-tracking')).toHaveCount(0);
  await expect(page.getByTestId('order-dispatch')).toContainText('se informa cuando el transportista lo asigna');
});

test('cancelación de un pedido pendiente: el stock vuelve exactamente una vez; un pago tardío sigue la regla aprobada', async ({ page, browser }) => {
  await preload(page, [{ productId: STORE.argan, quantity: 2 }]);
  await page.goto('/checkout');
  await fillForm(page, 'cancelacion@steffen.test');
  await confirmWithTotal(page);
  await page.waitForURL(/\/pedido\/STF-/);
  expect(stockOf(STORE.argan)).toBe(0);
  const [order] = orderRows();
  const admin = await adminPage(browser);
  try {
    await admin.page.goto(`/admin/pedidos/${order.id}`);
    await adminConfirm(admin.page, 'Cancelar pedido');
    await expect(admin.page.getByText('No hay transiciones disponibles para este estado.')).toBeVisible();
  } finally { await admin.context.close(); }
  expect(stockOf(STORE.argan)).toBe(2);
  // el vencimiento posterior no libera otra vez
  localSql(`do $$ begin perform public.liberar_reservas_vencidas(100); end $$`);
  expect(stockOf(STORE.argan)).toBe(2);
  // regla aprobada (4B.3): un pago aprobado que llega después de la cancelación vuelve a descontar el stock
  // si está disponible (approved_late); si no, queda como faltante para revisión. Nunca stock negativo.
  localSql(`update public.products set stock = 1 where id = '${STORE.argan}'`);
  localSql(`do $$ begin perform private.aplicar_pago('${order.id}', 'mp-simulado-tardio', 'approved', ${order.total}); end $$`);
  expect(orderRows()[0]).toMatchObject({ payment: 'approved', stock_state: 'shortage' });
  expect(stockOf(STORE.argan)).toBe(1); // sin stock suficiente no descuenta nada
  expect(localSql(`select resolution_status, resolution_reason from public.orders where id = '${order.id}'`)).toEqual([{ resolution_status: 'pending', resolution_reason: 'stock_shortage' }]);
  // la misma notificación repetida no vuelve a aplicarse
  localSql(`do $$ begin perform private.aplicar_pago('${order.id}', 'mp-simulado-tardio', 'approved', ${order.total}); end $$`);
  expect(localSql(`select count(*)::int as n from public.order_events where order_id = '${order.id}' and payment_ref = 'mp-simulado-tardio'`)).toEqual([{ n: 1 }]);
  expect(stockOf(STORE.argan)).toBe(1);
});

test('cambio de tarifa de envío durante el checkout: la base rechaza el total viejo y se reconfirma', async ({ page }) => {
  await preload(page, [{ productId: STORE.neutro, quantity: 1 }]);
  await page.goto('/checkout');
  await fillForm(page, 'tarifa@steffen.test');
  await expect(barTotal(page)).toHaveText('$ 16.050,50');
  localSql(`update public.shipping_zones set price_ars = 4100 where id = '${ZONE}'`);
  await submit(page).click();
  await expect(banner(page)).toHaveText('El total cambió de $ 16.050,50 a $ 16.650 (precio o envío actualizado). Revisá el resumen y confirmá de nuevo.');
  expect(orderRows()).toEqual([]);
  expect(stockOf(STORE.neutro)).toBe(20);
  await confirmWithTotal(page);
  await page.waitForURL(/\/pedido\/STF-/);
  expect(orderRows()[0]).toMatchObject({ total: '16650.00', shipping: '4100.00' });
});

test('envío gratuito al alcanzar el mínimo y producto retirado del catálogo público durante el checkout', async ({ page }) => {
  await preload(page, [{ productId: STORE.neutro, quantity: 5 }]);
  await page.goto('/checkout');
  await fillForm(page, 'gratis@steffen.test');
  await expect(page.getByTestId('ck-shipping')).toHaveText('Gratis');
  await expect(barTotal(page)).toHaveText('$ 62.750');

  // la categoría se desactiva (el producto sale del catálogo público) justo antes de confirmar
  await page.route('**/api/checkout/pedido', async (route) => {
    localSql(`update public.categories set is_active = false where id = '${STORE.shampoos}'`);
    await route.continue();
  });
  await submit(page).click();
  await expect(banner(page)).toHaveText('Algunos productos ya no están disponibles.');
  expect(orderRows()).toEqual([]);
  expect(stockOf(STORE.neutro)).toBe(20);
});

test('límites: unidades por producto y pedidos pendientes por email se rechazan sin reservar', async ({ page }) => {
  localSql(`update public.store_settings set max_pending_orders_per_email = 1 where id`);
  await preload(page, [{ productId: STORE.neutro, quantity: 1 }]);
  await page.goto('/checkout');
  await fillForm(page, 'limite@steffen.test');
  await confirmWithTotal(page);
  await page.waitForURL(/\/pedido\/STF-/);
  expect(stockOf(STORE.neutro)).toBe(19);

  // segundo pedido pendiente con el mismo email: rechazado
  const second = await page.context().newPage();
  await preload(second, [{ productId: STORE.neutro, quantity: 1 }]);
  await second.goto('/checkout');
  await fillForm(second, 'limite@steffen.test');
  await confirmWithTotal(second);
  await expect(banner(second)).toHaveText('Ya tenés pedidos esperando el pago. Completalos o esperá a que venzan.');
  expect(orderRows()).toHaveLength(1);
  expect(stockOf(STORE.neutro)).toBe(19);

  // más unidades que el máximo por producto, directo por la API: rechazado sin reservar
  const response = await page.request.post('/api/checkout/pedido', {
    data: {
      idempotencyKey: 'limite-unidades-'.padEnd(43, 'x'),
      form: { firstName: 'Ana', lastName: 'Límite', email: 'unidades@steffen.test', phone: '223 555-1234', provinceCode: 'AR-B', city: 'Mar del Plata', postalCode: '7600', street: 'Calle', number: '1' },
      items: [{ productId: STORE.neutro, quantity: 6 }],
      expectedTotalCentavos: 6 * 1_255_000 + 350_050,
      acceptTerms: true,
    },
  });
  expect(response.ok()).toBe(false);
  expect(['quantity_limit', 'invalid_request']).toContain((await response.json()).error);
  expect(orderRows()).toHaveLength(1);
  expect(stockOf(STORE.neutro)).toBe(19);
});

for (const width of [390, 768, 1440]) test(`seguimiento con despacho responsive ${width}`, async ({ page, browser }) => {
  await preload(page, [{ productId: STORE.neutro, quantity: 1 }]);
  await page.goto('/checkout');
  await fillForm(page, `responsive${width}@steffen.test`);
  await confirmWithTotal(page);
  await page.waitForURL(/\/pedido\/STF-/);
  const [order] = orderRows();
  simulatePayment(order.id, `mp-simulado-${width}`, order.total);
  const admin = await adminPage(browser);
  try {
    await admin.page.goto(`/admin/pedidos/${order.id}`);
    await adminConfirm(admin.page, 'Comenzar preparación');
    await admin.page.getByLabel('Transportista', { exact: true }).fill('Andreani');
    await admin.page.getByLabel('Código de seguimiento (opcional)').fill('AND-RESPONSIVE-0000000000001');
    await admin.page.getByLabel('Fecha de despacho (hora local del dispositivo)').fill(new Date(Date.now() - 60000).toLocaleString('sv-SE').slice(0, 16).replace(' ', 'T'));
    await adminConfirm(admin.page, 'Registrar despacho');
    await expect(admin.page.getByRole('button', { name: 'Marcar entregado' })).toBeVisible();
  } finally { await admin.context.close(); }
  await page.setViewportSize({ width, height: 900 });
  await page.reload();
  await expect(page.getByTestId('order-tracking')).toHaveText('AND-RESPONSIVE-0000000000001');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `artifacts/4b8/seguimiento-despacho-${width}.png`, fullPage: true });
});
