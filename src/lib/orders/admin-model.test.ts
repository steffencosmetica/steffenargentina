import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedOperations, filtersFrom, pageNumber } from './admin-model.ts';
test('filtros validan estados, fechas y longitud sin interpretar búsqueda como SQL', () => {
  const f = filtersFrom({ q: '  a%,(email)  ', payment: 'approved', fulfillment: 'bogus', from: '2026-02-31', to: '2026-11-03' });
  assert.equal(f.q, 'a%,(email)'); assert.equal(f.payment, 'approved'); assert.equal(f.fulfillment, ''); assert.equal(f.from, ''); assert.equal(f.to, '2026-11-03');
  assert.equal(filtersFrom({ q: 'x'.repeat(200) }).q.length, 120);
});
test('paginación acotada', () => { for (const value of ['0', '-1', '1.5', '1000000', undefined]) assert.equal(pageNumber(value), 1); assert.equal(pageNumber('12'), 12); });
test('operaciones disponibles respetan pago, stock, incidencias y secuencia', () => {
  const o = { payment_status: 'approved', stock_state: 'consumed', resolution_status: 'none', fulfillment_status: 'pending' };
  assert.deepEqual(allowedOperations(o), ['preparing']);
  assert.deepEqual(allowedOperations({ ...o, fulfillment_status: 'preparing' }), ['pending', 'shipped']);
  assert.deepEqual(allowedOperations({ ...o, fulfillment_status: 'shipped' }), ['delivered']);
  assert.deepEqual(allowedOperations({ ...o, fulfillment_status: 'delivered' }), []);
  assert.deepEqual(allowedOperations({ ...o, resolution_status: 'pending' }), []);
  assert.deepEqual(allowedOperations({ ...o, stock_state: 'shortage' }), ['resolve_stock']);
  assert.deepEqual(allowedOperations({ ...o, payment_status: 'pending', stock_state: 'reserved' }), ['cancel']);
});
