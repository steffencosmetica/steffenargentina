import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MailSendError, classifySmtpError, redact } from './errors.ts';
import { mailConfigFromEnv, fromDomain } from './config.ts';
import { renderMessage, type ClaimedMessage } from './templates.ts';
import { fileTransport, type MailTransport } from './transports.ts';
import { drainOnce, type MailQueue, type Outcome } from './worker.ts';
import { evaluateHealth, parseStats } from './health.ts';

const ctx = { linkBaseUrl: 'https://steffenargentina.com.ar', contactEmail: 'info@steffenargentina.com.ar', whatsapp: '+54 9 223-559-0428' };
const CODE = 'ARR-0123456789ABCDEF0123456789ABCDEF';
const TOKEN = 'a'.repeat(40) + '_-Z';
const constancia: ClaimedMessage = { id: 'm1', leaseId: 'l1', kind: 'constancia', recipient: 'persona@example.test', attempt: 1, payload: { code: CODE, received_at: '2026-11-04T15:00:00Z' } };

test('redacción: sin emails, sin controles y acotada', () => {
  assert.equal(redact('550 <persona@example.test> no existe\r\nmás'), '550 <[email]> no existe más');
  assert.equal(redact('x'.repeat(500)).length, 200);
  assert.equal(new MailSendError('temporal', 'SMTP 421!', 'para a@b.co').detail, 'para [email]');
  assert.equal(new MailSendError('temporal', 'SMTP 421!').code, 'smtp421');
});

test('clasificación SMTP: temporales, autenticación y permanentes', () => {
  assert.equal(classifySmtpError({ responseCode: 421, response: '421 try later' }).kind, 'temporal');
  assert.deepEqual([classifySmtpError({ responseCode: 535 }).kind, classifySmtpError({ responseCode: 535 }).code], ['temporal', 'smtp_auth_535']);
  assert.equal(classifySmtpError({ responseCode: 550, response: '550 user@x.com unknown' }).kind, 'permanente');
  assert.equal(classifySmtpError({ responseCode: 550, response: '550 user@x.com unknown' }).detail, '550 [email] unknown');
  assert.equal(classifySmtpError({ code: 'ETIMEDOUT' }).code, 'red_etimedout');
  assert.equal(classifySmtpError({ code: 'EENVELOPE' }).kind, 'permanente');
  assert.equal(classifySmtpError(new Error('boom')).kind, 'temporal');
});

