import { expect, test, type Page, type Request } from '@playwright/test';
import { createHmac, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { reconcilePayment } from '../src/lib/orders/payment-reconciliation';
import { seedBaseCatalog } from './global-setup';
import { LOCAL_SUPABASE, localSecretKey, localSql, MOCK_WEBHOOK_FIXTURE, setLocalCheckout } from './local';
import { seedStore, STORE } from './tienda-data';

// Checkout y seguimiento (Fase 4B.5), con el build local (carrito + clave de servidor) contra Supabase LOCAL.
// Las compras se habilitan SOLO en la base local durante este archivo (setLocalCheckout, que corre como
// postgres y únicamente contra 127.0.0.1) y se deshabilitan al terminar. Ningún dato toca Supabase Cloud.

const KEY = 'steffen-carrito-v1';
const CODE_RE = /^STF-\d{4}-[2-9A-HJ-NP-Z]{4}$/;
const ZONES = {
  amba: '00000000-0000-4000-8000-0000000c0a01', // AR-B y AR-C, $ 3.500,50
  centro: '00000000-0000-4000-8000-0000000c0a02', // AR-X, $ 4.000, gratis desde $ 30.000
};
// stock y precios de partida (tienda-data.ts): se restauran antes de cada test
const RESET = `
do $$
begin
  delete from public.orders;
  delete from public.checkout_attempts;
  update public.products set stock = 20, price_ars = 12550, is_active = true where id = '${STORE.neutro}';
  update public.products set stock = 2, price_ars = 15000 where id = '${STORE.argan}';
  update public.products set stock = 5, price_ars = 5000 where id = '${STORE.balsamo}';
  update public.store_settings set checkout_enabled = true where id;
end
$$`;

test.describe.configure({ mode: 'serial' });

test.beforeAll(() => {
  seedStore();
  localSql(`
do $$
begin
  delete from public.shipping_zone_provinces;
  delete from public.shipping_zones;
  insert into public.shipping_zones (id, name, price_ars, free_from_ars, sort_order) values
    ('${ZONES.amba}', 'AMBA', 3500.50, null, 1),
    ('${ZONES.centro}', 'Centro', 4000, 30000, 2);
  insert into public.shipping_zone_provinces (zone_id, province_code) values
    ('${ZONES.amba}', 'AR-B'), ('${ZONES.amba}', 'AR-C'), ('${ZONES.centro}', 'AR-X');
  -- límites antiabuso altos: todos los pedidos de las pruebas salen de 127.0.0.1
  update public.store_settings set max_orders_per_ip_hour = 1000, max_attempts_per_ip_hour = 10000, max_pending_orders_per_email = 20 where id;
end
$$`);
  setLocalCheckout(true);
});

test.beforeEach(() => {
  localSql(RESET);
});

test.afterAll(({}, testInfo) => {
  setLocalCheckout(false);
  localSql(`
do $$
begin
  delete from public.orders;
  delete from public.checkout_attempts;
  delete from public.shipping_zone_provinces;
  delete from public.shipping_zones;
  update public.store_settings set max_orders_per_ip_hour = 5, max_attempts_per_ip_hour = 30, max_pending_orders_per_email = 2 where id;
end
$$`);
  seedBaseCatalog();
  if (testInfo.project.name.startsWith('pago-')) {
    localSql('delete from private.payment_jobs');
    localSql("delete from private.payment_request_limits where ip_hash = private.hash_ip('127.0.0.1')");
  }
});

// ---------------------------------------------------------------------------
// ayudas
// ---------------------------------------------------------------------------

type Item = { productId: string; quantity: number };

function preload(page: Page, items: Item[]) {
  return page.addInitScript(([k, v]) => window.localStorage.setItem(k, v), [KEY, JSON.stringify({ version: 1, items })] as const);
}

const BUYER = {
  firstName: 'Ana',
  lastName: 'Pérez',
  email: 'ana@steffen.test',
  phone: '223 555-1234',
  province: 'AR-B',
  city: 'Mar del Plata',
  postalCode: '7600',
  street: 'Av. Colón',
  number: '1234',
};

async function fillForm(page: Page, patch: Partial<typeof BUYER> = {}) {
  const d = { ...BUYER, ...patch };
  await page.getByLabel('Nombre', { exact: true }).fill(d.firstName);
  await page.getByLabel('Apellido').fill(d.lastName);
  await page.getByLabel('Email').fill(d.email);
  await page.getByLabel('Teléfono').fill(d.phone);
  await page.getByLabel('Provincia').selectOption(d.province);
  await page.getByLabel('Localidad').fill(d.city);
  await page.getByLabel('Código postal').fill(d.postalCode);
  await page.getByLabel('Calle').fill(d.street);
  await page.getByLabel('Número').fill(d.number);
  await page.getByLabel(/Acepto los términos/).check();
}

const submit = (page: Page) => page.getByTestId('ck-submit');
const barTotal = (page: Page) => page.getByTestId('ck-bar-total');
const banner = (page: Page) => page.getByTestId('ck-banner');

type OrderRow = { code: string; total: string; shipping: string; email: string; name: string; payment: string; stock_state: string };
function orders(): OrderRow[] {
  return localSql(
    `select code, total_ars::text as total, shipping_ars::text as shipping, buyer_email as email, buyer_name as name,
            payment_status as payment, stock_state from public.orders order by created_at`,
  ) as OrderRow[];
}

function stockOf(id: string): number {
  return (localSql(`select stock from public.products where id = '${id}'`) as { stock: number }[])[0].stock;
}

async function storedCart(page: Page): Promise<Item[]> {
  return page.evaluate((k) => JSON.parse(window.localStorage.getItem(k) ?? '{"items":[]}').items, KEY);
}

async function waitForOrderPage(page: Page) {
  await page.waitForURL(/\/pedido\/STF-/);
  await expect(page.getByTestId('order-status')).toBeVisible();
  const code = await page.getByTestId('order-code').innerText();
  expect(code).toMatch(CODE_RE);
  return code;
}

async function createPaymentFixture(page: Page) {
  localSql("delete from private.payment_request_limits where ip_hash = private.hash_ip('127.0.0.1')");
  await preload(page, [{ productId: STORE.neutro, quantity: 1 }]);
  await page.goto('/checkout');
  await fillForm(page);
  await expect(page.getByTestId('ck-total')).toHaveText('$ 16.050,50');
  const created = page.waitForResponse((response) => response.url().endsWith('/api/checkout/pedido'));
  await submit(page).click();
  const response = await created;
  expect(response.ok()).toBe(true);
  const code = await waitForOrderPage(page);
  const { token } = await response.json();
  return { code, token };
}

const payButton = (page: Page) => page.getByRole('button', { name: 'Pagar con Mercado Pago' });

async function createFinancialFixture(page: Page) {
  localSql('delete from private.payment_jobs');
  const credentials = await createPaymentFixture(page);
  const response = await page.request.post('/api/pedido/pago', { data: credentials });
  expect(response.status()).toBe(200);
  const [remote] = localSql('select id from private.mock_checkout_orders') as { id: string }[];
  expect(remote.id).toMatch(/^ORDMOCK[0-9a-f]{32}$/);
  return { ...credentials, id: remote.id };
}

function signedWebhook(id: string, notification: string, action = 'order.processed') {
  const request = randomUUID();
  const ts = String(Date.now());
  const digest = createHmac('sha256', MOCK_WEBHOOK_FIXTURE).update(`id:${id};request-id:${request};ts:${ts};`).digest('hex');
  return {
    path: `/api/mercadopago/webhook?data.id=${id}&type=order`,
    data: { type: 'order', api_version: 'v1', id: notification, action, live_mode: false, data: { id } },
    headers: { 'x-request-id': request, 'x-signature': `ts=${ts},v1=${digest}` },
  };
}

function reconciliationClient() {
  return createClient(LOCAL_SUPABASE.url, localSecretKey(), { auth: { persistSession: false } });
}

test('5C conserva el evento ante replay, ignora el body y confirma por consulta @pago-local', async ({ page }) => {
  const { id } = await createFinancialFixture(page);
  const db = reconciliationClient();
  const first = signedWebhook(id, '50001');
  expect((await page.request.post(first.path, { data: first.data })).status()).toBe(401);
  expect((await page.request.post(first.path, { ...first, data: { ...first.data, data: { id: 'manipulado' } } })).status()).toBe(400);
  expect((await page.request.post(first.path, { ...first, data: { ...first.data, user_id: 'otro-vendedor' } })).status()).toBe(400);
  const receipts = await Promise.all([page.request.post(first.path, first), page.request.post(first.path, first)]);
  expect(receipts.map(receipt => receipt.status())).toEqual([200, 200]);
  expect(localSql('select request_id from private.payment_jobs')).toHaveLength(1);
  expect((await reconcilePayment(db))?.result).toBe('created');
  expect(orders()[0].payment).toBe('pending');
  localSql("update private.payment_jobs set received_at=now()-interval '8 days', attempts=9 where attempt_id is not null");
  const [poll] = localSql('select public.tomar_trabajos_pago() as job') as { job: { id: string; lease: string } }[];
  localSql(`select public.resolver_trabajo_pago('${poll.job.id}','${poll.job.lease}',null,null,'provider_unavailable',true)`);
  expect(localSql("select state,attempts from private.payment_jobs where attempt_id is not null")).toEqual([{ state: 'queued', attempts: 10 }]);
  expect(localSql("select public.estado_trabajos_pago()->>'degraded_polls' as count")).toEqual([{ count: '1' }]);
  localSql("update private.payment_jobs set next_at=clock_timestamp() where attempt_id is not null");
  localSql("update private.mock_checkout_orders set status='action_required',status_detail='waiting_capture',revision=2");
  const pending = signedWebhook(id, '50002', 'order.action_required');
  expect((await page.request.post(pending.path, pending)).status()).toBe(200);
  expect((await reconcilePayment(db))?.result).toBe('pending');
  expect(localSql("select state,attempts,next_at > clock_timestamp() + interval '10 minutes' as delayed from private.payment_jobs where attempt_id is not null")).toEqual([
    { state: 'queued', attempts: 0, delayed: true },
  ]);
  expect(orders()[0].payment).toBe('pending');

  const before = stockOf(STORE.neutro);
  localSql("update private.mock_checkout_orders set status='processed',status_detail='accredited',paid_amount=total_ars,revision=3,payment_id='PAYMOCK'||repeat('a',32)");
  const credited = signedWebhook(id, '50003');
  expect((await page.request.post(credited.path, credited)).status()).toBe(200);
  expect((await reconcilePayment(db))?.result).toBe('approved');
  const oldEvent = signedWebhook(id, '50004', 'order.created');
  expect((await page.request.post(oldEvent.path, oldEvent)).status()).toBe(200);
  expect((await reconcilePayment(db))?.result).toBe('already_applied');
  expect(stockOf(STORE.neutro)).toBe(before);
  await page.reload();
  await expect(page.getByTestId('order-payment')).toHaveAttribute('data-status', 'approved');
  localSql("update private.mock_checkout_orders set revision=4,payment_id='PAYMOCK'||repeat('b',32)");
  const secondPayment = signedWebhook(id, '50006');
  expect((await page.request.post(secondPayment.path, secondPayment)).status()).toBe(200);
  for (let index = 0; index < 4; index++) await reconcilePayment(db);
  expect(localSql('select resolution_reason from public.orders')).toEqual([{ resolution_reason: 'duplicate_payment' }]);
  expect(stockOf(STORE.neutro)).toBe(before);
  for (const [status, detail, expected, notification] of [
    ['processed', 'partially_refunded', 'partially_refunded', '50007'],
    ['charged_back', 'in_process', 'disputed', '50008'],
  ]) {
    localSql(`update private.mock_checkout_orders set status='${status}',status_detail='${detail}',revision=revision+1`);
    const later = signedWebhook(id, notification);
    expect((await page.request.post(later.path, later)).status()).toBe(200);
    expect((await reconcilePayment(db))?.result).toBe(expected);
    expect(orders()[0].payment).toBe('approved');
    expect(stockOf(STORE.neutro)).toBe(before);
  }
});

test('5C responde 503 si PostgreSQL no pudo persistir y admite el mismo envío al recuperarse @pago-local', async ({ page }) => {
  const { id } = await createFinancialFixture(page);
  const hook = signedWebhook(id, '50005');
  localSql(`create function private.fail_payment_inbox_test() returns trigger language plpgsql set search_path='' as $$
    begin raise exception 'Fallo de persistencia de prueba'; end $$;
    create trigger fail_payment_inbox_test before insert on private.payment_jobs
      for each row execute function private.fail_payment_inbox_test();`);
  try {
    expect((await page.request.post(hook.path, hook)).status()).toBe(503);
    expect(localSql('select request_id from private.payment_jobs')).toHaveLength(0);
  } finally {
    localSql('drop trigger fail_payment_inbox_test on private.payment_jobs; drop function private.fail_payment_inbox_test();');
  }
  expect((await page.request.post(hook.path, hook)).status()).toBe(200);
});

for (const scenario of ['late', 'shortage', 'cancelled'] as const) {
  test(`5C conciliación autónoma de acreditación ${scenario} @pago-local`, async ({ page }) => {
    await createFinancialFixture(page);
    if (scenario === 'cancelled') {
      localSql("do $$ begin perform private.liberar_reserva(id,'cancelled','system',null) from public.orders; end $$;");
    } else {
      localSql(`alter table public.orders disable trigger orders_validar_cambios;
        update public.orders set reservation_expires_at=now()-interval '1 minute';
        alter table public.orders enable trigger orders_validar_cambios;
        do $$ begin perform public.liberar_reservas_vencidas(10); end $$;`);
      if (scenario === 'shortage') localSql(`update public.products set stock=0 where id='${STORE.neutro}'`);
    }
    localSql("update private.mock_checkout_orders set status='processed',status_detail='accredited',paid_amount=total_ars,revision=2,payment_id='PAYMOCK'||repeat('c',32)");
    const result = await reconcilePayment(reconciliationClient());
    expect(result?.result).toBe({ late: 'approved_late', shortage: 'approved_shortage', cancelled: 'cancelled_order_paid' }[scenario]);
    expect(orders()[0]).toMatchObject({
      payment: scenario === 'cancelled' ? 'cancelled' : 'approved',
      stock_state: { late: 'consumed', shortage: 'shortage', cancelled: 'released' }[scenario],
    });
    if (scenario === 'shortage') {
      expect(stockOf(STORE.neutro)).toBe(0);
      expect(localSql('select resolution_status, resolution_reason from public.orders')).toEqual([
        { resolution_status: 'pending', resolution_reason: 'stock_shortage' },
      ]);
    }
  });
}

test('redirección y retorno informativo sin segunda reserva @pago-local', async ({ page }, testInfo) => {
  const { code, token } = await createPaymentFixture(page);
  const button = payButton(page);
  await expect(button).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('seguimiento.png'), fullPage: true });
  const stock = stockOf(STORE.neutro);
  const request = page.waitForRequest((entry) => entry.url().endsWith('/api/pedido/pago'));
  await button.click();
  await expect(page).toHaveURL(new RegExp(`/pedido/${code}\\?pago=simulado$`));
  expect((await request).headers().referer ?? '').not.toContain(token);
  expect(page.url()).not.toContain(token);
  await expect(page.getByText('Llegaste al checkout simulado.', { exact: false })).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('checkout-simulado.png'), fullPage: true });
  for (const status of ['finalizado', 'pendiente', 'rechazado']) {
    await page.goto(`/pedido/${code}?pago=${status}`);
    await expect(page.getByTestId('order-payment')).toHaveAttribute('data-status', 'pending');
  }
  expect(orders()).toHaveLength(1);
  expect(stockOf(STORE.neutro)).toBe(stock);
});

