import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { test } from 'node:test';
import { inspectPayment, reconcilePayment } from './payment-reconciliation.ts';
import { orderNotification, paymentReconciliationEnabled, signedOrder } from './payment-webhook.ts';

const secret = 'fixture-local-'.repeat(4);
const id = 'ORDMOCK' + 'a'.repeat(32);
const now = 1_795_000_000_000;
const url = new URL(`http://localhost/api/mercadopago/webhook?data.id=${id}&type=order`);
const sign = (ts: string) => new Headers({
  'x-request-id': 'req-1',
  'x-signature': `ts=${ts},v1=${createHmac('sha256', secret).update(`id:${id};request-id:req-1;ts:${ts};`).digest('hex')}`,
});

test('manifest exacto, segundos y milisegundos, sin normalizar el identificador', () => {
  for (const ts of [String(now), String(now / 1000)]) {
    assert.deepEqual(signedOrder(url, sign(ts), secret, now), { provider: id, request: 'req-1' });
  }
  const changed = new URL(url);
  changed.searchParams.set('data.id', 'ORDMOCK' + 'b'.repeat(32));
  assert.equal(signedOrder(changed, sign(String(now)), secret, now), null);
  changed.searchParams.set('data.id', id.toUpperCase());
  assert.equal(signedOrder(changed, sign(String(now)), secret, now), null);
  changed.searchParams.append('data.id', id);
  assert.equal(signedOrder(changed, sign(String(now)), secret, now), null);
});

test('rechaza firma ausente, alterada, de otro secreto, repetida en cabecera y fuera de ventana', () => {
  const headers = sign(String(now));
  assert.equal(signedOrder(url, new Headers(), secret, now), null);
  assert.equal(signedOrder(url, headers, 'otra', now), null);
  const signature = headers.get('x-signature')!;
  headers.set('x-signature', signature.slice(0, -1) + (signature.endsWith('0') ? '1' : '0'));
  assert.equal(signedOrder(url, headers, secret, now), null);
  headers.set('x-signature', signature + ',ts=' + now);
  assert.equal(signedOrder(url, headers, secret, now), null);
  assert.equal(signedOrder(url, sign(String(now - 300_001)), secret, now), null);
  assert.equal(signedOrder(url, sign(String(now + 30_001)), secret, now), null);
});

test('el evento exige tipo y recurso concordantes y entorno simulado', () => {
  const event = { type: 'order', api_version: 'v1', id: '1234', action: 'order.processed', live_mode: false, data: { id } };
  assert.deepEqual(orderNotification(event, id), { id: '1234', event: 'order.processed' });
  assert.equal(orderNotification({ ...event, live_mode: true }, id), null);
  assert.equal(orderNotification(event, 'otro'), null);
  assert.equal(orderNotification({ ...event, type: 'payment' }, id), null);
});

const evidence = {
  id, external_reference: 'STF-2026-2345', total_amount: '1500.35', total_paid_amount: '1500.35',
  status: 'processed', status_detail: 'accredited', currency: 'ARS', user_id: 'local-simulator',
  application_id: 'local-payment-app', live_mode: false, revision: 2, payment_id: 'PAYMOCK' + 'b'.repeat(32),
};
const expected = { provider: id, reference: evidence.external_reference };

test('evidencia acreditada verifica aplicación, vendedor, moneda, entorno, referencia, ID e importe exacto', () => {
  assert.equal(inspectPayment(evidence, expected).state, 'accredited');
  for (const change of [{ user_id: 'otro' }, { currency: 'USD' }, { application_id: 'otra' }, { live_mode: true },
    { external_reference: 'STF-2026-3456' }, { id: 'ORDMOCK' + 'b'.repeat(32) }]) {
    assert.equal(inspectPayment({ ...evidence, ...change }, expected).error, 'identity_mismatch');
  }
  assert.equal(inspectPayment({ ...evidence, total_paid_amount: '1500.34' }, expected).error, 'invalid_accreditation');
  assert.equal(inspectPayment({ ...evidence, payment_id: null }, expected).error, 'invalid_accreditation');
});

test('mapea estados explícitos y processed por sí solo nunca acredita', () => {
  for (const [status, status_detail, result] of [
    ['created', 'created', 'created'], ['action_required', 'waiting_capture', 'pending'],
    ['action_required', 'pending_challenge', 'processing'], ['processing', 'in_process', 'processing'],
    ['failed', 'high_risk', 'rejected'], ['canceled', 'canceled', 'cancelled'], ['expired', 'expired', 'expired'],
    ['refunded', 'refunded', 'refunded'], ['processed', 'partially_refunded', 'partially_refunded'],
    ['charged_back', 'in_process', 'disputed'],
  ]) assert.equal(inspectPayment({ ...evidence, status, status_detail }, expected).state, result);
  assert.equal(inspectPayment({ ...evidence, status_detail: 'other' }, expected).error, 'unknown_state');
});

test('el modo local explícito falla cerrado en build, Vercel, proxy y Cloud', () => {
  const env = { NODE_ENV: 'development', STEFFEN_MP_MODE: 'mock', STEFFEN_MP_RECONCILIATION: '1',
    NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321' };
  assert.equal(paymentReconciliationEnabled(env), true);
  for (const change of [{ NODE_ENV: 'production' }, { VERCEL: '1' }, { STEFFEN_TRUSTED_PROXY: 'traefik' },
    { NEXT_PUBLIC_SUPABASE_URL: 'https://example.supabase.co' }, { STEFFEN_MP_RECONCILIATION: '0' }]) {
    assert.equal(paymentReconciliationEnabled({ ...env, ...change }), false);
  }
});

test('el conciliador clasifica la consulta ausente, transitoria y permanente', async () => {
  const job = { id: 'job', lease: 'lease', provider: id, reference: expected.reference, createdAt: null };
  for (const [reply, reason, retry] of [
    [{ data: [], error: null, status: 200 }, 'provider_not_found', true],
    [{ data: null, error: {}, status: 429 }, 'provider_unavailable', true],
    [{ data: null, error: {}, status: 403 }, 'provider_rejected', false],
  ] as const) {
    const db = {
      rpc(name: string, args: Record<string, unknown>) {
        if (name === 'tomar_trabajos_pago') return { abortSignal: async () => ({ data: job }) };
        if (name === 'buscar_order_pago_simulada') return { abortSignal: async () => reply };
        assert.equal(name, 'resolver_trabajo_pago');
        assert.deepEqual(args, { p_id: job.id, p_lease: job.lease, p_evidence: null, p_state: null, p_error: reason, p_retry: retry });
        return { abortSignal: async () => ({ data: reason }) };
      },
    } as unknown as Parameters<typeof reconcilePayment>[0];
    assert.equal((await reconcilePayment(db))?.result, reason);
  }
});
