// Auditoría estática: ningún secreto puede terminar en el navegador.
//   * Ninguna variable de entorno con SECRET / SERVICE_ROLE puede ser NEXT_PUBLIC_ (Next la incrustaría en el bundle).
//   * Ningún componente de cliente ('use client') lee variables secretas ni importa módulos de servidor de pedidos.
//   * .env.example no trae claves reales.
// El build de producción se revisa además buscando las claves locales en .next/static (ver supabase/docs/pedidos.md).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const SRC = join(ROOT, 'src');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.ts$/.test(name) ? [path] : [];
  });
}

const sources = files(SRC).map((path) => ({ path: relative(ROOT, path), text: readFileSync(path, 'utf8') }));
const SECRET_NAME = /(SECRET|SERVICE_ROLE|PRIVATE|TURNSTILE_SECRET|PASSWORD|TOKEN|SMTP|MAIL_)/;

test('ninguna variable secreta es NEXT_PUBLIC_', () => {
  for (const { path, text } of sources) {
    for (const [, name] of text.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      assert.ok(!(name.startsWith('NEXT_PUBLIC_') && SECRET_NAME.test(name)), `${path}: ${name}`);
    }
  }
});

test('los componentes de cliente no leen secretos ni importan módulos de servidor de pedidos', () => {
  const client = sources.filter(({ text }) => /^\s*['"]use client['"]/m.test(text));
  assert.ok(client.length > 0, 'hay componentes de cliente para auditar');
  for (const { path, text } of client) {
    for (const [, name] of text.matchAll(/process\.env\.([A-Z0-9_]+)/g)) {
      assert.ok(name.startsWith('NEXT_PUBLIC_'), `${path} lee ${name} en el navegador`);
    }
    assert.doesNotMatch(
      text,
      /from ['"](@\/lib\/orders\/client-ip|@\/lib\/supabase\/admin|@\/lib\/checkout\/server|@\/lib\/cart\/server|@\/lib\/http\/json-api)['"]|from ['"]node:/,
      `${path} importa código de servidor`,
    );
    assert.doesNotMatch(text, /sb_secret_|service_role/i, `${path} menciona una clave de servidor`);
  }
});

test('la clave secreta de Supabase solo se lee en el módulo server-only que crea el cliente de servidor', () => {
  const readers = sources.filter(({ text }) => /process\.env\.SUPABASE_SECRET_KEY/.test(text)).map(({ path }) => path.replace(/\\/g, '/'));
  assert.deepEqual(readers, ['src/lib/supabase/admin.ts']);
  const admin = sources.find(({ path }) => path.replace(/\\/g, '/') === 'src/lib/supabase/admin.ts');
  assert.match(admin!.text, /^import 'server-only';/m);
});

test('.env.example no contiene claves reales', () => {
  const example = readFileSync(join(ROOT, '.env.example'), 'utf8');
  assert.doesNotMatch(example, /sb_secret_[A-Za-z0-9_-]{10,}/);
  assert.doesNotMatch(example, /eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/, 'sin JWT');
});

test('el código del repositorio no tiene claves de Supabase escritas', () => {
  for (const { path, text } of sources) {
    assert.doesNotMatch(text, /sb_secret_[A-Za-z0-9_-]{10,}/, path);
    assert.doesNotMatch(text, /eyJhbGciOi[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/, path);
  }
});

const norm = (path: string) => path.split('\\').join('/');

test('la contraseña SMTP y el token del monitor solo se leen en módulos de servidor', () => {
  const smtp = sources.filter(({ text }) => /MAIL_SMTP_PASSWORD/.test(text)).map(({ path }) => norm(path));
  assert.deepEqual(smtp, ['src/lib/mail/config.ts']);
  const health = sources.filter(({ text }) => /process\.env\.MAIL_HEALTH_TOKEN/.test(text)).map(({ path }) => norm(path));
  assert.deepEqual(health, ['src/app/api/interno/comunicaciones/route.ts']);
  for (const { path, text } of sources.filter(({ text }) => /^\s*['"]use client['"]/m.test(text))) {
    assert.doesNotMatch(text, /MAIL_|SMTP|nodemailer|@\/lib\/mail\/|@\/lib\/legal\/api|STEFFEN_PROXY|orders\/client-ip/, path);
  }
});

test('.env.example no trae contraseñas de correo ni tokens', () => {
  const example = readFileSync(join(ROOT, '.env.example'), 'utf8');
  for (const name of ['MAIL_SMTP_PASSWORD', 'MAIL_HEALTH_TOKEN', 'STEFFEN_PROXY_SECRET', 'STEFFEN_PROXY_DIAGNOSTIC_TOKEN']) {
    const line = example.split(/\r?\n/).find((l) => l.replace(/^#\s*/, '').startsWith(`${name}=`));
    assert.ok(line, `${name} documentada`);
    assert.match(line!.replace(/^#\s*/, ''), new RegExp(`^${name}=$`), `${name} sin valor`);
  }
});