test('dos pestañas, fallo al guardar la order y recuperación al recargar @pago-local', async ({ page, context }) => {
  const credentials = await createPaymentFixture(page);
  const { code, token } = credentials;
  const other = await context.newPage();
  await other.goto(`/pedido/${code}#t=${token}`);
  await expect(payButton(other)).toBeVisible();
  localSql(`
    create function private.fail_payment_test() returns trigger language plpgsql set search_path = '' as $$
    begin raise exception 'Fallo de persistencia de prueba'; end $$;
    create trigger fail_payment_test before update of provider_order_id on private.payment_attempts
      for each row when (new.provider_order_id is not null) execute function private.fail_payment_test();
  `);
  try {
    const responses = await Promise.all([page, other].map(async (tab) => {
      const response = tab.waitForResponse((entry) => entry.url().endsWith('/api/pedido/pago'));
      await payButton(tab).click();
      return response;
    }));
    expect(responses.map((response) => response.status()).sort()).toEqual([409, 503]);
  } finally {
    localSql('drop trigger fail_payment_test on private.payment_attempts; drop function private.fail_payment_test();');
  }
  const [remote] = localSql('select id from private.mock_checkout_orders') as { id: string }[];
  const [initial] = localSql('select idempotency_key from private.payment_attempts') as { idempotency_key: string }[];
  localSql("update private.payment_attempts set lease_until = clock_timestamp() - interval '1 second'");
  await other.reload();
  await payButton(other).click();
  await expect(other).toHaveURL(/\?pago=simulado$/);
  expect(localSql('select idempotency_key, provider_order_id from private.payment_attempts')).toEqual([
    { idempotency_key: initial.idempotency_key, provider_order_id: remote.id },
  ]);
  expect(localSql('select id from private.mock_checkout_orders')).toEqual([remote]);
});

