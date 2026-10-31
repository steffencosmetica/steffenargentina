import { test } from 'node:test';
import assert from 'node:assert/strict';
import { centavosToDecimal, formatArs, formatPesosInput, parseCentavos, parsePesosInput } from './money.ts';

test('parseCentavos convierte importes exactos', () => {
  assert.equal(parseCentavos('12500'), 1_250_000);
  assert.equal(parseCentavos('12500.5'), 1_250_050);
  assert.equal(parseCentavos('12500.50'), 1_250_050);
  assert.equal(parseCentavos('0.10'), 10);
  assert.equal(parseCentavos('0.29'), 29); // 0.29 * 100 en float da 28.999999999999996
  assert.equal(parseCentavos('1.15'), 115); // 1.15 * 100 en float da 114.99999999999999
  assert.equal(parseCentavos('0'), 0);
  assert.equal(parseCentavos('007.05'), 705);
  assert.equal(parseCentavos('9999999999.99'), 999_999_999_999);
});

test('parseCentavos rechaza importes inválidos', () => {
  for (const v of ['', '-1', '-0.01', '1.001', '1,50', 'abc', '1e3', '10000000000.00', ' . ', 'NaN']) {
    assert.throws(() => parseCentavos(v), Error, v);
  }
});

test('centavosToDecimal vuelve al formato de numeric(12,2)', () => {
  assert.equal(centavosToDecimal(1_250_050), '12500.50');
  assert.equal(centavosToDecimal(5), '0.05');
  assert.equal(centavosToDecimal(0), '0.00');
  assert.throws(() => centavosToDecimal(-1));
  assert.throws(() => centavosToDecimal(1.5));
});

test('formatArs muestra pesos argentinos', () => {
  assert.equal(formatArs(1_250_000), '$ 12.500');
  assert.equal(formatArs(1_250_050), '$ 12.500,50');
  assert.equal(formatArs(5), '$ 0,05');
  assert.equal(formatArs(999_999_999_999), '$ 9.999.999.999,99');
});

test('ida y vuelta sin pérdida', () => {
  for (const v of ['0.01', '0.29', '1.15', '19.99', '123456.78', '9999999999.99']) {
    assert.equal(centavosToDecimal(parseCentavos(v)), v);
  }
});

test('parsePesosInput entiende el formato argentino', () => {
  assert.equal(parsePesosInput('12500'), 1_250_000);
  assert.equal(parsePesosInput('12.500'), 1_250_000);
  assert.equal(parsePesosInput('12.500,50'), 1_250_050);
  assert.equal(parsePesosInput('12500,5'), 1_250_050);
  assert.equal(parsePesosInput('$ 1.234.567,89'), 123_456_789);
  assert.equal(parsePesosInput('12500.50'), 1_250_050);
  assert.equal(parsePesosInput('0,29'), 29);
  assert.equal(parsePesosInput(' 0 '), 0);
});

test('parsePesosInput rechaza importes ambiguos o inválidos', () => {
  for (const v of ['', 'abc', '-100', '12,500.50', '1.23.4', '12.5000', '12,505', '1e5', '10000000000,00']) {
    assert.equal(parsePesosInput(v), null, v);
  }
});

test('formatPesosInput vuelve al formato del formulario', () => {
  assert.equal(formatPesosInput(1_250_050), '12.500,50');
  assert.equal(formatPesosInput(1_250_000), '12.500');
  for (const c of [0, 29, 1_250_050, 123_456_789]) assert.equal(parsePesosInput(formatPesosInput(c)), c);
});
