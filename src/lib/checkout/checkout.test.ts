import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  checkoutFingerprint,
  EMPTY_FORM,
  FORM_FIELDS,
  formFieldsFromDb,
  fullName,
  newCheckoutKey,
  parseCreateOrderRequest,
  parseSummaryRequest,
  toCheckoutInput,
  validateForm,
  type CheckoutFormData,
} from './request.ts';
import { isOrderCode, isOrderToken, parseOrderLookup, tokenFromHash } from './order-view.ts';
import { blockedReason, canConfirm, type CheckoutSummary } from './summary.ts';

const P1 = '00000000-0000-4000-8000-0000000000a1';
const P2 = '00000000-0000-4000-8000-0000000000a2';
const PROVINCES = new Set(['AR-B', 'AR-C', 'AR-X']);
const FORM: CheckoutFormData = {
  firstName: 'Ana',
  lastName: 'Pérez',
  email: 'ana@example.com',
  phone: '223 555-1234',
  provinceCode: 'AR-B',
  city: 'Mar del Plata',
  postalCode: '7600',
  street: 'Av. Colón',
  number: '1234',
  unit: '',
  notes: '',
};
const KEY = 'a'.repeat(43);
const validRequest = () => ({
  idempotencyKey: KEY,
  form: { ...FORM },
  items: [{ productId: P1, quantity: 2 }],
  expectedTotalCentavos: 2_510_000,
  acceptTerms: true,
});

// --- formulario -------------------------------------------------------------------------------

test('nombre completo: nombre y apellido limpios, como lo guarda la base', () => {
  assert.equal(fullName({ firstName: '  Ana  María ', lastName: ' Pérez ' }), 'Ana María Pérez');
  assert.equal(toCheckoutInput(FORM, [{ productId: P1, quantity: 1 }]).buyer.name, 'Ana Pérez');
});

test('toCheckoutInput: sin documento (facturación oculta) y artículos con la forma de la base', () => {
  const input = toCheckoutInput(FORM, [{ productId: P1, quantity: 3 }]);
  assert.equal(input.buyer.document, null);
  assert.deepEqual(input.items, [{ product_id: P1, quantity: 3 }]);
  assert.equal(input.shipping.province_code, 'AR-B');
  assert.equal(input.shipping.postal_code, '7600');
});

test('validateForm: un formulario completo y con términos aceptados no tiene errores', () => {
  assert.deepEqual(validateForm(FORM, PROVINCES, true), []);
  // opcionales con contenido válido
  assert.deepEqual(validateForm({ ...FORM, unit: '3° B', notes: 'Tocar timbre' }, PROVINCES, true), []);
});

test('validateForm: formulario vacío → todos los obligatorios, en el orden del formulario', () => {
  assert.deepEqual(validateForm(EMPTY_FORM, PROVINCES, false), [
    'firstName',
    'lastName',
    'email',
    'phone',
    'provinceCode',
    'city',
    'postalCode',
    'street',
    'number',
    'terms',
  ]);
});

test('validateForm: reglas de cada campo (las mismas que la base)', () => {
  const errs = (patch: Partial<CheckoutFormData>) => validateForm({ ...FORM, ...patch }, PROVINCES, true);
  assert.deepEqual(errs({ email: 'ana@' }), ['email']);
  assert.deepEqual(errs({ phone: '12' }), ['phone']);
  assert.deepEqual(errs({ phone: 'llamame' }), ['phone']);
  assert.deepEqual(errs({ postalCode: '760' }), ['postalCode']);
  assert.deepEqual(errs({ postalCode: 'b7600abc' }), [], 'CPA en minúsculas se normaliza');
  assert.deepEqual(errs({ number: 's/n' }), [], 'S/N se acepta');
  assert.deepEqual(errs({ provinceCode: 'AR-Z' }), ['provinceCode'], 'provincia fuera de la lista');
  assert.deepEqual(errs({ firstName: 'x'.repeat(61) }), ['firstName']);
  assert.deepEqual(errs({ lastName: 'Pérez\u0007' }), ['lastName'], 'caracteres de control');
  assert.deepEqual(errs({ notes: 'x'.repeat(501) }), ['notes']);
  assert.deepEqual(validateForm(FORM, PROVINCES, false), ['terms']);
});

