import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cartEnabledFor } from './flag.ts';
import { addToCart, limitMessage, removeFromCart, setLineQuantity, totalUnits } from './model.ts';
import { parseQuoteRequest, parseQuoteResponse } from './quote.ts';
import { reconcile, type Snapshot } from './reconcile.ts';
import { CART_STORAGE_KEY, parseStoredCart, serializeCart } from './storage.ts';
import type { CartQuote, QuoteLine } from './types.ts';

const A = '20000000-0000-0000-0000-00000000000a';
const B = '20000000-0000-0000-0000-00000000000b';
const C = '20000000-0000-0000-0000-00000000000c';
const LIMITS = { maxUnitsPerProduct: 5, maxUnitsPerOrder: 20 };

// ---------------------------------------------------------------------------
// localStorage
// ---------------------------------------------------------------------------

test('la clave de almacenamiento está versionada', () => {
  assert.equal(CART_STORAGE_KEY, 'steffen-carrito-v1');
});

test('guarda solo producto y cantidad, y lo recupera igual', () => {
  const raw = serializeCart([{ productId: A, quantity: 2 }, { productId: B, quantity: 1 }]);
  assert.deepEqual(JSON.parse(raw), { version: 1, items: [{ productId: A, quantity: 2 }, { productId: B, quantity: 1 }] });
  assert.deepEqual(parseStoredCart(raw), [{ productId: A, quantity: 2 }, { productId: B, quantity: 1 }]);
});

test('localStorage corrupto o manipulado: nunca rompe, solo quedan líneas válidas', () => {
  assert.deepEqual(parseStoredCart(null), []);
  assert.deepEqual(parseStoredCart('{no es json'), []);
  assert.deepEqual(parseStoredCart('[]'), []);
  assert.deepEqual(parseStoredCart('"texto"'), []);
  assert.deepEqual(parseStoredCart(JSON.stringify({ version: 2, items: [{ productId: A, quantity: 1 }] })), [], 'otra versión del esquema');
  assert.deepEqual(parseStoredCart(JSON.stringify({ items: [{ productId: A, quantity: 1 }] })), [], 'sin versión');
  assert.deepEqual(
    parseStoredCart(
      JSON.stringify({
        version: 1,
        items: [
          { productId: A, quantity: 2, price: 1 }, // campos extra se ignoran (nunca se usan precios guardados)
          { productId: 'no-uuid', quantity: 1 },
          { productId: B, quantity: -3 },
          { productId: B, quantity: 1.5 },
          { productId: B, quantity: '2' },
          null,
          'x',
          { productId: C.toUpperCase(), quantity: 1 },
        ],
      }),
    ),
    [{ productId: A, quantity: 2 }, { productId: C, quantity: 1 }],
  );
  assert.deepEqual(parseStoredCart('x'.repeat(20_001)), [], 'demasiado grande');
});

test('productos duplicados en lo guardado se unen en una línea', () => {
  const raw = JSON.stringify({ version: 1, items: [{ productId: A, quantity: 2 }, { productId: A, quantity: 3 }] });
  assert.deepEqual(parseStoredCart(raw), [{ productId: A, quantity: 5 }]);
});

test('lo guardado se acota a 50 líneas y a la validación técnica de cantidades', () => {
  const items = Array.from({ length: 60 }, (_, i) => ({ productId: `20000000-0000-0000-0000-${String(i).padStart(12, '0')}`, quantity: 1 }));
  assert.equal(parseStoredCart(JSON.stringify({ version: 1, items })).length, 50);
  assert.deepEqual(parseStoredCart(JSON.stringify({ version: 1, items: [{ productId: A, quantity: 1e9 }] })), [{ productId: A, quantity: 9999 }]);
});

// ---------------------------------------------------------------------------
// Cantidades y límites (vienen del servidor)
// ---------------------------------------------------------------------------

