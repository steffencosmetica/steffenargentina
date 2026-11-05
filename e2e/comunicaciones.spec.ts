import { test, expect, type APIRequestContext } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { LOCAL_SUPABASE, MAIL_E2E, localSecretKey, localSql, mailEnv } from './local';
import { ADMIN_STATE } from './helpers';

// Fase 4B.7: constancia web + respaldo por email (transporte «archivo»: ningún email sale a la red).

type Captured = { to: string; subject: string; text: string; html: string; messageId: string; file: string };
const DIR = MAIL_E2E.captureDir;

function captured(): Captured[] {
  if (!existsSync(DIR)) return [];
  return readdirSync(DIR).filter(f => f.endsWith('.json')).sort().map(f => ({ ...JSON.parse(readFileSync(join(DIR, f), 'utf8')), file: f }));
}
function simulate(kind: 'CAIDA' | 'RECHAZO' | null) {
  for (const f of ['CAIDA', 'RECHAZO']) rmSync(join(DIR, f), { force: true });
  if (kind) writeFileSync(join(DIR, kind), '');
}
function reset() {
  localSql(`do $$ begin
    delete from public.revocation_messages; delete from public.revocation_requests;
    delete from private.revocation_access_tokens; delete from private.revocation_rate_events; delete from private.mail_workers;
  end $$`);
  rmSync(DIR, { recursive: true, force: true });
  mkdirSync(DIR, { recursive: true });
}
/** Ejecutor autónomo, un ciclo, con las mismas variables que usaría el VPS (base y correo locales). */
function runWorker(extra: string[] = []) {
  const r = spawnSync(process.execPath, ['--disable-warning=MODULE_TYPELESS_PACKAGE_JSON', 'scripts/mail-worker.ts', ...extra], {
    encoding: 'utf8',
    env: { ...process.env, ...mailEnv(), NEXT_PUBLIC_SUPABASE_URL: LOCAL_SUPABASE.url, SUPABASE_SECRET_KEY: localSecretKey(), MAIL_WORKER_ID: 'e2e-worker' },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}
function messageOf(code: string) {
  return localSql(`select m.id, m.status, m.attempts, m.last_error_code, m.version from public.revocation_messages m join public.revocation_requests r on r.id = m.request_id
                   where r.code = '${code}' and m.kind = 'constancia'`)[0] as { id: string; status: string; attempts: number; last_error_code: string | null; version: number };
}
async function submit(request: APIRequestContext, email: string) {
  const response = await request.post('/api/arrepentimiento', { data: { purchaseReference: `COMMS-${randomUUID().slice(0, 8)}`, email, idempotencyKey: randomUUID(), website: '' } });
  expect(response.status()).toBe(201);
  return (await response.json()) as { code: string; receivedAt: string };
}

test.beforeEach(() => reset());
test.afterAll(() => { simulate(null); reset(); });

test('constancia web inmediata y copia por email enviada sola después de responder', async ({ page }) => {
  await page.goto('/arrepentimiento');
  await page.getByLabel('Número de pedido o referencia de compra').fill('COMPRA-FICTICIA-EMAIL');
  await page.getByLabel('Email de contacto', { exact: true }).fill('comprador@example.test');
  await page.getByRole('button', { name: 'Solicitar arrepentimiento' }).click();
  const receipt = page.locator('.legal-receipt');
  await expect(receipt).toContainText(/ARR-[A-F0-9]{32}/);
  await expect(receipt).toContainText('no reemplaza esta constancia');
  await expect(receipt).not.toContainText(/entregad|recibirás el email/i);
  const code = (await receipt.locator('strong').first().textContent())!.trim();
  await expect.poll(() => captured().length).toBe(1);
  const mail = captured()[0];
  expect(mail.to).toBe('comprador@example.test');
  expect(mail.subject).toContain(code);
  expect(mail.text).toContain('copia de respaldo');
  expect(mail.text).not.toContain('COMPRA-FICTICIA-EMAIL');
  await expect.poll(() => messageOf(code).status).toBe('aceptado');
  expect(messageOf(code).attempts).toBe(1);
  await expect(receipt.getByRole('link', { name: 'recuperarla con tu email' })).toHaveAttribute('href', '/arrepentimiento/recuperar');
});

test('correo caído: la constancia web no depende del email, la comunicación persiste y se reintenta sin duplicar', async ({ request }) => {
  simulate('CAIDA');
  const receipt = await submit(request, 'caida@example.test');
  expect(receipt.code).toMatch(/^ARR-[A-F0-9]{32}$/);
  await expect.poll(() => messageOf(receipt.code).last_error_code).toBe('simulado_caida');
  expect(messageOf(receipt.code)).toMatchObject({ status: 'pendiente', attempts: 1 });
  expect(captured()).toHaveLength(0);
  // el ejecutor autónomo también encuentra el servicio caído, pero respeta la espera: no hay nada vencido
  expect(runWorker(['--once']).status).toBe(0);
  expect(messageOf(receipt.code).attempts).toBe(1);
  // servicio restablecido y espera cumplida: el ejecutor envía la MISMA comunicación
  simulate(null);
  localSql(`update public.revocation_messages set next_attempt_at = clock_timestamp() - interval '1 second' where status = 'pendiente'`);
  const run = runWorker(['--once']);
  expect(run.status).toBe(0);
  expect(run.out).not.toMatch(/@example\.test|caida@/);
  expect(messageOf(receipt.code)).toMatchObject({ status: 'aceptado', attempts: 2 });
  expect(captured().map(m => m.subject)).toEqual([expect.stringContaining(receipt.code)]);
  expect(localSql(`select count(*)::int as n from public.revocation_messages`)).toEqual([{ n: 1 }]);
  expect(localSql(`select count(*)::int as n from public.revocation_requests`)).toEqual([{ n: 1 }]);
  expect(localSql(`select array_agg(outcome order by attempt) as o from public.revocation_message_attempts`)).toEqual([{ o: ['error_temporal', 'aceptado'] }]);
});

test('ejecutor que muere en pleno envío: otro ciclo lo recupera tras el arrendamiento', async ({ request }) => {
  simulate('CAIDA');
  const receipt = await submit(request, 'ejecutor@example.test');
  await expect.poll(() => messageOf(receipt.code).attempts).toBe(1);
  simulate(null);
  // Simula un proceso que reclamó y murió antes de registrar el resultado.
  localSql(`do $$ begin
    update public.revocation_messages set next_attempt_at = clock_timestamp() - interval '1 second';
    perform public.comunicaciones_reclamar('proceso-muerto', 10, 30);
    update public.revocation_messages set locked_until = clock_timestamp() - interval '1 second';
  end $$`);
  expect(messageOf(receipt.code).status).toBe('enviando');
  expect(runWorker(['--once']).status).toBe(0);
  expect(messageOf(receipt.code)).toMatchObject({ status: 'aceptado', attempts: 3 });
  expect(localSql(`select array_agg(outcome order by attempt) as o from public.revocation_message_attempts`)).toEqual([{ o: ['error_temporal', 'interrumpido', 'aceptado'] }]);
});

test('rechazo definitivo: alerta interna sin datos personales, monitor en rojo e intervención auditada en el panel', async ({ request, browser }) => {
  simulate('RECHAZO');
  const receipt = await submit(request, 'rechazo@example.test');
  await expect.poll(() => messageOf(receipt.code).status).toBe('fallido');
  simulate(null);
  const alerts = localSql(`select recipient, status from public.revocation_messages where kind = 'alerta'`);
  expect(alerts).toEqual([{ recipient: 'info@steffenargentina.com.ar', status: 'pendiente' }]);
  expect(runWorker(['--once']).status).toBe(0);
  const alert = captured().find(m => m.to === 'info@steffenargentina.com.ar')!;
  expect(alert.subject).toContain('[Alerta Steffen]');
  expect(alert.text).toContain(receipt.code);
  expect(alert.text + alert.html).not.toContain('rechazo@example.test');

  // Monitor externo: 404 sin token, 503 con problemas, sin datos personales.
  expect((await request.get('/api/interno/comunicaciones')).status()).toBe(404);
  expect((await request.get('/api/interno/comunicaciones', { headers: { Authorization: 'Bearer incorrecto' } })).status()).toBe(404);
  const health = await request.get('/api/interno/comunicaciones', { headers: { Authorization: `Bearer ${MAIL_E2E.healthToken}` } });
  expect(health.status()).toBe(503);
  expect(health.headers()['cache-control']).toBe('no-store');
  const body = await health.json();
  expect(body.problemas).toContain('comunicaciones_fallidas');
  expect(JSON.stringify(body)).not.toMatch(/@|ARR-/);
  expect(runWorker(['--health']).status).toBe(1);

  const context = await browser.newContext({ storageState: ADMIN_STATE });
  try {
    const page = await context.newPage();
    await page.goto('/admin/arrepentimientos?filtro=intervencion');
    await expect(page.getByRole('heading', { name: receipt.code })).toBeVisible();
    await expect(page.getByText('Requiere intervención: envío fallido')).toBeVisible();
    await expect(page.locator('.adm-notice')).toContainText('Fallidas o rebotadas: 1');
    await expect(page.locator('.adm-notice')).toContainText('requieren intervención humana');
    await expect(page.getByText('simulado_rechazo')).toBeVisible();
    const card = page.locator('li.adm-comm[data-kind="constancia"]');
    await card.getByRole('button', { name: 'Reintentar envío' }).click();
    await card.getByLabel(/Nota para la auditoría/).fill('Reintento después de revisar el rebote');
    await card.getByRole('button', { name: 'Confirmar' }).click();
    // ya no requiere intervención: sale de la vista filtrada
    await expect(page.getByText('No hay solicitudes que requieran intervención.')).toBeVisible();
    expect(messageOf(receipt.code).status).toBe('pendiente');
    expect(localSql(`select action, note, actor_id is not null as admin from public.revocation_message_events where action = 'reintento_manual'`))
      .toEqual([{ action: 'reintento_manual', note: 'Reintento después de revisar el rebote', admin: true }]);
    expect(runWorker(['--once']).status).toBe(0);
    expect(messageOf(receipt.code).status).toBe('aceptado');
    expect(localSql(`select count(*)::int as n from public.revocation_messages where kind = 'constancia'`)).toEqual([{ n: 1 }]);
    await page.goto('/admin/arrepentimientos');
    await expect(page.locator('li.adm-comm[data-kind="constancia"]')).toContainText('No confirma entrega ni lectura');
    // registrar un rebote informado por Zoho (NDR) y resolver por otro canal, ambos auditados
    const accepted = page.locator('li.adm-comm[data-kind="constancia"]');
    await accepted.getByRole('button', { name: 'Registrar rebote' }).click();
    await accepted.getByRole('button', { name: 'Confirmar' }).click();
    await expect(accepted.getByText('Rebotado', { exact: true })).toBeVisible();
    await accepted.getByRole('button', { name: 'Marcar resuelto por otro canal' }).click();
    await accepted.getByRole('button', { name: 'Confirmar' }).click();
    await expect(accepted.getByRole('alert')).toContainText('Indicá brevemente');
    await accepted.getByLabel(/Nota para la auditoría/).fill('Código comunicado por WhatsApp');
    await accepted.getByRole('button', { name: 'Confirmar' }).click();
    await expect(accepted.getByText('Resuelto por otro canal', { exact: true })).toBeVisible();
    // las intervenciones no tocan la solicitud, pagos ni stock
    expect(localSql(`select status from public.revocation_requests`)).toEqual([{ status: 'recibida' }]);
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 1000 });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      mkdirSync('artifacts/4b7', { recursive: true });
      await page.screenshot({ path: `artifacts/4b7/admin-comunicaciones-${width}.png`, fullPage: true });
    }
  } finally { await context.close(); }
});