test('formFieldsFromDb: los campos que rechaza la base se marcan en el formulario', () => {
  assert.deepEqual(formFieldsFromDb(['shipping.postal_code', 'buyer.name', 'items']), ['firstName', 'lastName', 'postalCode']);
  assert.deepEqual(formFieldsFromDb([]), []);
  assert.ok(FORM_FIELDS.includes('terms'));
});

// --- solicitudes --------------------------------------------------------------------------------

test('parseCreateOrderRequest: acepta la forma exacta', () => {
  assert.deepEqual(parseCreateOrderRequest(validRequest()), validRequest());
});

test('parseCreateOrderRequest: rechaza claves extra, tipos incorrectos y valores fuera de rango', () => {
  const bad = (patch: Record<string, unknown>) => parseCreateOrderRequest({ ...validRequest(), ...patch });
  assert.equal(parseCreateOrderRequest({ ...validRequest(), price: 1 }), null, 'clave extra (un precio del navegador)');
  assert.equal(bad({ idempotencyKey: 'corta' }), null);
  assert.equal(bad({ idempotencyKey: 'a'.repeat(42) + '!' }), null);
  assert.equal(bad({ acceptTerms: false }), null);
  assert.equal(bad({ acceptTerms: 'true' }), null);
  assert.equal(bad({ expectedTotalCentavos: 0 }), null);
  assert.equal(bad({ expectedTotalCentavos: 10.5 }), null, 'centavos enteros');
  assert.equal(bad({ expectedTotalCentavos: 1e15 }), null);
  assert.equal(bad({ items: [] }), null);
  assert.equal(bad({ items: [{ productId: P1, quantity: 1 }, { productId: P1, quantity: 2 }] }), null, 'producto repetido');
  assert.equal(bad({ items: [{ productId: P1, quantity: 1.5 }] }), null);
  assert.equal(bad({ items: [{ productId: P1, quantity: 1, price: 1 }] }), null);
  assert.equal(bad({ form: { ...FORM, document: '30111222' } }), null, 'sin campos fiscales todavía');
  assert.equal(bad({ form: { ...FORM, notes: 'x'.repeat(601) } }), null);
  const { street: _s, ...withoutStreet } = FORM;
  assert.equal(bad({ form: withoutStreet }), null);
  assert.equal(parseCreateOrderRequest(null), null);
  assert.equal(parseCreateOrderRequest([]), null);
});

test('parseSummaryRequest: provincia opcional y con formato ISO', () => {
  const items = [{ productId: P1, quantity: 1 }];
  assert.deepEqual(parseSummaryRequest({ items, provinceCode: null }), { items, provinceCode: null });
  assert.deepEqual(parseSummaryRequest({ items, provinceCode: 'AR-C' }), { items, provinceCode: 'AR-C' });
  assert.equal(parseSummaryRequest({ items, provinceCode: 'Buenos Aires' }), null);
  assert.equal(parseSummaryRequest({ items }), null);
  assert.equal(parseSummaryRequest({ items: [], provinceCode: null }), null);
});

// --- idempotencia -------------------------------------------------------------------------------

test('huella: misma compra ⇒ misma huella (orden de artículos y espacios no importan)', () => {
  const a = checkoutFingerprint(FORM, [{ productId: P1, quantity: 1 }, { productId: P2, quantity: 2 }], 100);
  const b = checkoutFingerprint({ ...FORM, city: '  Mar  del Plata ' }, [{ productId: P2, quantity: 2 }, { productId: P1, quantity: 1 }], 100);
  assert.equal(a, b);
});

test('huella: cualquier cambio de contenido ⇒ huella distinta (clave nueva)', () => {
  const base = checkoutFingerprint(FORM, [{ productId: P1, quantity: 1 }], 100);
  assert.notEqual(checkoutFingerprint(FORM, [{ productId: P1, quantity: 2 }], 100), base, 'cantidad');
  assert.notEqual(checkoutFingerprint(FORM, [{ productId: P1, quantity: 1 }], 101), base, 'total aceptado');
  assert.notEqual(checkoutFingerprint({ ...FORM, number: '1235' }, [{ productId: P1, quantity: 1 }], 100), base, 'dirección');
  assert.notEqual(checkoutFingerprint({ ...FORM, email: 'otra@example.com' }, [{ productId: P1, quantity: 1 }], 100), base, 'email');
});