test('agregar suma a la línea existente sin duplicar productos', () => {
  let r = addToCart([], A, 1, LIMITS);
  r = addToCart(r.items, A, 1, LIMITS);
  assert.deepEqual(r.items, [{ productId: A, quantity: 2 }]);
  assert.equal(r.added, 1);
  assert.equal(r.limitedBy, undefined);
});

test('máximo por producto', () => {
  const r = addToCart([{ productId: A, quantity: 5 }], A, 1, LIMITS);
  assert.equal(r.added, 0);
  assert.equal(r.limitedBy, 'product_limit');
  assert.deepEqual(r.items, [{ productId: A, quantity: 5 }]);
  assert.equal(limitMessage('product_limit', LIMITS), 'Podés agregar hasta 5 unidades de este producto.');
  const partial = addToCart([{ productId: A, quantity: 4 }], A, 3, LIMITS);
  assert.equal(partial.quantity, 5);
  assert.equal(partial.limitedBy, 'product_limit');
});

test('máximo por carrito', () => {
  const full = [
    { productId: A, quantity: 5 },
    { productId: B, quantity: 5 },
    { productId: C, quantity: 5 },
    { productId: '20000000-0000-0000-0000-00000000000d', quantity: 5 },
  ];
  assert.equal(totalUnits(full), 20);
  const r = addToCart(full, '20000000-0000-0000-0000-00000000000e', 1, LIMITS);
  assert.equal(r.added, 0);
  assert.equal(r.limitedBy, 'order_limit');
  assert.equal(r.items.length, 4, 'no se agrega una línea en 0');
  assert.equal(limitMessage('order_limit', LIMITS), 'Tu carrito puede tener hasta 20 unidades en total.');
});

test('los límites son los que manda el servidor (no constantes)', () => {
  const r = addToCart([], A, 4, { maxUnitsPerProduct: 3, maxUnitsPerOrder: 10 });
  assert.equal(r.quantity, 3);
  assert.equal(limitMessage('product_limit', { maxUnitsPerProduct: 1, maxUnitsPerOrder: 10 }), 'Podés agregar hasta 1 unidad de este producto.');
});

test('el máximo comprable de la cotización también limita (sin conocer el stock exacto)', () => {
  const r = addToCart([{ productId: A, quantity: 2 }], A, 1, LIMITS, 2);
  assert.equal(r.added, 0);
  assert.equal(r.limitedBy, 'stock_limit');
  assert.equal(addToCart([], A, 1, LIMITS, 0).limitedBy, 'stock_limit');
});

test('restar y quitar', () => {
  const items = [{ productId: A, quantity: 3 }, { productId: B, quantity: 1 }];
  assert.deepEqual(setLineQuantity(items, A, 2, LIMITS).items, [{ productId: A, quantity: 2 }, { productId: B, quantity: 1 }]);
  assert.deepEqual(removeFromCart(items, A), [{ productId: B, quantity: 1 }]);
  // bajar siempre se puede, aunque el carrito supere un límite que se redujo
  const over = setLineQuantity([{ productId: A, quantity: 8 }], A, 7, LIMITS);
  assert.equal(over.quantity, 7);
  assert.equal(over.limitedBy, undefined);
});

// ---------------------------------------------------------------------------
// Solicitud de cotización (validación estricta en el servidor)
// ---------------------------------------------------------------------------

test('cotización: solicitud válida', () => {
  assert.deepEqual(parseQuoteRequest({ items: [{ productId: A.toUpperCase(), quantity: 2 }] }), [{ productId: A, quantity: 2 }]);
  assert.deepEqual(parseQuoteRequest({ items: [] }), []);
});

