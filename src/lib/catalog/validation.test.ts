import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isValidStoragePath, slugify, validateCategoryInput, validateProductInput } from './validation.ts';
import type { ProductInput } from './types.ts';

const base: ProductInput = {
  sku: 'STF-SH-500',
  name: 'Shampoo Extra Ácido 500 ml',
  slug: 'shampoo-extra-acido-500-ml',
  categoryId: '6f1c1f0e-8b7a-4c2e-9a51-2f3d4e5a6b7c',
  priceCentavos: 1_250_050,
  stock: 10,
};

test('slugify quita tildes y espacios', () => {
  assert.equal(slugify('Shampoo Extra Ácido 500 ml'), 'shampoo-extra-acido-500-ml');
  assert.equal(slugify('  Máscaras / Tratamientos  '), 'mascaras-tratamientos');
});

test('producto válido no tiene errores', () => {
  assert.deepEqual(validateProductInput(base), {});
  assert.deepEqual(validateProductInput({ ...base, stock: 0, priceCentavos: 0, weightGrams: 500 }), {});
});

test('precio y stock negativos o no enteros se rechazan', () => {
  assert.ok(validateProductInput({ ...base, priceCentavos: -1 }).priceCentavos);
  assert.ok(validateProductInput({ ...base, priceCentavos: 12.5 }).priceCentavos);
  assert.ok(validateProductInput({ ...base, priceCentavos: 1e15 }).priceCentavos);
  assert.ok(validateProductInput({ ...base, stock: -1 }).stock);
  assert.ok(validateProductInput({ ...base, stock: 1.5 }).stock);
  assert.ok(validateProductInput({ ...base, weightGrams: 0 }).weightGrams);
  assert.ok(validateProductInput({ ...base, packageWidthMm: -3 }).packageWidthMm);
});

test('SKU, slug y categoría obligatorios y con formato', () => {
  assert.ok(validateProductInput({ ...base, sku: '' }).sku);
  assert.ok(validateProductInput({ ...base, sku: ' STF ' }).sku);
  assert.ok(validateProductInput({ ...base, slug: 'Con Mayúsculas' }).slug);
  assert.ok(validateProductInput({ ...base, slug: 'doble--guion' }).slug);
  assert.ok(validateProductInput({ ...base, categoryId: 'x' }).categoryId);
});

test('categorías y rutas de imágenes', () => {
  assert.deepEqual(validateCategoryInput({ name: 'Shampoos', slug: 'shampoos' }), {});
  assert.ok(validateCategoryInput({ name: ' ', slug: 'shampoos' }).name);
  assert.ok(validateCategoryInput({ name: 'X', slug: 'x', imagePath: '../secreto.png' }).imagePath);
  assert.equal(isValidStoragePath('productos/abc/frente.webp'), true);
  assert.equal(isValidStoragePath('/productos/a.webp'), false);
  assert.equal(isValidStoragePath('productos/../../a.webp'), false);
});
