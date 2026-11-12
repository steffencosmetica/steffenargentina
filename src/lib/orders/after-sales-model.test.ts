import { test } from 'node:test';
import assert from 'node:assert/strict';
import { refundBody } from './after-sales-model.ts';

const transactions = [{ id: 'PAY1', paid: 10001, refunded: 1 }, { id: 'PAY2', paid: 2500, refunded: 500 }];
test('reembolso total omite body y calcula saldo de todas las transacciones', () => {
  assert.equal(refundBody('full', null, 12000, transactions), null);
  assert.throws(() => refundBody('full', null, 12501, transactions));
  assert.throws(() => refundBody('full', 'PAY1', 12000, transactions));
});
test('parcial selecciona una transacción y conserva centavos exactos', () => {
  assert.deepEqual(refundBody('partial', 'PAY2', 1001, transactions), { transactions: [{ id: 'PAY2', amount: '10.01' }] });
  assert.throws(() => refundBody('partial', 'PAY2', 2001, transactions));
  assert.throws(() => refundBody('partial', 'otra', 1, transactions));
});
test('rechaza importes inseguros y evidencia inconsistente', () => {
  for (const cents of [0, -1, 1.1, NaN, Infinity, Number.MAX_SAFE_INTEGER]) {
    assert.throws(() => refundBody('partial', 'PAY1', cents, transactions));
  }
  assert.throws(() => refundBody('full', null, 1, []));
  assert.throws(() => refundBody('full', null, 1, [transactions[0], transactions[0]]));
  assert.throws(() => refundBody('full', null, 1, [{ id: 'PAY1', paid: 100, refunded: 101 }]));
});
