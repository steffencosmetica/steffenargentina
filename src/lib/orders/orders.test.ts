import { test } from 'node:test';
import assert from 'node:assert/strict';
import { LOCAL_DEV_IP, trustedClientIp, trustedProxyFromEnv } from './client-ip.ts';
import { describeRejection, parseCreateOrderResult, REJECTION_CODES } from './errors.ts';
import { isIdempotencyKey, newIdempotencyKey, normalizeCheckout, validateCheckout, type CheckoutInput } from './validation.ts';
import { PROVINCE_CODES } from '../shipping/regions.ts';

const PROVINCES = new Set<string>(PROVINCE_CODES);
const P1 = '20000000-0000-0000-0000-000000000001';
const P2 = '20000000-0000-0000-0000-000000000002';

function input(overrides: { buyer?: object; shipping?: object; items?: CheckoutInput['items'] } = {}): CheckoutInput {
  return {
    buyer: { name: 'Ana Pérez', email: 'ana@test.com', phone: '+54 11 5555-0000', ...overrides.buyer },
    shipping: { street: 'Av. Corrientes', number: '1234', city: 'CABA', postal_code: 'C1043AAA', province_code: 'AR-C', ...overrides.shipping },
    items: overrides.items ?? [{ product_id: P1, quantity: 2 }],
  };
}

// ---------------------------------------------------------------------------
// IP de confianza
// ---------------------------------------------------------------------------

test('la IP solo se toma del proxy de confianza (Vercel)', () => {
  const h = new Headers({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '1.1.1.1, 203.0.113.7' });
  assert.equal(trustedClientIp(h, 'vercel'), '203.0.113.7');
  assert.equal(trustedClientIp(new Headers({ 'x-vercel-forwarded-for': '2001:db8::1, 10.0.0.1' }), 'vercel'), '2001:db8::1');
  assert.equal(trustedClientIp(new Headers({ 'x-real-ip': '[2001:db8::2]' }), 'vercel'), '2001:db8::2');
});

test('sin proxy de confianza no se usa ningún header (los manda el cliente)', () => {
  const h = new Headers({ 'x-real-ip': '203.0.113.7', 'x-forwarded-for': '203.0.113.7', 'x-vercel-forwarded-for': '203.0.113.7' });
  assert.equal(trustedClientIp(h, 'none'), null);
  assert.equal(trustedProxyFromEnv({}), 'none');
  assert.equal(trustedProxyFromEnv({ VERCEL: '1' }), 'vercel');
  assert.equal(LOCAL_DEV_IP, '127.0.0.1');
});

test('regresión: valores que no son IP se descartan', () => {
  assert.equal(trustedClientIp(new Headers({ 'x-real-ip': 'evil' }), 'vercel'), null);
  assert.equal(trustedClientIp(new Headers({ 'x-real-ip': "1.2.3.4'; drop table orders;--" }), 'vercel'), null);
  assert.equal(trustedClientIp(new Headers({ 'x-real-ip': '' }), 'vercel'), null);
  assert.equal(trustedClientIp(new Headers(), 'vercel'), null);
});

// ---------------------------------------------------------------------------
// Validación (espejo de private.normalizar_checkout)
// ---------------------------------------------------------------------------

test('datos válidos: sin errores', () => {
  assert.deepEqual(validateCheckout(input(), PROVINCES), []);
  assert.deepEqual(validateCheckout(input({ buyer: { document: '30.123.456' }, shipping: { number: 's/n', unit: '3 B' } }), PROVINCES), []);
});

test('normaliza como la base: espacios, mayúsculas del email, documento y código postal', () => {
  const n = normalizeCheckout(input({ buyer: { name: '  Ana   Pérez ', email: 'Ana@Test.COM', document: '30.123.456' }, shipping: { postal_code: 'c1043 aaa' } }));
  assert.equal(n.buyer.name, 'Ana Pérez');
  assert.equal(n.buyer.email, 'ana@test.com');
  assert.equal(n.buyer.document, '30123456');
  assert.equal(n.shipping.postal_code, 'C1043AAA');
  assert.equal(n.shipping.unit, null);
});

test('informa todos los campos inválidos con los mismos nombres que la base', () => {
  const errors = validateCheckout(
    input({
      buyer: { name: 'A', email: 'no-es-email', phone: '12' },
      shipping: { street: 'X', number: '', city: 'C', postal_code: 'ABC', province_code: 'AR-ZZ' },
    }),
    PROVINCES,
  );
  assert.deepEqual(errors, [
    'buyer.name',
    'buyer.email',
    'buyer.phone',
    'shipping.street',
    'shipping.number',
    'shipping.city',
    'shipping.postal_code',
    'shipping.province_code',
  ]);
});

test('documento opcional: vacío se omite, puntos solos se rechazan', () => {
  assert.deepEqual(validateCheckout(input({ buyer: { document: '' } }), PROVINCES), []);
  assert.deepEqual(validateCheckout(input({ buyer: { document: '...' } }), PROVINCES), ['buyer.document']);
  assert.deepEqual(validateCheckout(input({ buyer: { document: '123' } }), PROVINCES), ['buyer.document']);
});

test('caracteres de control rechazados en textos libres', () => {
  assert.deepEqual(validateCheckout(input({ shipping: { notes: 'hola\u0000' } }), PROVINCES), ['shipping.notes']);
  assert.deepEqual(validateCheckout(input({ shipping: { notes: 'x'.repeat(501) } }), PROVINCES), ['shipping.notes']);
});