test('recuperación privada: sin enumeración, enlace por email, un solo uso y vencimiento', async ({ page, request }) => {
  const receipt = await submit(request, 'recupera@example.test');
  await expect.poll(() => captured().length).toBe(1);
  const known = await request.post('/api/arrepentimiento/recuperar', { data: { email: 'RECUPERA@example.test', website: '' } });
  const unknown = await request.post('/api/arrepentimiento/recuperar', { data: { email: 'nadie@example.test', website: '' } });
  expect([known.status(), unknown.status()]).toEqual([202, 202]);
  expect(await known.text()).toBe(await unknown.text());
  expect(known.headers()['cache-control']).toBe('no-store');
  await expect.poll(() => captured().length).toBe(2);
  await page.waitForTimeout(500);
  expect(captured().filter(m => m.to === 'nadie@example.test')).toHaveLength(0);
  const link = captured().find(m => m.subject.includes('Acceso'))!;
  expect(link.to).toBe('recupera@example.test');
  const token = /#t=([A-Za-z0-9_-]{43})/.exec(link.text)![1];
  expect(link.text).not.toContain(receipt.code);
  // el token no es el de seguimiento de pedidos ni se guarda en claro
  expect(localSql(`select count(*)::int as n from private.revocation_access_tokens where encode(token_hash, 'escape') like '%${token.slice(0, 10)}%'`)).toEqual([{ n: 0 }]);

  await page.goto(`/arrepentimiento/recuperar#t=${token}`);
  await expect(page).toHaveURL(/\/arrepentimiento\/recuperar$/);
  const redeem = page.waitForRequest(r => r.url().endsWith('/api/arrepentimiento/constancia'));
  await page.getByRole('button', { name: 'Ver mis constancias' }).click();
  expect((await redeem).url()).not.toContain(token);
  await expect(page.locator('.legal-receipt')).toContainText(receipt.code);
  await expect(page.locator('.legal-receipt')).toContainText('Recibida');
  await expect(page.locator('.legal-receipt')).not.toContainText('COMMS-');
  await expect(page.locator('.legal-receipt')).not.toContainText('recupera@example.test');

  // Segundo uso del mismo enlace: no muestra nada.
  await page.goto('/');
  await page.goto(`/arrepentimiento/recuperar#t=${token}`);
  await page.getByRole('button', { name: 'Ver mis constancias' }).click();
  await expect(page.locator('main [role="alert"]')).toContainText('venció o ya se usó');
  await expect(page.getByText(receipt.code)).toHaveCount(0);

  // Enlace vencido.
  localSql(`update public.revocation_messages set created_at = clock_timestamp() - interval '2 hours' where kind = 'recuperacion'`);
  await request.post('/api/arrepentimiento/recuperar', { data: { email: 'recupera@example.test', website: '' } });
  await expect.poll(() => captured().filter(m => m.subject.includes('Acceso')).length).toBe(2);
  const second = /#t=([A-Za-z0-9_-]{43})/.exec(captured().filter(m => m.subject.includes('Acceso'))[1].text)![1];
  localSql(`update private.revocation_access_tokens set expires_at = clock_timestamp() - interval '1 second' where used_at is null`);
  const expired = await request.post('/api/arrepentimiento/constancia', { data: { token: second } });
  expect(expired.status()).toBe(404);
  expect(await expired.json()).toEqual({ error: 'invalid_or_expired' });

  // Validación y no enumeración.
  expect((await request.post('/api/arrepentimiento/recuperar', { data: { email: 'mal', website: '' } })).status()).toBe(422);
  expect((await request.post('/api/arrepentimiento/recuperar', { data: { email: 'a@b.co', website: 'bot' } })).status()).toBe(422);
  expect((await request.post('/api/arrepentimiento/recuperar', { data: { email: 'a@b.co', website: '' }, headers: { origin: 'https://otro.test' } })).status()).toBe(403);
  expect((await request.get('/api/arrepentimiento/recuperar')).status()).toBe(404);
  expect((await request.get('/api/arrepentimiento/constancia')).status()).toBe(404);
  const bad = await request.post('/api/arrepentimiento/constancia', { data: { token: 'x' } });
  expect(bad.status()).toBe(404);
});

