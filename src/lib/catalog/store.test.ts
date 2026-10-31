import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  PAGE_SIZE,
  filterProducts,
  isAvailability,
  normalizeText,
  parseStoreQuery,
  relatedProducts,
  sortProducts,
  storeHref,
  whatsappConsultUrl,
} from './store.ts';
import type { Product } from './types.ts';

function product(p: Partial<Product> & { id: string; name: string }): Product {
  return {
    sku: p.id.toUpperCase(),
    slug: p.id,
    shortDescription: null,
    description: null,
    usageInstructions: null,
    benefits: null,
    presentation: null,
    category: { id: 'c1', name: 'Shampoos', slug: 'shampoos' },
    priceCentavos: 100_00,
    availability: 'disponible',
    weightGrams: null,
    packageMm: { length: null, width: null, height: null },
    isFeatured: false,
    sortOrder: 0,
    updatedAt: '2026-10-31T00:00:00Z',
    images: [],
    ...p,
  };
}

const mascaras = { id: 'c2', name: 'Máscaras', slug: 'mascaras' };
const catalogo: Product[] = [
  product({ id: 'a', name: 'Shampoo Neutro 1000cc', sku: 'SHNEU1000', priceCentavos: 12_550_00, availability: 'disponible' }),
  product({ id: 'b', name: 'Acondicionador Ácido', priceCentavos: 9_000_00, availability: 'sin-stock', isFeatured: true }),
  product({ id: 'c', name: 'Máscara Argán', priceCentavos: 15_000_00, availability: 'ultimas', category: mascaras, isFeatured: true }),
  product({ id: 'd', name: 'Bálsamo Lino', priceCentavos: 5_000_00, availability: 'disponible', sortOrder: -1 }),
  product({ id: 'e', name: 'Máscara Coco', priceCentavos: 1_000_00, availability: 'sin-stock', category: mascaras }),
];
const names = (list: Product[]) => list.map((p) => p.name);

test('solo se aceptan los tres niveles de disponibilidad que calcula la base', () => {
  for (const v of ['disponible', 'ultimas', 'sin-stock']) assert.ok(isAvailability(v), v);
  for (const v of ['', 'DISPONIBLE', 3, null, undefined, 'agotado']) assert.equal(isAvailability(v), false, String(v));
});

test('los productos sin stock quedan al final con cualquier orden', () => {
  for (const orden of ['destacados', 'nombre', 'precio-asc', 'precio-desc'] as const) {
    const sorted = sortProducts(catalogo, orden);
    const firstOut = sorted.findIndex((p) => p.availability === 'sin-stock');
    assert.ok(sorted.slice(firstOut).every((p) => p.availability === 'sin-stock'), `orden ${orden}`);
    assert.equal(firstOut, 3, `orden ${orden}`);
  }
});

test('cada orden dentro de los que tienen stock', () => {
  assert.deepEqual(names(sortProducts(catalogo, 'destacados')).slice(0, 3), ['Máscara Argán', 'Bálsamo Lino', 'Shampoo Neutro 1000cc']);
  assert.deepEqual(names(sortProducts(catalogo, 'nombre')), ['Bálsamo Lino', 'Máscara Argán', 'Shampoo Neutro 1000cc', 'Acondicionador Ácido', 'Máscara Coco']);
  assert.deepEqual(names(sortProducts(catalogo, 'precio-asc')).slice(0, 3), ['Bálsamo Lino', 'Shampoo Neutro 1000cc', 'Máscara Argán']);
  assert.deepEqual(names(sortProducts(catalogo, 'precio-desc')).slice(0, 3), ['Máscara Argán', 'Shampoo Neutro 1000cc', 'Bálsamo Lino']);
  // no modifica el arreglo original
  assert.equal(catalogo[0].name, 'Shampoo Neutro 1000cc');
});

test('buscador por nombre y SKU sin tildes ni mayúsculas', () => {
  const base = { categoria: '', orden: 'nombre' as const };
  assert.deepEqual(names(filterProducts(catalogo, { ...base, q: 'mascara' })), ['Máscara Argán', 'Máscara Coco']);
  assert.deepEqual(names(filterProducts(catalogo, { ...base, q: 'ÁRGAN máscara' })), ['Máscara Argán']);
  assert.deepEqual(names(filterProducts(catalogo, { ...base, q: 'shneu' })), ['Shampoo Neutro 1000cc']);
  assert.deepEqual(filterProducts(catalogo, { ...base, q: 'inexistente' }), []);
  assert.equal(normalizeText('  Máscara   ÁRGAN '), 'mascara argan');
});

test('filtro por categoría combinado con búsqueda', () => {
  assert.deepEqual(names(filterProducts(catalogo, { q: '', categoria: 'mascaras', orden: 'precio-asc' })), ['Máscara Argán', 'Máscara Coco']);
  assert.deepEqual(names(filterProducts(catalogo, { q: 'coco', categoria: 'shampoos', orden: 'nombre' })), []);
});

test('parseStoreQuery sanea la URL', () => {
  assert.deepEqual(parseStoreQuery({}), { q: '', categoria: '', orden: 'destacados', mostrar: PAGE_SIZE });
  assert.deepEqual(parseStoreQuery({ q: '  shampoo   neutro ', categoria: 'shampoos', orden: 'precio-desc', mostrar: '48' }), {
    q: 'shampoo neutro',
    categoria: 'shampoos',
    orden: 'precio-desc',
    mostrar: 48,
  });
  assert.deepEqual(parseStoreQuery({ categoria: '../admin', orden: 'drop table', mostrar: '-5' }), {
    q: '',
    categoria: '',
    orden: 'destacados',
    mostrar: PAGE_SIZE,
  });
  assert.equal(parseStoreQuery({ mostrar: '30' }).mostrar, 48);
  assert.equal(parseStoreQuery({ mostrar: '999999' }).mostrar, 1000);
  assert.equal(parseStoreQuery({ q: 'x'.repeat(200) }).q.length, 80);
  assert.equal(parseStoreQuery({ q: ['a', 'b'] }).q, 'a');
});

test('storeHref arma URLs compartibles y limpias', () => {
  assert.equal(storeHref({}), '/tienda');
  assert.equal(storeHref({ q: '', categoria: '', orden: 'destacados', mostrar: PAGE_SIZE }), '/tienda');
  assert.equal(storeHref({ q: 'máscara argán', categoria: 'mascaras', orden: 'precio-asc', mostrar: 48 }), '/tienda?q=m%C3%A1scara+arg%C3%A1n&categoria=mascaras&orden=precio-asc&mostrar=48');
});

test('relacionados: misma categoría, sin el actual, hasta cuatro', () => {
  const actual = catalogo[0];
  assert.deepEqual(names(relatedProducts(catalogo, actual)), ['Bálsamo Lino', 'Acondicionador Ácido']);
  assert.deepEqual(names(relatedProducts(catalogo, catalogo[2])), ['Máscara Coco']);
  const muchos = Array.from({ length: 8 }, (_, i) => product({ id: `x${i}`, name: `Producto ${i}` }));
  assert.equal(relatedProducts([actual, ...muchos], actual).length, 4);
});

test('consulta por WhatsApp con el número configurado y el producto', () => {
  const url = new URL(whatsappConsultUrl('Shampoo Neutro 1000cc'));
  assert.equal(url.origin, 'https://wa.me');
  assert.equal(url.pathname, '/5492235590428');
  assert.equal(url.searchParams.get('text'), 'Hola, quisiera consultar por el producto Shampoo Neutro 1000cc de Steffen.');
});