for (const state of ['expired', 'cancelled', 'approved'] as const) {
  test(`impide iniciar pago para pedido ${state} @pago-local`, async ({ page }) => {
    const credentials = await createPaymentFixture(page);
    if (state === 'expired') {
      localSql(`
        alter table public.orders disable trigger orders_validar_cambios;
        update public.orders set reservation_expires_at = now() - interval '1 minute';
        alter table public.orders enable trigger orders_validar_cambios;
      `);
    } else if (state === 'cancelled') {
      localSql("do $$ begin perform private.liberar_reserva(id, 'cancelled', 'system', null) from public.orders; end $$;");
    } else {
      localSql("do $$ begin perform private.aplicar_pago(id, 'e2e-5b-fixture', 'approved', total_ars) from public.orders; end $$;");
    }
    await page.reload();
    await expect(page.getByTestId('order-status')).toBeVisible();
    await expect(payButton(page)).toHaveCount(0);
    expect((await page.request.post('/api/pedido/pago', { data: credentials })).status()).toBe(409);
    const unauthorized = await page.request.post('/api/pedido/pago', { data: { ...credentials, token: 'x'.repeat(43) } });
    const missing = await page.request.post('/api/pedido/pago', { data: { code: 'STF-0000-2345', token: 'x'.repeat(43) } });
    expect([unauthorized.status(), missing.status()]).toEqual([404, 404]);
    expect(await unauthorized.text()).toBe(await missing.text());
    expect(localSql('select id from private.payment_attempts')).toEqual([]);
  });
}