test('cotización: solicitudes inválidas se rechazan', () => {
  for (const body of [
    null,
    [],
    { items: 'x' },
    { items: [], extra: 1 },
    { items: [{ productId: A, quantity: 1, price: 1 }] },
    { items: [{ productId: 'x', quantity: 1 }] },
    { items: [{ productId: A, quantity: 0 }] },
    { items: [{ productId: A, quantity: 1.5 }] },
    { items: [{ productId: A, quantity: 10_000 }] },
    { items: [{ productId: A, quantity: '1' }] },
    { items: [{ productId: A, quantity: 1 }, { productId: A, quantity: 1 }] },
    { items: Array.from({ length: 51 }, (_, i) => ({ productId: `20000000-0000-0000-0000-${String(i).padStart(12, '0')}`, quantity: 1 })) },
  ]) {
    assert.equal(parseQuoteRequest(body), null, JSON.stringify(body)?.slice(0, 80));
  }
});

// ---------------------------------------------------------------------------
// Respuesta de cotizar_carrito
// ---------------------------------------------------------------------------

const RAW = {
  checkout_enabled: false,
  limits: { max_units_per_product: 5, max_units_per_order: 20 },
  items: [
    { product_id: A, status: 'ok', quantity: 2, name: 'Shampoo', slug: 'shampoo', sku: 'S', price_ars: '12550.00', image_path: 'productos/a.webp', availability: 'disponible', max_quantity: 5, line_total_ars: '25100.00' },
    { product_id: B, status: 'out_of_stock', quantity: 1, name: 'Ácido', slug: 'acido', sku: 'X', price_ars: '9000.50', image_path: null, availability: 'sin-stock', max_quantity: 0, line_total_ars: null },
  ],
  units: 2,
  subtotal_ars: '25100.00',
  exceeds_order_limit: false,
  can_checkout: false,
};

test('la cotización se lee con importes exactos en centavos', () => {
  const q = parseQuoteResponse(RAW, (p) => `https://cdn.test/${p}`);
  assert.equal(q.subtotalCentavos, 2_510_000);
  assert.equal(q.lines[0].priceCentavos, 1_255_000);
  assert.equal(q.lines[0].imageUrl, 'https://cdn.test/productos/a.webp');
  assert.equal(q.lines[1].priceCentavos, 900_050);
  assert.equal(q.lines[1].status, 'out_of_stock');
  assert.deepEqual(q.limits, LIMITS);
  assert.equal(q.checkoutEnabled, false);
});

test('una cotización con forma inesperada se rechaza entera', () => {
  assert.throws(() => parseQuoteResponse(null, String));
  assert.throws(() => parseQuoteResponse({ ...RAW, limits: null }, String));
  assert.throws(() => parseQuoteResponse({ ...RAW, items: [{ ...RAW.items[0], status: 'otro' }] }, String));
  assert.throws(() => parseQuoteResponse({ ...RAW, subtotal_ars: 25100 }, String), 'importes como número (float) no se aceptan');
});

test('la respuesta no trae el stock exacto', () => {
  const keys = new Set(RAW.items.flatMap((i) => Object.keys(i)));
  assert.equal(keys.has('stock'), false);
});

// ---------------------------------------------------------------------------
// Reconciliación: precios y disponibilidad
// ---------------------------------------------------------------------------

function line(over: Partial<QuoteLine>): QuoteLine {
  return { productId: A, status: 'ok', quantity: 1, name: 'Shampoo Neutro 1000cc', slug: 's', priceCentavos: 1_255_000, imageUrl: null, maxQuantity: 5, lineTotalCentavos: 1_255_000, ...over };
}
function quote(lines: QuoteLine[], extra: Partial<CartQuote> = {}): CartQuote {
  return { checkoutEnabled: false, limits: LIMITS, lines, units: 1, subtotalCentavos: 0, exceedsOrderLimit: false, canCheckout: true, ...extra };
}