test('artículos: entre 1 y 50, uuid, cantidad entera positiva y sin repetir', () => {
  assert.deepEqual(validateCheckout(input({ items: [] }), PROVINCES), ['items']);
  assert.deepEqual(validateCheckout(input({ items: [{ product_id: 'x', quantity: 1 }] }), PROVINCES), ['items']);
  assert.deepEqual(validateCheckout(input({ items: [{ product_id: P1, quantity: 0 }] }), PROVINCES), ['items']);
  assert.deepEqual(validateCheckout(input({ items: [{ product_id: P1, quantity: 1.5 }] }), PROVINCES), ['items']);
  assert.deepEqual(
    validateCheckout(input({ items: [{ product_id: P1, quantity: 1 }, { product_id: P1.toUpperCase(), quantity: 1 }] }), PROVINCES),
    ['items.duplicate'],
  );
  assert.deepEqual(validateCheckout(input({ items: [{ product_id: P1, quantity: 1 }, { product_id: P2, quantity: 3 }] }), PROVINCES), []);
});

test('clave de idempotencia: aleatoria y con el formato que exige la base', () => {
  const a = newIdempotencyKey();
  assert.ok(isIdempotencyKey(a));
  assert.notEqual(a, newIdempotencyKey());
  assert.equal(isIdempotencyKey('corta'), false);
  assert.equal(isIdempotencyKey('a'.repeat(129)), false);
  assert.equal(isIdempotencyKey('x'.repeat(31) + '!'), false);
  assert.equal(isIdempotencyKey(42), false);
});

// ---------------------------------------------------------------------------
// Resultado de crear_pedido
// ---------------------------------------------------------------------------

test('pedido creado o repetido: importes a centavos exactos', () => {
  const r = parseCreateOrderResult({
    status: 'replayed',
    order_id: 'ac8722f5-3ea0-48bc-9480-a1309fc1f249',
    code: 'STF-2611-3RFW',
    token: 'DcOeEO71RXmbF3duSCWFHZYeseYfv9KhkM_K2NXvELk',
    subtotal_ars: 9501.5,
    shipping_ars: 5000,
    total_ars: 14501.5,
    reservation_expires_at: '2026-11-03T00:52:13+00:00',
  });
  if (r.status === 'rejected') assert.fail('no debía ser un rechazo');
  assert.equal(r.status, 'replayed');
  assert.equal(r.totalCentavos, 1_450_150);
});

test('rechazos: código conocido, campos, productos y total vigente', () => {
  const total = parseCreateOrderResult({
    status: 'rejected',
    error: 'total_mismatch',
    detail: { subtotal_ars: 1200, shipping_ars: 5000, total_ars: 6200 },
  });
  assert.deepEqual(total, { status: 'rejected', error: 'total_mismatch', fields: [], productIds: [], currentTotalCentavos: 620_000 });

  const invalid = parseCreateOrderResult({ status: 'rejected', error: 'invalid_input', detail: { fields: ['buyer.email', 'otro'] } });
  assert.ok(invalid.status === 'rejected' && invalid.fields.length === 1 && invalid.fields[0] === 'buyer.email');

  const stock = parseCreateOrderResult({ status: 'rejected', error: 'insufficient_stock', detail: { product_ids: [P1] } });
  assert.ok(stock.status === 'rejected' && stock.productIds[0] === P1);

  const unknown = parseCreateOrderResult({ status: 'rejected', error: 'falla_simulada', detail: {} });
  assert.ok(unknown.status === 'rejected' && unknown.error === 'unknown');
});

test('respuestas con forma inesperada lanzan', () => {
  assert.throws(() => parseCreateOrderResult(null));
  assert.throws(() => parseCreateOrderResult({ status: 'created' }));
  assert.throws(() => parseCreateOrderResult({ status: 'otro' }));
});

test('todos los rechazos tienen mensaje y ninguno menciona cantidades de stock', () => {
  for (const code of [...REJECTION_CODES, 'unknown' as const]) {
    const message = describeRejection(code);
    assert.ok(message.length > 10, code);
    assert.doesNotMatch(message, /\d/, `${code}: sin números`);
  }
});

test('entorno local y IP de respaldo: fallan cerrado en Vercel y en un VPS sin proxy de confianza (4B.8)', async () => {
  const { isLocalEnvironment, clientIpFor } = await import('./client-ip.ts');
  const none = new Headers({ 'x-forwarded-for': '203.0.113.9', 'x-real-ip': '203.0.113.9' });
  const local = { NODE_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321' };
  const vps = { NODE_ENV: 'production', NEXT_PUBLIC_SUPABASE_URL: 'https://zzxlghpopmccwsaqbsko.supabase.co' };
  assert.equal(isLocalEnvironment(local), true);
  assert.equal(isLocalEnvironment({ NODE_ENV: 'development', NEXT_PUBLIC_SUPABASE_URL: vps.NEXT_PUBLIC_SUPABASE_URL }), true, 'next dev');
  assert.equal(isLocalEnvironment(vps), false, 'VPS de producción');
  assert.equal(isLocalEnvironment({ ...local, VERCEL: '1' }), false);
  assert.equal(isLocalEnvironment({ ...local, VERCEL_ENV: 'preview' }), false);
  assert.equal(isLocalEnvironment({ NODE_ENV: 'production' }), false, 'sin Supabase configurado');
  // los encabezados enviados por el cliente nunca se usan sin un proxy de confianza
  assert.equal(clientIpFor(none, local), '127.0.0.1');
  assert.equal(clientIpFor(none, vps), null, 'VPS: sin IP compartida para todos');
  assert.equal(clientIpFor(new Headers({ 'x-real-ip': '198.51.100.7' }), { ...vps, VERCEL: '1' }), '198.51.100.7');
});