// ---------------------------------------------------------------------------
// flujo completo
// ---------------------------------------------------------------------------

test('compra sin registro: del carrito al pedido, envío con centavos y reserva descontada', async ({ page, context }) => {
  await preload(page, [{ productId: STORE.neutro, quantity: 2 }, { productId: STORE.balsamo, quantity: 1 }]);
  await page.goto('/tienda');
  await page.getByTestId('cart-button').filter({ visible: true }).click();
  await page.getByTestId('cart-drawer').getByRole('link', { name: 'Finalizar compra' }).click();
  await expect(page).toHaveURL(/\/checkout$/);

  // sin sesión: nadie pidió registrarse ni iniciar sesión
  expect((await context.cookies()).filter((c) => c.name.startsWith('sb-'))).toEqual([]);
  await expect(page.getByTestId('ck-subtotal')).toHaveText('$ 30.100');
  await expect(page.getByTestId('ck-shipping')).toHaveText('Elegí la provincia');
  await expect(page.getByTestId('ck-reason')).toHaveText('Elegí la provincia para calcular el envío.');

  await fillForm(page);
  await expect(page.getByTestId('ck-shipping')).toHaveText('$ 3.500,50');
  await expect(page.getByTestId('ck-total')).toHaveText('$ 33.600,50');
  await expect(barTotal(page)).toHaveText('$ 33.600,50');
  await expect(page.getByTestId('ck-line')).toHaveCount(2);

  await submit(page).click();
  const code = await waitForOrderPage(page);

  // la URL nunca lleva el token
  expect(page.url()).not.toContain('#');
  expect(page.url()).not.toMatch(/token|t=/);

  // pedido creado por la base con importes exactos y la reserva hecha
  const [order] = orders();
  expect(order).toMatchObject({ code, total: '33600.50', shipping: '3500.50', email: 'ana@steffen.test', name: 'Ana Pérez', payment: 'pending', stock_state: 'reserved' });
  expect(stockOf(STORE.neutro)).toBe(18);
  expect(stockOf(STORE.balsamo)).toBe(4);

  // seguimiento: estado, productos e importes
  await expect(page.getByTestId('order-payment')).toHaveText('Pendiente de pago');
  await expect(page.getByTestId('order-fulfillment')).toHaveText('Sin preparar');
  await expect(page.getByTestId('order-line')).toHaveCount(2);
  await expect(page.getByTestId('order-subtotal')).toHaveText('$ 30.100');
  await expect(page.getByTestId('order-shipping')).toHaveText('$ 3.500,50');
  await expect(page.getByTestId('order-total')).toHaveText('$ 33.600,50');
  await expect(page.getByTestId('order-payment-panel')).toContainText('El pago online todavía no está disponible');
  await expect(page.getByRole('button', { name: 'Pagar con Mercado Pago' })).toHaveCount(0);
  expect((await page.request.post('/api/pedido/pago', { data: {} })).status()).toBe(404);
  expect((await page.request.post('/api/mercadopago/webhook', { data: {} })).status()).toBe(404);

  // el carrito NO se vacía por crear un pedido pendiente de pago
  expect(await storedCart(page)).toHaveLength(2);
});

test('envío gratis desde el umbral de la zona', async ({ context }) => {
  // por debajo del umbral se cobra y se avisa desde cuánto es gratis
  const below = await context.newPage();
  await preload(below, [{ productId: STORE.balsamo, quantity: 1 }]);
  await below.goto('/checkout');
  await below.getByLabel('Provincia').selectOption('AR-X');
  await expect(below.getByTestId('ck-shipping')).toHaveText('$ 4.000');
  await expect(below.getByTestId('ck-total')).toHaveText('$ 9.000');
  await expect(below.getByTestId('ck-summary')).toContainText('Envío gratis desde $ 30.000');
  await below.close();

  // desde el umbral: gratis, y la base registra el envío en 0
  const page = await context.newPage();
  await preload(page, [{ productId: STORE.neutro, quantity: 2 }, { productId: STORE.balsamo, quantity: 1 }]);
  await page.goto('/checkout');
  await fillForm(page, { province: 'AR-X', city: 'Córdoba', postalCode: '5000', email: 'gratis@steffen.test' });
  await expect(page.getByTestId('ck-shipping')).toHaveText('Gratis');
  await expect(page.getByTestId('ck-total')).toHaveText('$ 30.100');
  await submit(page).click();
  await waitForOrderPage(page);
  await expect(page.getByTestId('order-shipping')).toHaveText('Gratis');
  expect(orders()[0]).toMatchObject({ total: '30100.00', shipping: '0.00' });
});

// ---------------------------------------------------------------------------
// validaciones y rechazos (el carrito se conserva siempre)
// ---------------------------------------------------------------------------

