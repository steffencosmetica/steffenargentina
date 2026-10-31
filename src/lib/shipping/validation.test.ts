import { test } from 'node:test';
import assert from 'node:assert/strict';
import { PROVINCE_CODES, REGIONS, isProvinceCode } from './regions.ts';
import { validateZoneInput, zoneFromForm } from './validation.ts';

function form(values: Record<string, string | string[]>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) for (const item of [v].flat()) data.append(k, item);
  return data;
}

test('las regiones cubren las 24 jurisdicciones, sin repetir', () => {
  assert.equal(PROVINCE_CODES.length, 24);
  assert.equal(new Set(PROVINCE_CODES).size, 24);
  assert.ok(PROVINCE_CODES.every((c) => /^AR-[A-Z]$/.test(c)));
  assert.equal(REGIONS[0].codes[0], 'AR-C');
  assert.ok(isProvinceCode('AR-V'));
  assert.equal(isProvinceCode('AR-I'), false); // AR-I no existe en ISO 3166-2:AR
  assert.equal(isProvinceCode('ar-c'), false);
});

test('zoneFromForm lee tarifa, envío gratis y provincias (sin duplicados)', () => {
  const { input, errors } = zoneFromForm(
    form({ name: '  AMBA ', price: '5.000,50', freeEnabled: 'on', freeFrom: '60.000', isActive: 'on', provinces: ['AR-C', 'AR-B', 'AR-C'] }),
  );
  assert.deepEqual(errors, {});
  assert.deepEqual(input, {
    name: 'AMBA',
    priceCentavos: 500_050,
    freeFromCentavos: 6_000_000,
    isActive: true,
    provinces: ['AR-B', 'AR-C'],
    move: false,
  });
  assert.deepEqual(validateZoneInput(input), {});
});

test('envío gratis desactivado ignora el importe; tarifa 0 permitida', () => {
  const { input, errors } = zoneFromForm(form({ name: 'Retiro', price: '0', freeFrom: '1.000', move: '1' }));
  assert.deepEqual(errors, {});
  assert.equal(input.freeFromCentavos, null);
  assert.equal(input.priceCentavos, 0);
  assert.equal(input.isActive, false);
  assert.equal(input.move, true);
  assert.deepEqual(validateZoneInput(input), {});
});

test('tarifas y umbrales inválidos', () => {
  assert.ok(zoneFromForm(form({ name: 'x', price: '' })).errors.price);
  assert.ok(zoneFromForm(form({ name: 'x', price: '-100' })).errors.price);
  assert.ok(zoneFromForm(form({ name: 'x', price: '5,000.50' })).errors.price);
  assert.ok(zoneFromForm(form({ name: 'x', price: '100', freeEnabled: 'on', freeFrom: '' })).errors.freeFrom);
  const cero = zoneFromForm(form({ name: 'x', price: '100', freeEnabled: 'on', freeFrom: '0' }));
  assert.ok(validateZoneInput(cero.input).freeFrom);
  assert.ok(validateZoneInput(zoneFromForm(form({ name: '', price: '1' })).input).name);
  assert.ok(validateZoneInput(zoneFromForm(form({ name: 'x'.repeat(81), price: '1' })).input).name);
  assert.ok(validateZoneInput(zoneFromForm(form({ name: 'x', price: '1', provinces: ['AR-C', 'XX'] })).input).provinces);
});