test('cambio de precio: aviso con el precio anterior y el nuevo', () => {
  const first = reconcile([{ productId: A, quantity: 1 }], quote([line({})]), new Map());
  assert.deepEqual(first.notices, [], 'la primera cotización solo registra el precio');
  const second = reconcile([{ productId: A, quantity: 1 }], quote([line({ priceCentavos: 1_300_000 })]), first.snapshot);
  assert.deepEqual(second.notices, ['El precio de Shampoo Neutro 1000cc cambió de $ 12.550 a $ 13.000.']);
});

test('producto desactivado o sin stock: aviso una sola vez, la línea queda para quitarla', () => {
  const prev: Snapshot = new Map([[A, { price: 1_255_000, status: 'ok' }]]);
  const r = reconcile([{ productId: A, quantity: 2 }], quote([line({ status: 'unavailable', quantity: 2, priceCentavos: null })]), prev);
  assert.deepEqual(r.items, [{ productId: A, quantity: 2 }]);
  assert.match(r.notices[0], /ya no está disponible/);
  const again = reconcile(r.items, quote([line({ status: 'unavailable', quantity: 2, priceCentavos: null })]), r.snapshot);
  assert.deepEqual(again.notices, []);
  const out = reconcile([{ productId: A, quantity: 1 }], quote([line({ status: 'out_of_stock', maxQuantity: 0 })]), prev);
  assert.match(out.notices[0], /se quedó sin stock/);
});

test('cantidad mayor a lo disponible o al límite: se ajusta y se explica', () => {
  const r = reconcile([{ productId: A, quantity: 4 }], quote([line({ status: 'exceeds_stock', quantity: 4, maxQuantity: 2 })]), new Map());
  assert.deepEqual(r.items, [{ productId: A, quantity: 2 }]);
  assert.equal(r.adjusted, true);
  assert.match(r.notices[0], /Ajustamos Shampoo Neutro 1000cc a 2 unidades: no hay más disponibles/);
  const lim = reconcile([{ productId: A, quantity: 7 }], quote([line({ status: 'exceeds_limit', quantity: 7, maxQuantity: 5 })]), new Map());
  assert.match(lim.notices[0], /máximo por producto/);
});

test('una cotización de otra versión del carrito no modifica nada', () => {
  const r = reconcile([{ productId: A, quantity: 3 }], quote([line({ status: 'exceeds_stock', quantity: 4, maxQuantity: 2 })]), new Map());
  assert.deepEqual(r.items, [{ productId: A, quantity: 3 }]);
  assert.equal(r.adjusted, false);
});

// ---------------------------------------------------------------------------
// Interruptor del carrito
// ---------------------------------------------------------------------------

test('el carrito solo se habilita con la variable del servidor, Supabase local y fuera de Vercel', () => {
  const local = { NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321' };
  assert.equal(cartEnabledFor({ ...local, STEFFEN_CART_ENABLED: '1' }), true);
  assert.equal(cartEnabledFor({ NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:55321', STEFFEN_CART_ENABLED: '1' }), true);
  assert.equal(cartEnabledFor(local), false, 'sin la variable');
  assert.equal(cartEnabledFor({ ...local, STEFFEN_CART_ENABLED: 'true' }), false, 'solo "1"');
  assert.equal(cartEnabledFor({ NEXT_PUBLIC_SUPABASE_URL: 'https://zzxlghpopmccwsaqbsko.supabase.co', STEFFEN_CART_ENABLED: '1' }), false, 'Cloud');
  assert.equal(cartEnabledFor({ ...local, STEFFEN_CART_ENABLED: '1', VERCEL: '1' }), false, 'Vercel');
  assert.equal(cartEnabledFor({ ...local, STEFFEN_CART_ENABLED: '1', VERCEL_ENV: 'preview' }), false, 'Preview');
  assert.equal(cartEnabledFor({ NEXT_PUBLIC_SUPABASE_URL: 'no es url', STEFFEN_CART_ENABLED: '1' }), false);
  assert.equal(cartEnabledFor({ NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1.evil.com', STEFFEN_CART_ENABLED: '1' }), false);
});