test('validación del formulario: errores accesibles, sin pedido y con el carrito intacto', async ({ page }) => {
  await preload(page, [{ productId: STORE.neutro, quantity: 1 }]);
  await page.goto('/checkout');
  await expect(page.getByTestId('ck-subtotal')).toHaveText('$ 12.550');

  await submit(page).click();
  const summary = page.getByTestId('ck-error-summary');
  await expect(summary).toBeVisible();
  await expect(summary).toBeFocused();
  await expect(summary).toHaveAttribute('role', 'alert');
  await expect(summary.getByRole('listitem')).toHaveCount(10);

  const email = page.getByLabel('Email');
  await expect(email).toHaveAttribute('aria-invalid', 'true');
  await expect(email).toHaveAccessibleDescription('Ingresá un email válido, por ejemplo nombre@correo.com.');
  // cada error del resumen lleva a su campo
  await summary.getByRole('link', { name: /código postal/ }).click();
  await expect(page).toHaveURL(/#ck-postalCode$/);

  // datos inválidos (no vacíos)
  await fillForm(page, { email: 'ana@', postalCode: '76', phone: 'llamame' });
  await submit(page).click();
  await expect(summary.getByRole('listitem')).toHaveCount(3);
  await expect(page.getByTestId('ck-error-postalCode')).toBeVisible();
  // corregir un campo quita su error
  await page.getByLabel('Email').fill('ana@steffen.test');
  await expect(page.getByTestId('ck-error-email')).toHaveCount(0);

  expect(orders()).toEqual([]);
  expect(await storedCart(page)).toEqual([{ productId: STORE.neutro, quantity: 1 }]);
});

test('provincia sin cobertura: se informa y no se puede confirmar', async ({ page }) => {
  await preload(page, [{ productId: STORE.neutro, quantity: 1 }]);
  await page.goto('/checkout');
  await expect(page.getByLabel('Provincia').locator('option[value="AR-V"]')).toHaveText(/sin envíos por ahora/);
  await fillForm(page, { province: 'AR-V', city: 'Ushuaia', postalCode: '9410' });
  await expect(page.getByTestId('ck-no-coverage')).toContainText('Todavía no hacemos envíos a Tierra del Fuego');
  await expect(page.getByTestId('ck-shipping')).toHaveText('Sin cobertura');
  await expect(barTotal(page)).toHaveText('—');

  await submit(page).click();
  await expect(banner(page)).toHaveText('Todavía no hacemos envíos a esa provincia.');
  expect(orders()).toEqual([]);

  // la base también lo rechaza si alguien lo intenta directo (total cualquiera)
  const response = await page.request.post('/api/checkout/pedido', {
    data: {
      idempotencyKey: 'n'.repeat(43),
      form: { ...formBody(), provinceCode: 'AR-V', city: 'Ushuaia', postalCode: '9410' },
      items: [{ productId: STORE.neutro, quantity: 1 }],
      expectedTotalCentavos: 1_255_000,
      acceptTerms: true,
    },
  });
  expect(response.status()).toBe(409);
  expect((await response.json()).error).toBe('no_shipping_coverage');
  expect(orders()).toEqual([]);
  expect(await storedCart(page)).toHaveLength(1);
});

test('producto inactivo en el carrito: no se puede confirmar', async ({ page }) => {
  await preload(page, [{ productId: STORE.neutro, quantity: 1 }, { productId: STORE.inactivo, quantity: 1 }]);
  await page.goto('/checkout');
  await fillForm(page);
  const hidden = page.getByTestId('ck-line').filter({ hasText: 'Producto no disponible' });
  await expect(hidden.getByTestId('ck-line-status')).toHaveText('Ya no está disponible');
  await expect(page.getByTestId('ck-summary')).not.toContainText('Producto Inactivo');
  await expect(page.getByTestId('ck-reason')).toContainText('no se pueden comprar');
  await submit(page).click();
  await expect(banner(page)).toContainText('no se pueden comprar');
  expect(orders()).toEqual([]);
  expect(await storedCart(page)).toHaveLength(2);
});

test('stock insuficiente al confirmar: la base rechaza, no reserva nada y el carrito queda', async ({ page }) => {
  await preload(page, [{ productId: STORE.argan, quantity: 2 }]);
  await page.goto('/checkout');
  await fillForm(page);
  await expect(page.getByTestId('ck-total')).toHaveText('$ 33.500,50');

  // otra compra se lleva una unidad justo antes de que llegue la confirmación
  await page.route('**/api/checkout/pedido', async (route) => {
    localSql(`update public.products set stock = 1 where id = '${STORE.argan}'`);
    await route.continue();
  });
  await submit(page).click();
  await expect(banner(page)).toHaveText('No hay stock suficiente de algunos productos.');
  expect(orders()).toEqual([]);
  expect(stockOf(STORE.argan)).toBe(1); // nada descontado
  // el carrito se conserva: el producto sigue, ajustado a lo que se puede comprar (con aviso, como en 4B.4)
  await expect.poll(() => storedCart(page)).toEqual([{ productId: STORE.argan, quantity: 1 }]);
  await expect(barTotal(page)).toHaveText('$ 18.500,50');
});

// ---------------------------------------------------------------------------
// cambios de precio y reconfirmación
// ---------------------------------------------------------------------------

test('cambio de precio entre la cotización y la confirmación: muestra el nuevo total y pide reconfirmar', async ({ page }) => {
  await preload(page, [{ productId: STORE.neutro, quantity: 1 }]);
  await page.goto('/checkout');
  await fillForm(page, { email: 'precio@steffen.test' });
  await expect(barTotal(page)).toHaveText('$ 16.050,50');

  localSql(`update public.products set price_ars = 13000 where id = '${STORE.neutro}'`);
  await submit(page).click();
  await expect(banner(page)).toHaveText(
    'El total cambió de $ 16.050,50 a $ 16.500,50 (precio o envío actualizado). Revisá el resumen y confirmá de nuevo.',
  );
  await expect(barTotal(page)).toHaveText('$ 16.500,50');
  await expect(page.getByTestId('ck-total-change')).toHaveText('antes $ 16.050,50');
  await expect(submit(page)).toHaveText('Confirmar nuevo total');
  expect(orders()).toEqual([]); // nada se crea sin aceptar el nuevo importe

  await submit(page).click();
  await waitForOrderPage(page);
  expect(orders()[0]).toMatchObject({ total: '16500.50' });
});

test('cambio de precio durante la confirmación: la base rechaza el total viejo y se reconfirma', async ({ page }) => {
  await preload(page, [{ productId: STORE.neutro, quantity: 1 }]);
  await page.goto('/checkout');
  await fillForm(page, { email: 'carrera@steffen.test' });
  await expect(barTotal(page)).toHaveText('$ 16.050,50');

  let first = true;
  await page.route('**/api/checkout/pedido', async (route) => {
    if (first) {
      first = false;
      localSql(`update public.products set price_ars = 12000 where id = '${STORE.neutro}'`);
    }
    await route.continue();
  });
  await submit(page).click();
  await expect(banner(page)).toHaveText(
    'El total cambió de $ 16.050,50 a $ 15.500,50 (precio o envío actualizado). Revisá el resumen y confirmá de nuevo.',
  );
  expect(orders()).toEqual([]);
  expect(stockOf(STORE.neutro)).toBe(20);
  expect(await storedCart(page)).toHaveLength(1);

  await submit(page).click();
  await waitForOrderPage(page);
  expect(orders()).toHaveLength(1);
  expect(orders()[0].total).toBe('15500.50');
});

// ---------------------------------------------------------------------------
// idempotencia
// ---------------------------------------------------------------------------

test('doble clic: un solo pedido y una sola reserva', async ({ page }) => {
  await preload(page, [{ productId: STORE.neutro, quantity: 3 }]);
  await page.goto('/checkout');
  await fillForm(page, { email: 'doble@steffen.test' });
  await expect(barTotal(page)).toHaveText('$ 41.150,50');

  const posts: Request[] = [];
  page.on('request', (r) => r.url().endsWith('/api/checkout/pedido') && posts.push(r));
  await submit(page).dblclick();
  await waitForOrderPage(page);
  expect(posts).toHaveLength(1); // el segundo clic no envía nada
  expect(orders()).toHaveLength(1);
  expect(stockOf(STORE.neutro)).toBe(17);
});

test('misma clave enviada varias veces a la vez: el mismo pedido; con otro contenido se rechaza', async ({ request }) => {
  const body = {
    idempotencyKey: 'k'.repeat(43),
    form: { ...formBody(), email: 'rafaga@steffen.test' },
    items: [{ productId: STORE.neutro, quantity: 2 }],
    expectedTotalCentavos: 2_860_050,
    acceptTerms: true,
  };
  const responses = await Promise.all([1, 2, 3].map(() => request.post('/api/checkout/pedido', { data: body })));
  const results = await Promise.all(responses.map((r) => r.json()));
  expect(responses.map((r) => r.status())).toEqual([200, 200, 200]);
  expect(new Set(results.map((r) => r.code)).size).toBe(1);
  expect(results.map((r) => r.status).sort()).toEqual(['created', 'replayed', 'replayed']);
  expect(orders()).toHaveLength(1);
  expect(stockOf(STORE.neutro)).toBe(18); // reservado una sola vez

  // la misma clave con otra cantidad: rechazada, sin datos del pedido existente
  const conflict = await request.post('/api/checkout/pedido', { data: { ...body, items: [{ productId: STORE.neutro, quantity: 1 }], expectedTotalCentavos: 1_605_050 } });
  expect(conflict.status()).toBe(409);
  const json = await conflict.json();
  expect(json.error).toBe('idempotency_conflict');
  expect(JSON.stringify(json)).not.toMatch(/STF-|token/);
  expect(orders()).toHaveLength(1);
});

test('reintento de red: la respuesta se pierde, el navegador reintenta con la misma clave y no duplica', async ({ page }) => {
  await preload(page, [{ productId: STORE.balsamo, quantity: 2 }]);
  await page.goto('/checkout');
  await fillForm(page, { email: 'red@steffen.test' });
  await expect(barTotal(page)).toHaveText('$ 13.500,50');

  const keys: string[] = [];
  let first = true;
  await page.route('**/api/checkout/pedido', async (route) => {
    keys.push(route.request().postDataJSON().idempotencyKey);
    if (first) {
      first = false;
      await route.fetch(); // el servidor crea el pedido…
      await route.abort('connectionreset'); // …pero la respuesta nunca llega
      return;
    }
    await route.continue();
  });
  await submit(page).click();
  await waitForOrderPage(page);
  expect(keys).toHaveLength(2);
  expect(keys[1]).toBe(keys[0]);
  expect(keys[0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
  expect(orders()).toHaveLength(1);
  expect(stockOf(STORE.balsamo)).toBe(3);
});

test('recargar después de un error reutiliza la clave mientras la compra no cambie', async ({ page }) => {
  await preload(page, [{ productId: STORE.balsamo, quantity: 1 }]);
  await page.goto('/checkout');
  await fillForm(page, { email: 'recarga@steffen.test' });
  await expect(barTotal(page)).toHaveText('$ 8.500,50');

  const keys: string[] = [];
  await page.route('**/api/checkout/pedido', async (route) => {
    keys.push(route.request().postDataJSON().idempotencyKey);
    await route.abort('failed'); // sin red: 1 intento + 2 reintentos automáticos
  });
  await submit(page).click();
  await expect(banner(page)).toContainText('problema de conexión');
  expect(new Set(keys).size).toBe(1);
  await page.unroute('**/api/checkout/pedido');

  await page.reload();
  await fillForm(page, { email: 'recarga@steffen.test' });
  const sent = page.waitForRequest('**/api/checkout/pedido');
  await submit(page).click();
  expect((await sent).postDataJSON().idempotencyKey).toBe(keys[0]);
  await waitForOrderPage(page);
  expect(orders()).toHaveLength(1);
});

// ---------------------------------------------------------------------------
// checkout deshabilitado
// ---------------------------------------------------------------------------

test('con checkout_enabled = false no se puede crear un pedido (ni desde la página ni por la API)', async ({ page }) => {
  setLocalCheckout(false);
  await preload(page, [{ productId: STORE.neutro, quantity: 1 }]);
  await page.goto('/checkout');
  await expect(page.getByTestId('ck-disabled')).toContainText('todavía no están habilitadas');
  await fillForm(page);
  await expect(submit(page)).toBeDisabled();

  const response = await page.request.post('/api/checkout/pedido', {
    data: { idempotencyKey: 'd'.repeat(43), form: formBody(), items: [{ productId: STORE.neutro, quantity: 1 }], expectedTotalCentavos: 1_605_050, acceptTerms: true },
  });
  expect(response.status()).toBe(409);
  expect((await response.json()).error).toBe('checkout_disabled');
  expect(orders()).toEqual([]);
  expect(stockOf(STORE.neutro)).toBe(20);
  expect(await storedCart(page)).toHaveLength(1);
});

// ---------------------------------------------------------------------------
// seguimiento
// ---------------------------------------------------------------------------

function formBody() {
  return {
    firstName: BUYER.firstName,
    lastName: BUYER.lastName,
    email: BUYER.email,
    phone: BUYER.phone,
    provinceCode: BUYER.province,
    city: BUYER.city,
    postalCode: BUYER.postalCode,
    street: BUYER.street,
    number: BUYER.number,
    unit: '4° B',
    notes: 'Tocar timbre del fondo',
  };
}

async function createViaApi(page: Page, email: string) {
  const response = await page.request.post('/api/checkout/pedido', {
    data: {
      idempotencyKey: `seg${email.replace(/[^a-z]/g, '')}`.padEnd(43, 'x'),
      form: { ...formBody(), email },
      items: [{ productId: STORE.neutro, quantity: 1 }],
      expectedTotalCentavos: 1_605_050,
      acceptTerms: true,
    },
  });
  expect(response.status()).toBe(200);
  return (await response.json()) as { code: string; token: string };
}

test('seguimiento: token válido muestra el pedido y se quita de la URL; inválido o ausente no revela nada', async ({ page, browser }) => {
  const { code, token } = await createViaApi(page, 'seguimiento@steffen.test');
  expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);

  // enlace privado: el token va en el fragmento y desaparece de la barra de direcciones
  const loads: string[] = [];
  page.on('request', (r) => loads.push(r.url()));
  const response = await page.goto(`/pedido/${code}#t=${token}`);
  await expect(page.getByTestId('order-code')).toHaveText(code);
  expect(page.url()).toMatch(new RegExp(`/pedido/${code}$`));
  expect(loads.some((u) => u.includes(token))).toBe(false); // ninguna URL pedida lleva el token

  // cabeceras: sin caché, sin Referer, sin indexar
  const headers = response!.headers();
  expect(headers['cache-control']).toMatch(/no-store/);
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['x-robots-tag']).toMatch(/noindex/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
  await expect(page.locator('meta[name="referrer"]')).toHaveAttribute('content', 'no-referrer');

  // datos personales: ni en la página ni en la respuesta de la API
  const html = await page.content();
  for (const personal of ['seguimiento@steffen.test', '223 555-1234', 'Av. Colón', 'Mar del Plata', 'Tocar timbre', 'Pérez', '4° B']) {
    expect(html, personal).not.toContain(personal);
  }
  const api = await page.request.post('/api/pedido/consultar', { data: { code, token } });
  expect(api.status()).toBe(200);
  expect(api.headers()['cache-control']).toMatch(/no-store/);
  const apiText = await api.text();
  for (const personal of ['steffen.test', '555', 'Colón', 'Mar del Plata', 'Pérez', 'timbre', 'email', 'phone', 'street']) {
    expect(apiText, personal).not.toContain(personal);
  }
  await expect(page.getByTestId('order-shipping')).toHaveText('$ 3.500,50');

  // otra pestaña / dispositivo sin el token: no ve nada
  const other = await browser.newContext();
  const stranger = await other.newPage();
  await stranger.goto(`/pedido/${code}`);
  await expect(stranger.getByTestId('order-not-found')).toContainText('No encontramos un pedido con este enlace.');
  // token incorrecto: exactamente lo mismo que un pedido inexistente
  const wrong = token.slice(0, -1) + (token.endsWith('A') ? 'B' : 'A');
  await stranger.goto(`/pedido/${code}#t=${wrong}`);
  const wrongText = await stranger.getByTestId('order-not-found').innerText();
  await stranger.goto(`/pedido/STF-2611-ZZZZ#t=${token}`);
  expect(await stranger.getByTestId('order-not-found').innerText()).toBe(wrongText);
  await other.close();

  // API: código inexistente, token incorrecto o mal formado → la misma respuesta 404
  const answers = await Promise.all(
    [
      { code, token: wrong },
      { code: 'STF-2611-ZZZZ', token },
      { code, token: 'corto' },
      { code: 'cualquiera', token },
    ].map((data) => page.request.post('/api/pedido/consultar', { data })),
  );
  for (const a of answers) {
    expect(a.status()).toBe(404);
    expect(await a.json()).toEqual({ error: 'not_found' });
  }
  // el token no se acepta por la URL
  expect((await page.request.get(`/api/pedido/consultar?code=${code}&token=${token}`)).status()).toBe(404);
});

test('el checkout no se indexa ni manda Referer', async ({ page }) => {
  await preload(page, [{ productId: STORE.neutro, quantity: 1 }]);
  const response = await page.goto('/checkout');
  const headers = response!.headers();
  expect(headers['cache-control']).toMatch(/no-store/);
  expect(headers['referrer-policy']).toBe('no-referrer');
  expect(headers['x-robots-tag']).toMatch(/noindex/);
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', /noindex/);
});

// ---------------------------------------------------------------------------
// accesibilidad
// ---------------------------------------------------------------------------

test('accesibilidad: etiquetas, autocompletado, teclado y anuncios', async ({ page }) => {
  await preload(page, [{ productId: STORE.neutro, quantity: 1 }]);
  await page.goto('/checkout');
  await expect(page.getByTestId('ck-subtotal')).toHaveText('$ 12.550');

  // todos los controles tienen etiqueta visible
  const unlabeled = await page
    .getByTestId('ck-form')
    .locator('input, select, textarea')
    .evaluateAll((els) => els.filter((el) => !(el as HTMLInputElement).labels?.length).map((el) => el.id));
  expect(unlabeled).toEqual([]);

  // autocompletado de datos personales y dirección
  const autocomplete = await page
    .getByTestId('ck-form')
    .locator('[autocomplete]')
    .evaluateAll((els) => Object.fromEntries(els.map((el) => [el.id, el.getAttribute('autocomplete')])));
  expect(autocomplete).toEqual({
    'ck-firstName': 'given-name',
    'ck-lastName': 'family-name',
    'ck-email': 'email',
    'ck-phone': 'tel',
    'ck-provinceCode': 'address-level1',
    'ck-city': 'address-level2',
    'ck-postalCode': 'postal-code',
    'ck-street': 'address-line1',
    'ck-unit': 'address-line2',
  });
  await expect(page.getByLabel('Email')).toHaveAttribute('type', 'email');
  await expect(page.getByLabel('Teléfono')).toHaveAttribute('type', 'tel');

  // grupos con nombre
  await expect(page.getByRole('group', { name: 'Contacto' })).toBeVisible();
  await expect(page.getByRole('group', { name: 'Entrega' })).toBeVisible();

  // se completa y confirma solo con teclado
  await page.getByLabel('Nombre', { exact: true }).focus();
  await page.keyboard.type('Ana');
  await page.keyboard.press('Tab');
  await expect(page.getByLabel('Apellido')).toBeFocused();
  await fillForm(page, { email: 'teclado@steffen.test' });
  await page.getByLabel(/Acepto los términos/).focus();
  await page.keyboard.press('Tab');
  // Fase 4B.7: ambos documentos son enlaces accesibles entre la casilla y confirmar.
  const terms = page.getByTestId('ck-form').getByRole('link', { name: 'términos y condiciones', exact: true });
  await expect(terms).toBeFocused();
  await expect(terms).toHaveAttribute('href', '/terminos-y-condiciones');
  await expect(terms).toHaveAttribute('target', '_blank');
  await page.keyboard.press('Tab');
  const privacy = page.getByTestId('ck-form').getByRole('link', { name: 'política de privacidad', exact: true });
  await expect(privacy).toBeFocused();
  await expect(privacy).toHaveAttribute('href', '/politica-de-privacidad');
  await expect(privacy).toHaveAttribute('target', '_blank');
  await page.keyboard.press('Tab');
  await expect(submit(page)).toBeFocused();
  await page.keyboard.press('Enter');
  await waitForOrderPage(page);
  // en el seguimiento, el enlace privado se copia con un botón
  await expect(page.getByTestId('order-copy-link')).toHaveText('Copiar enlace privado');
});

// ---------------------------------------------------------------------------
// responsive (capturas para revisión)
// ---------------------------------------------------------------------------

for (const size of [
  { name: 'celular', width: 390, height: 844 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'escritorio', width: 1440, height: 900 },
]) {
  test(`responsive ${size.width} px: checkout y seguimiento`, async ({ page }) => {
    await page.setViewportSize({ width: size.width, height: size.height });
    await preload(page, [{ productId: STORE.neutro, quantity: 2 }, { productId: STORE.balsamo, quantity: 1 }]);
    await page.goto('/checkout');
    await fillForm(page, { email: `${size.name}@steffen.test` });
    await expect(barTotal(page)).toHaveText('$ 33.600,50');

    // sin scroll horizontal
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

    const bar = page.getByTestId('ck-bar');
    const summary = page.getByTestId('ck-summary');
    if (size.width < 960) {
      // barra fija abajo con el total siempre visible
      expect(await bar.evaluate((el) => getComputedStyle(el).position)).toBe('fixed');
      await page.mouse.wheel(0, 300);
      await expect(barTotal(page)).toBeInViewport();
      // resumen plegado; se despliega con el botón
      const toggle = summary.getByRole('button', { name: /Resumen de compra/ });
      await expect(toggle).toHaveAttribute('aria-expanded', 'false');
      await expect(page.getByTestId('ck-line').first()).toBeHidden();
      await toggle.click();
      await expect(toggle).toHaveAttribute('aria-expanded', 'true');
      await expect(page.getByTestId('ck-line')).toHaveCount(2);
      await expect(page.getByTestId('ck-line').first()).toBeVisible();
      // la barra no tapa el último contenido del formulario: con el final del formulario en el borde inferior
      // de la pantalla, la última nota queda por encima de la barra
      await page.getByTestId('ck-form').evaluate((form) => window.scrollBy(0, form.getBoundingClientRect().bottom - window.innerHeight));
      const note = await page.locator('#ck-form-note').boundingBox();
      const barBox = await bar.boundingBox();
      expect(note!.y + note!.height).toBeLessThanOrEqual(barBox!.y);
      // ni el botón de WhatsApp
      const wa = await page.locator('.whatsapp-float').boundingBox();
      if (wa) expect(wa.y + wa.height).toBeLessThanOrEqual(barBox!.y);
      // así lo ve el comprador: la barra fija al pie de la pantalla
      await page.screenshot({ path: test.info().outputPath(`checkout-${size.width}-pantalla.png`) });
    } else {
      // formulario a la izquierda y resumen fijo a la derecha
      const formBox = await page.getByTestId('ck-form').boundingBox();
      const summaryBox = await summary.boundingBox();
      expect(summaryBox!.x).toBeGreaterThan(formBox!.x + formBox!.width - 1);
      expect(await summary.evaluate((el) => getComputedStyle(el).position)).toBe('sticky');
      await expect(page.getByTestId('ck-line').first()).toBeVisible();
      await page.mouse.wheel(0, 600);
      await expect(page.getByTestId('ck-total')).toBeInViewport();
    }

    await page.evaluate(() => window.scrollTo(0, 0));
    await page.screenshot({ path: test.info().outputPath(`checkout-${size.width}.png`), fullPage: true });

    await submit(page).click();
    await waitForOrderPage(page);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await page.screenshot({ path: test.info().outputPath(`pedido-${size.width}.png`), fullPage: true });
  });
}
