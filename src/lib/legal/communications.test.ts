import { test } from 'node:test';
import assert from 'node:assert/strict';
import { allowedActions, attentionReason, cleanNote, isAdminAction, STATUS_LABEL } from './communications.ts';
import { parseRecoveryRequest, parseRecoveryToken } from './request.ts';

const now = new Date('2026-11-04T12:00:00Z');
const base = { kind: 'constancia', status: 'pendiente', next_attempt_at: '2026-11-04T11:59:00Z', last_attempt_at: null };

test('intervención humana: fallidos, rebotes y demoras (no recuperaciones fallidas)', () => {
  assert.equal(attentionReason(base, now), null);
  assert.equal(attentionReason({ ...base, next_attempt_at: '2026-11-04T11:00:00Z' }, now), 'demorado');
  assert.equal(attentionReason({ ...base, status: 'enviando', last_attempt_at: '2026-11-04T11:00:00Z' }, now), 'demorado');
  assert.equal(attentionReason({ ...base, status: 'fallido' }, now), 'fallido');
  assert.equal(attentionReason({ ...base, status: 'rebotado' }, now), 'rebotado');
  assert.equal(attentionReason({ ...base, status: 'fallido', kind: 'recuperacion' }, now), null);
  assert.equal(attentionReason({ ...base, status: 'aceptado' }, now), null);
});

test('acciones permitidas coinciden con la base', () => {
  assert.deepEqual(allowedActions({ kind: 'constancia', status: 'fallido' }), ['reintento_manual', 'resuelto_manual']);
  assert.deepEqual(allowedActions({ kind: 'constancia', status: 'aceptado' }), ['reintento_manual', 'rebote_manual']);
  assert.deepEqual(allowedActions({ kind: 'constancia', status: 'enviando' }), []);
  assert.deepEqual(allowedActions({ kind: 'recuperacion', status: 'fallido' }), ['resuelto_manual']);
  assert.ok(isAdminAction('rebote_manual') && !isAdminAction('pagar'));
});

test('«aceptado» nunca se presenta como entregado', () => {
  assert.doesNotMatch(STATUS_LABEL.aceptado, /entregad|leíd/i);
});

test('notas de auditoría acotadas y sin controles', () => {
  assert.equal(cleanNote('  ok  '), 'ok');
  assert.equal(cleanNote('x'.repeat(501)), null);
  assert.equal(cleanNote('a\u0000b'), null);
  assert.equal(cleanNote(5), null);
});

test('recuperación: email normalizado, honeypot y campos extra rechazados; token con formato exacto', () => {
  assert.deepEqual(parseRecoveryRequest({ email: ' PERSONA@Example.test ', website: '' }), { email: 'persona@example.test' });
  for (const v of [null, [], {}, { email: 'mal', website: '' }, { email: 'a@b.co', website: 'bot' }, { email: 'a@b.co', website: '', code: 'x' }]) assert.equal(parseRecoveryRequest(v), null);
  assert.equal(parseRecoveryToken({ token: 'A'.repeat(43) }), 'A'.repeat(43));
  for (const v of [null, {}, { token: 'A'.repeat(42) }, { token: 'A'.repeat(42) + '=' }, { token: 5 }]) assert.equal(parseRecoveryToken(v), null);
  // el token de seguimiento de pedidos (otro formato) no sirve como token de recuperación
  assert.equal(parseRecoveryToken({ token: 'v1.' + 'a'.repeat(40) }), null);
});
