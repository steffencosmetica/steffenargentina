// Control optimista del stock en el panel: lectura de la versión, traducción del conflicto (SR003) y
// recarga del campo con el valor actual.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { currentStock, IDLE, type ActionState } from '../admin/action-state.ts';
import { describeDbError, stockConflictFrom, stockConflictMessage } from './errors.ts';
import { stockVersionFromForm } from './form.ts';

function form(values: Record<string, string>) {
  const data = new FormData();
  for (const [k, v] of Object.entries(values)) data.append(k, v);
  return data;
}

// error tal como lo devuelve PostgREST cuando el trigger products_control_stock rechaza el UPDATE
const conflict = { code: 'SR003', message: 'stock_conflict', details: '{"stock": 17, "stock_version": 1}', hint: '…' };

test('stockVersionFromForm: entero no negativo o null', () => {
  assert.equal(stockVersionFromForm(form({ stockVersion: '0' })), 0);
  assert.equal(stockVersionFromForm(form({ stockVersion: ' 42 ' })), 42);
  assert.equal(stockVersionFromForm(form({})), null);
  assert.equal(stockVersionFromForm(form({ stockVersion: '' })), null);
  assert.equal(stockVersionFromForm(form({ stockVersion: '-1' })), null);
  assert.equal(stockVersionFromForm(form({ stockVersion: '1.5' })), null);
  assert.equal(stockVersionFromForm(form({ stockVersion: '1e3' })), null);
  assert.equal(stockVersionFromForm(form({ stockVersion: '9'.repeat(16) })), null);
});

test('el conflicto SR003 trae el stock y la versión actuales', () => {
  assert.deepEqual(stockConflictFrom(conflict), { stock: 17, version: 1 });
  assert.equal(stockConflictFrom({ code: '23514', details: conflict.details }), null);
  assert.equal(stockConflictFrom({ code: 'SR003', details: 'no es json' }), null);
  assert.equal(stockConflictFrom({ code: 'SR003', details: '{"stock": -1, "stock_version": 1}' }), null);
});

test('mensaje claro para el administrador, en el campo stock', () => {
  const friendly = describeDbError(conflict);
  assert.equal(friendly.field, 'stock');
  assert.match(friendly.message, /cambió mientras editabas/);
  assert.match(friendly.message, /Ahora hay 17 unidades disponibles/);
  assert.match(stockConflictMessage({ stock: 1 }), /1 unidad disponible\./);
  assert.match(stockConflictMessage(null), /Revisá el valor y volvé a guardar/);
  assert.doesNotMatch(friendly.message, /SR003|stock_conflict|trigger/, 'sin detalles técnicos');
});

test('currentStock: tras un conflicto el formulario muestra el valor actual y la versión nueva', () => {
  const read = { stock: 20, version: 0 };
  assert.deepEqual(currentStock(read, IDLE), read);
  const error: ActionState = { status: 'error', message: 'x', stockConflict: { stock: 17, version: 1 } };
  assert.deepEqual(currentStock(read, error), { stock: 17, version: 1 });
  // cuando la página se vuelve a renderizar con datos más nuevos, ganan esos
  assert.deepEqual(currentStock({ stock: 25, version: 2 }, error), { stock: 25, version: 2 });
  assert.deepEqual(currentStock(read, { status: 'error', message: 'otro error' }), read);
});
