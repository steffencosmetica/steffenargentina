import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildPaymentOrder, localPaymentOrigin, providerError, validatedCheckoutUrl, validateMockOrder } from './payment.ts';

const origin = 'http://localhost:3103';
const snapshot = {
  reference: 'STF-2026-2345', total: '0.81', shipping: '0.21', expirationSeconds: 850,
  items: [{ title: 'Producto histórico', unitPrice: '0.20', quantity: 3 }],
};

test('Orders Checkout Pro: importes históricos exactos, envío, efectivo excluido y hasta seis cuotas', () => {
  const order = buildPaymentOrder(snapshot, origin);
  assert.equal(order.type, 'online');
  assert.equal(order.processing_mode, 'manual');
  assert.equal(order.total_amount, '0.81');
  assert.equal(order.expiration_time, 'PT850S');
  assert.equal(order.config.statement_descriptor, 'STEFFEN');
  assert.deepEqual(order.items, [
    { title: 'Producto histórico', quantity: 3, unit_price: '0.20' },
    { title: 'Envío del pedido', quantity: 1, unit_price: '0.21' },
  ]);
  assert.deepEqual(order.config.payment_method, { not_allowed_types: ['ticket'], max_installments: 6 });
  assert.deepEqual(Object.values(order.config.online), ['finalizado', 'pendiente', 'rechazado']
    .map((status) => `${origin}/pedido/${snapshot.reference}?pago=${status}`));
  assert.equal(buildPaymentOrder({ ...snapshot, shipping: '0.00', total: '0.60' }, origin).items.length, 1);
});

test('rechaza diferencias de un centavo, sintaxis monetaria y vencimientos inválidos', () => {
  assert.throws(() => buildPaymentOrder({ ...snapshot, total: '0.80' }, origin), /amount_mismatch/);
  assert.throws(() => buildPaymentOrder({ ...snapshot, shipping: '0.210' }, origin), /invalid_amount/);
  assert.throws(() => buildPaymentOrder({ ...snapshot, expirationSeconds: 0 }, origin), /invalid_snapshot/);
  assert.throws(() => buildPaymentOrder({ ...snapshot, items: [] }, origin), /invalid_snapshot/);
});

test('el simulador requiere desarrollo, modo explícito y un origen loopback exacto', () => {
  const env = { NODE_ENV: 'development', STEFFEN_MP_MODE: 'mock', STEFFEN_MP_LOCAL_ORIGIN: origin };
  assert.equal(localPaymentOrigin(env), origin);
  assert.equal(localPaymentOrigin({ ...env, NODE_ENV: 'production' }), null);
  assert.equal(localPaymentOrigin({ ...env, STEFFEN_MP_MODE: 'real' }), null);
  assert.equal(localPaymentOrigin({ ...env, STEFFEN_MP_LOCAL_ORIGIN: origin + '@example.test' }), null);
  assert.equal(localPaymentOrigin({ NODE_ENV: 'development', MP_ACCESS_TOKEN: 'fake' }), null);
});

test('valida identidad, cuenta, importe y URL del checkout simulado', () => {
  const order = buildPaymentOrder(snapshot, origin);
  const path = `/pedido/${snapshot.reference}?pago=simulado`;
  const raw = { id: 'ORDMOCK' + 'a'.repeat(32), status: 'created', currency: 'ARS',
    user_id: 'local-simulator', external_reference: snapshot.reference, total_amount: snapshot.total, checkout_url: origin + path };
  assert.deepEqual(validateMockOrder(raw, order, origin), { id: raw.id, checkoutUrl: origin + path });
  for (const change of [{ status: 'processed' }, { currency: 'USD' }, { user_id: 'different' },
    { total_amount: '0.82' }, { external_reference: 'STF-2026-3456' }, { id: '../other' }]) {
    assert.throws(() => validateMockOrder({ ...raw, ...change }, order, origin));
  }
  assert.equal(validatedCheckoutUrl(origin + path, origin, snapshot.reference), origin + path);
  for (const url of ['https://example.test' + path, origin + path + '&next=https://example.test',
    origin + path + '#secret', 'http://user@localhost:3103' + path, origin + '/other']) {
    assert.throws(() => validatedCheckoutUrl(url, origin, snapshot.reference));
  }
});

test('los errores ambiguos conservan una clasificación técnica', () => {
  assert.deepEqual([409, 408, 504, 429, 500, 400].map(providerError),
    ['conflict', 'timeout', 'timeout', 'unavailable', 'unavailable', 'invalid_response']);
});
