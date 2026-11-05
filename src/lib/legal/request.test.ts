import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseRevocation } from './request.ts';
const valid = { purchaseReference: '  STF-FICTICIO  ', email: '  PERSONA@example.test ', idempotencyKey: 'aa000000-0000-4000-8000-000000000001', website: '' };
test('arrepentimiento normaliza solo los datos mínimos de identificación y contacto', () => {
  assert.deepEqual(parseRevocation(valid), { ...valid, purchaseReference: 'STF-FICTICIO', email: 'persona@example.test' });
});
test('arrepentimiento rechaza cuerpos inválidos, abuso y datos fuera de límites', () => {
  for (const input of [null, [], 'x', {}, { ...valid, website: 'bot' }, { ...valid, email: 'incorrecto' }, { ...valid, purchaseReference: 'xx' }, { ...valid, purchaseReference: 'a'.repeat(101) }, { ...valid, purchaseReference: 'abc\nsecreto' }, { ...valid, idempotencyKey: 'no' }]) assert.equal(parseRevocation(input), null);
});