test('clave de idempotencia: 32 bytes de CSPRNG en base64url, válida para la base', () => {
  const key = newCheckoutKey();
  assert.match(key, /^[A-Za-z0-9_-]{43}$/);
  assert.notEqual(newCheckoutKey(), key);
  // usa los bytes del generador recibido, sin modificarlos
  assert.equal(newCheckoutKey((b) => b.fill(0xff)), '_'.repeat(42) + '8');
});

// --- seguimiento ----------------------------------------------------------------------------------

const LOOKUP = {
  code: 'STF-2611-AB2C',
  created_at: '2026-11-03T15:00:00+00:00',
  payment_status: 'pending',
  fulfillment_status: 'pending',
  needs_attention: false,
  reservation_expires_at: '2026-11-03T15:30:00+00:00',
  subtotal_ars: 25100,
  shipping_ars: 3500.5,
  total_ars: 28600.5,
  destination: { city: 'Mar del Plata', province: 'Buenos Aires' },
  dispatch: null,
  items: [{ sku: 'TND-NEUTRO', name: 'Shampoo Neutro 1000cc', unit_price_ars: 12550, quantity: 2, line_total_ars: 25100 }],
  // si la base agregara datos personales, no deben pasar a la vista
  buyer_email: 'ana@example.com',
};

test('consulta: vista con importes exactos y sin datos personales', () => {
  const view = parseOrderLookup(LOOKUP);
  assert.ok(view);
  assert.equal(view.totalCentavos, 2_860_050);
  assert.equal(view.shippingCentavos, 350_050);
  assert.equal(view.items[0].lineTotalCentavos, 2_510_000);
  assert.equal(view.province, 'Buenos Aires');
  const text = JSON.stringify(view);
  for (const leak of ['ana@example.com', 'Mar del Plata', 'buyer', 'email', 'city']) assert.ok(!text.includes(leak), leak);
});

test('consulta: null (código o token incorrectos) → null; forma inesperada → error', () => {
  assert.equal(parseOrderLookup(null), null);
  assert.throws(() => parseOrderLookup({ ...LOOKUP, payment_status: 'paid' }));
  assert.throws(() => parseOrderLookup({ ...LOOKUP, total_ars: null }));
  assert.throws(() => parseOrderLookup([]));
});

test('código y token: formatos de la base; el token sale del fragmento', () => {
  assert.ok(isOrderCode('STF-2611-AB2C'));
  assert.ok(!isOrderCode('STF-2611-AB1C'), 'sin 1 (ambiguo)');
  assert.ok(!isOrderCode('stf-2611-ab2c'));
  const token = 'A'.repeat(42) + '_';
  assert.ok(isOrderToken(token));
  assert.equal(tokenFromHash(`#t=${token}`), token);
  assert.equal(tokenFromHash('#t=corto'), null);
  assert.equal(tokenFromHash(''), null);
});

// --- resumen ----------------------------------------------------------------------------------------

const summary = (patch: Partial<CheckoutSummary> = {}, quote: Partial<CheckoutSummary['quote']> = {}): CheckoutSummary => ({
  quote: {
    checkoutEnabled: true,
    limits: { maxUnitsPerProduct: 5, maxUnitsPerOrder: 20 },
    lines: [],
    units: 1,
    subtotalCentavos: 1000,
    exceedsOrderLimit: false,
    canCheckout: true,
    ...quote,
  },
  shipping: { status: 'ok', zoneName: 'AMBA', costCentavos: 500, isFree: false, freeFromCentavos: null },
  totalCentavos: 1500,
  ...patch,
});

test('se puede confirmar solo con checkout habilitado, carrito comprable y envío con cobertura', () => {
  assert.ok(canConfirm(summary()));
  assert.equal(blockedReason(summary()), null);
  assert.ok(!canConfirm(null));
  assert.match(blockedReason(summary({}, { checkoutEnabled: false }))!, /no están habilitadas/);
  assert.match(blockedReason(summary({}, { canCheckout: false }))!, /no se pueden comprar/);
  assert.match(blockedReason(summary({}, { canCheckout: false, exceedsOrderLimit: true }))!, /máximo de 20/);
  assert.match(blockedReason(summary({ shipping: { status: 'pending' }, totalCentavos: null }))!, /Elegí la provincia/);
  assert.match(blockedReason(summary({ shipping: { status: 'no_coverage' }, totalCentavos: null }))!, /no hacemos envíos/);
  assert.ok(!canConfirm(summary({ shipping: { status: 'no_coverage' }, totalCentavos: null })));
});
