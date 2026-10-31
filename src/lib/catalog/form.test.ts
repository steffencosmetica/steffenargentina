import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoryFromForm, productFromForm, quickPriceFromForm, quickStockFromForm } from './form.ts';
import { describeDbError } from './errors.ts';
import { validateProductInput } from './validation.ts';

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.set(k, v);
  return data;
}

const valido = {
  sku: 'STF-SH-500',
  name: 'Shampoo 500 ml',
  slug: 'shampoo-500-ml',
  categoryId: '6f1c1f0e-8b7a-4c2e-9a51-2f3d4e5a6b7c',
  price: '12.500,50',
  stock: '1.500',
  weightGrams: '520',
  isActive: 'on',
};

test('productFromForm convierte precio, enteros y casillas', () => {
  const { input, errors } = productFromForm(form(valido));
  assert.deepEqual(errors, {});
  assert.equal(input.priceCentavos, 1_250_050);
  assert.equal(input.stock, 1500);
  assert.equal(input.weightGrams, 520);
  assert.equal(input.packageLengthMm, null);
  assert.equal(input.isActive, true);
  assert.equal(input.isFeatured, false);
  assert.equal(input.shortDescription, null);
  assert.deepEqual(validateProductInput(input), {});
});

test('productFromForm marca precio y stock inválidos', () => {
  const r1 = productFromForm(form({ ...valido, price: '12,500.50' }));
  assert.ok(r1.errors.priceCentavos);
  const r2 = productFromForm(form({ ...valido, price: '' }));
  assert.ok(r2.errors.priceCentavos);
  const r3 = productFromForm(form({ ...valido, stock: '' }));
  assert.ok(r3.errors.stock);
  const r4 = productFromForm(form({ ...valido, stock: '2,5' }));
  assert.ok(validateProductInput(r4.input).stock);
  const r5 = productFromForm(form({ ...valido, weightGrams: 'abc' }));
  assert.ok(validateProductInput(r5.input).weightGrams);
});

test('categoryFromForm no toca el orden ni la imagen', () => {
  const { input } = categoryFromForm(form({ name: 'Shampoos', slug: 'shampoos' }));
  assert.equal(input.isActive, false);
  assert.equal('sortOrder' in input, false);
  assert.equal('imagePath' in input, false);
});

test('edición rápida de precio y stock', () => {
  assert.deepEqual(quickPriceFromForm(form({ price: '9.999,99' })), { centavos: 999_999 });
  assert.ok('error' in quickPriceFromForm(form({ price: '-1' })));
  assert.deepEqual(quickStockFromForm(form({ stock: '0' })), { stock: 0 });
  assert.ok('error' in quickStockFromForm(form({ stock: '-3' })));
  assert.ok('error' in quickStockFromForm(form({ stock: '1.5' })));
});

test('describeDbError traduce restricciones conocidas', () => {
  assert.deepEqual(
    describeDbError({ code: '23505', message: 'duplicate key value violates unique constraint "products_sku_key"' }),
    { field: 'sku', message: 'Ya existe un producto con ese SKU.' },
  );
  assert.match(
    describeDbError({ code: '23503', message: 'update or delete on table "categories" violates foreign key constraint "products_category_id_fkey" on table "products"' }).message,
    /tiene productos asociados/,
  );
  assert.equal(
    describeDbError({
      code: '23503',
      message: 'insert or update on table "products" violates foreign key constraint "products_category_id_fkey"',
      details: 'Key (category_id)=(x) is not present in table "categories".',
    }).field,
    'categoryId',
  );
  assert.match(describeDbError({ code: '42501', message: 'permission denied' }).message, /permisos/);
  assert.doesNotMatch(describeDbError({ code: 'XX000', message: 'secreto interno' }).message, /secreto/);
});

test('productFromForm lee beneficios y presentación (vacíos → null)', () => {
  const lleno = productFromForm(form({ ...valido, benefits: '  Nutre y protege. ', presentation: 'Pomo de 180 cc.' }));
  assert.equal(lleno.input.benefits, 'Nutre y protege.');
  assert.equal(lleno.input.presentation, 'Pomo de 180 cc.');
  const vacio = productFromForm(form({ ...valido, benefits: '   ', presentation: '' }));
  assert.equal(vacio.input.benefits, null);
  assert.equal(vacio.input.presentation, null);
});