test('límites antiabuso de recuperación no bloquean la presentación de un arrepentimiento', async ({ request }) => {
  const responses = [];
  for (let i = 0; i < 6; i++) responses.push((await request.post('/api/arrepentimiento/recuperar', { data: { email: `abuso${i}@example.test`, website: '' } })).status());
  expect(responses).toEqual([202, 202, 202, 202, 202, 429]);
  // la recepción de solicitudes tiene su propio límite y sigue funcionando
  const receipt = await submit(request, 'despues-del-abuso@example.test');
  expect(receipt.code).toMatch(/^ARR-/);
});

for (const width of [390, 768, 1440]) test(`recuperación responsive ${width}`, async ({ page }) => {
  await page.setViewportSize({ width, height: 1000 });
  mkdirSync('artifacts/4b7', { recursive: true });
  const response = await page.goto('/arrepentimiento/recuperar');
  expect(response?.headers()['x-robots-tag']).toContain('noindex');
  expect(response?.headers()['referrer-policy']).toBe('no-referrer');
  await expect(page.locator('main h1')).toHaveText('Recuperar constancia de arrepentimiento');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `artifacts/4b7/recuperar-${width}.png`, fullPage: true });
  await page.getByLabel('Email usado en la solicitud').fill('persona@example.test');
  await page.getByRole('button', { name: 'Enviarme un enlace privado' }).click();
  await expect(page.locator('main [role="status"]')).toContainText('Si hay solicitudes de arrepentimiento asociadas');
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: `artifacts/4b7/recuperar-enviado-${width}.png`, fullPage: true });
});

test('API de Supabase: anon y clientes no leen comunicaciones ni ejecutan el ejecutor', async ({ request }) => {
  await submit(request, 'privado@example.test');
  for (const path of ['rest/v1/revocation_messages?select=recipient', 'rest/v1/revocation_message_attempts?select=*', 'rest/v1/revocation_message_events?select=*']) {
    const r = await request.get(`${LOCAL_SUPABASE.url}/${path}`, { headers: { apikey: LOCAL_SUPABASE.publishableKey } });
    expect([401, 403]).toContain(r.status());
    expect(await r.text()).not.toContain('privado@example.test');
  }
  for (const fn of ['comunicaciones_reclamar', 'canjear_constancia_arrepentimiento', 'solicitar_recuperacion_arrepentimiento', 'estado_comunicaciones']) {
    const r = await request.post(`${LOCAL_SUPABASE.url}/rest/v1/rpc/${fn}`, { headers: { apikey: LOCAL_SUPABASE.publishableKey }, data: {} });
    expect([401, 403, 404]).toContain(r.status());
  }
});