test('configuración: desactivado por defecto, SMTP exige permiso explícito y credenciales', () => {
  assert.deepEqual(mailConfigFromEnv({}), { ok: true, config: { transport: 'desactivado' } });
  const smtp = { MAIL_TRANSPORT: 'smtp', MAIL_FROM: 'Steffen <info@steffenargentina.com.ar>', MAIL_LINK_BASE_URL: 'https://steffenargentina.com.ar', MAIL_SMTP_HOST: 'smtp.zoho.com', MAIL_SMTP_PORT: '465', MAIL_SMTP_USER: 'u', MAIL_SMTP_PASSWORD: 'p',
    NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefgh.supabase.co', MAIL_SUPABASE_HOST: 'abcdefgh.supabase.co' };
  assert.equal(mailConfigFromEnv(smtp).ok, false, 'sin MAIL_ALLOW_REAL_SEND no hay envío real');
  for (const v of ['true', 'yes', ' 1', '0', '']) assert.equal(mailConfigFromEnv({ ...smtp, MAIL_ALLOW_REAL_SEND: v }).ok, false, `MAIL_ALLOW_REAL_SEND=${JSON.stringify(v)} no habilita`);
  assert.deepEqual(mailConfigFromEnv({ MAIL_ALLOW_REAL_SEND: '1' }), { ok: true, config: { transport: 'desactivado' } }, 'el permiso solo no activa nada');
  const ok = mailConfigFromEnv({ ...smtp, MAIL_ALLOW_REAL_SEND: '1' });
  assert.ok(ok.ok && ok.config.transport === 'smtp' && ok.config.smtp.secure === true);
  // atadura al proyecto y nunca correo real con la base local
  assert.equal(mailConfigFromEnv({ ...smtp, MAIL_ALLOW_REAL_SEND: '1', MAIL_SUPABASE_HOST: '' }).ok, false);
  assert.equal(mailConfigFromEnv({ ...smtp, MAIL_ALLOW_REAL_SEND: '1', MAIL_SUPABASE_HOST: 'otroproyecto.supabase.co' }).ok, false);
  assert.equal(mailConfigFromEnv({ ...smtp, MAIL_ALLOW_REAL_SEND: '1', NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321', MAIL_SUPABASE_HOST: '127.0.0.1' }).ok, false);
  assert.equal(mailConfigFromEnv({ ...smtp, MAIL_ALLOW_REAL_SEND: '1', NEXT_PUBLIC_SUPABASE_URL: undefined }).ok, false);
  // el transporte archivo (enlaces privados en disco) solo con la base local
  const file = { MAIL_TRANSPORT: 'archivo', MAIL_FROM: 'a@b.co', MAIL_LINK_BASE_URL: 'http://localhost:3000', MAIL_CAPTURE_DIR: 'x' };
  assert.equal(mailConfigFromEnv({ ...file, NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:55321' }).ok, true);
  assert.equal(mailConfigFromEnv({ ...file, NEXT_PUBLIC_SUPABASE_URL: 'https://abcdefgh.supabase.co' }).ok, false);
  assert.equal(mailConfigFromEnv({ ...smtp, MAIL_ALLOW_REAL_SEND: '1', MAIL_SMTP_PASSWORD: '' }).ok, false);
  assert.equal(mailConfigFromEnv({ ...smtp, MAIL_ALLOW_REAL_SEND: '1', MAIL_SMTP_PORT: '25' }).ok, false);
  assert.equal(mailConfigFromEnv({ ...smtp, MAIL_ALLOW_REAL_SEND: '1', MAIL_LINK_BASE_URL: 'http://steffen.test' }).ok, false, 'enlaces solo https');
  assert.equal(mailConfigFromEnv({ ...smtp, MAIL_ALLOW_REAL_SEND: '1', MAIL_LINK_BASE_URL: 'http://localhost:3000' }).ok, false, 'SMTP real nunca con enlaces locales');
  assert.equal(mailConfigFromEnv({ MAIL_TRANSPORT: 'archivo', MAIL_FROM: 'a@b.co', MAIL_LINK_BASE_URL: 'http://localhost:3000', MAIL_CAPTURE_DIR: 'x', VERCEL: '1' }).ok, false);
  assert.equal(mailConfigFromEnv({ MAIL_TRANSPORT: 'otro' }).ok, false);
  assert.equal(fromDomain('Steffen <info@steffenargentina.com.ar>'), 'steffenargentina.com.ar');
});

test('plantillas: constancia sin referencia de compra, recuperación con enlace por fragmento, alerta sin datos personales', () => {
  const c = renderMessage(constancia, ctx);
  assert.match(c.subject, new RegExp(CODE));
  assert.match(c.text, /copia de respaldo/);
  assert.match(c.text, /no confirma un reembolso/);
  assert.match(c.text, /lunes a viernes de 8:00 a 16:00/);
  assert.match(c.text, /hora de Argentina/);
  assert.doesNotMatch(c.text, /persona@example\.test/);
  assert.doesNotMatch(c.text + c.html, /descuento|promoci|oferta/i, 'sin marketing');
  const r = renderMessage({ ...constancia, kind: 'recuperacion', payload: { token: TOKEN, expires_minutes: 30 } }, ctx);
  assert.ok(r.text.includes(`https://steffenargentina.com.ar/arrepentimiento/recuperar#t=${TOKEN}`));
  assert.ok(r.html.includes(`#t=${TOKEN}`));
  assert.match(r.text, /una sola vez/);
  const a = renderMessage({ ...constancia, kind: 'alerta', recipient: 'info@steffenargentina.com.ar', payload: { code: CODE, failed_kind: 'constancia', failed_status: 'fallido', error_code: 'smtp_550', attempts: 3 } }, ctx);
  assert.match(a.subject, /Alerta/);
  assert.match(a.text, /smtp_550/);
  assert.doesNotMatch(a.text, /@example/);
  assert.throws(() => renderMessage({ ...constancia, payload: { code: '<script>', received_at: 'x' } }, ctx));
  assert.throws(() => renderMessage({ ...constancia, kind: 'recuperacion', payload: { token: 'corto' } }, ctx));
});

test('plantillas escapan HTML', () => {
  const r = renderMessage({ ...constancia, kind: 'alerta', payload: { code: CODE, failed_kind: 'x<b>', error_code: '<i>' } }, ctx);
  assert.doesNotMatch(r.html, /<b>|<i>/);
});

function fakeQueue(messages: ClaimedMessage[]) {
  const reports: { id: string; outcome: Outcome; code?: string }[] = [];
  let claimed = false;
  const queue: MailQueue = {
    async claim() { if (claimed) return []; claimed = true; return messages; },
    async report(id, _lease, outcome, error) { reports.push({ id, outcome, code: error?.code }); return outcome === 'aceptado' ? 'aceptado' : outcome === 'error_temporal' ? 'reintento' : 'fallido'; },
  };
  return { queue, reports };
}

test('ejecutor: aceptado, fallo temporal, fallo permanente y plantilla inválida', async () => {
  const sent: string[] = [];
  const transport: MailTransport = { name: 'falso', async send(mail) {
    if (mail.id === 'temp') throw Object.assign(new Error('x'), { responseCode: 421 });
    if (mail.id === 'perm') throw Object.assign(new Error('x'), { responseCode: 550 });
    sent.push(mail.id); return { providerId: '<x>' };
  } };
  const { queue, reports } = fakeQueue([constancia, { ...constancia, id: 'temp' }, { ...constancia, id: 'perm' }, { ...constancia, id: 'bad', payload: {} }]);
  const logs: string[] = [];
  const summary = await drainOnce({ queue, transport, context: ctx, worker: 'test', log: (e, d) => logs.push(JSON.stringify({ e, ...d })) });
  assert.deepEqual(sent, ['m1']);
  assert.deepEqual(reports.map(r => [r.id, r.outcome, r.code]), [['m1', 'aceptado', undefined], ['temp', 'error_temporal', 'smtp_421'], ['perm', 'error_permanente', 'smtp_550'], ['bad', 'error_permanente', 'plantilla']]);
  assert.deepEqual({ ...summary }, { claimed: 4, accepted: 1, retry: 1, failed: 2, unchanged: 0, reportErrors: 0 });
  assert.ok(logs.every(l => !l.includes('@')), 'los registros no tienen emails');
});

test('ejecutor: si la base no registra el resultado, sigue con el resto y no lo oculta', async () => {
  let calls = 0;
  const queue: MailQueue = { async claim() { return [constancia, { ...constancia, id: 'm2' }]; }, async report() { calls++; if (calls === 1) throw new Error('db caída'); return 'aceptado'; } };
  const summary = await drainOnce({ queue, transport: { name: 'ok', async send() { return {}; } }, context: ctx, worker: 'test' });
  assert.equal(summary.reportErrors, 1);
  assert.equal(summary.accepted, 1);
});

test('ejecutor: si la base no responde al reclamar, el error se propaga (el proceso reintenta)', async () => {
  const queue: MailQueue = { async claim() { throw new Error('reclamar:500'); }, async report() { return ''; } };
  await assert.rejects(drainOnce({ queue, transport: { name: 'ok', async send() { return {}; } }, context: ctx, worker: 'test' }));
});

test('transporte archivo: captura local y simulaciones de caída y rechazo', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'steffen-mail-'));
  try {
    const t = fileTransport({ transport: 'archivo', captureDir: dir, from: 'Steffen <info@steffenargentina.com.ar>', linkBaseUrl: 'http://localhost:3000' });
    const mail = { ...renderMessage(constancia, ctx), id: 'abc', to: 'persona@example.test' };
    const { providerId } = await t.send(mail);
    assert.equal(providerId, '<arr-abc@steffenargentina.com.ar>');
    const files = await readdir(dir);
    assert.equal(files.length, 1);
    const saved = JSON.parse(await readFile(join(dir, files[0]), 'utf8'));
    assert.equal(saved.to, 'persona@example.test');
    assert.equal(saved.headers['Auto-Submitted'], 'auto-generated');
    await writeFile(join(dir, 'CAIDA'), '');
    await assert.rejects(t.send(mail), (e: unknown) => e instanceof MailSendError && e.kind === 'temporal');
    await rm(join(dir, 'CAIDA'));
    await writeFile(join(dir, 'RECHAZO'), '');
    await assert.rejects(t.send(mail), (e: unknown) => e instanceof MailSendError && e.kind === 'permanente');
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('salud: detecta ejecutor ausente o detenido, demoras y fallos', () => {
  const base = { now: '2026-11-04T12:00:00Z', pendientes: 0, vencidas: 0, fallidas: 0, alertas_pendientes: 0, mas_antigua_pendiente: null, ultimo_ejecutor: '2026-11-04T11:58:00Z' };
  assert.deepEqual(evaluateHealth(base).problemas, []);
  assert.deepEqual(evaluateHealth({ ...base, ultimo_ejecutor: null }).problemas, ['sin_ejecutor']);
  assert.deepEqual(evaluateHealth({ ...base, ultimo_ejecutor: '2026-11-04T11:00:00Z' }).problemas, ['ejecutor_detenido']);
  assert.deepEqual(evaluateHealth({ ...base, vencidas: 2, fallidas: 1 }).problemas, ['comunicaciones_demoradas', 'comunicaciones_fallidas']);
  assert.equal(parseStats({ now: 'x' }), null);
  assert.deepEqual(parseStats(base), base);
});
