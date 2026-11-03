// Genera una referencia de funciones desde el SQL original, sin aplicar de nuevo la migración.
// Solo usa el contenedor LOCAL. Las definiciones se compilan en una transacción con ROLLBACK.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const migration = '20261104120000_admin_pedidos.sql';
const root = resolve(import.meta.dirname, '..');
const decode = (bytes: Uint8Array) => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const sourceBytes = readFileSync(join(root, 'supabase', 'migrations', migration));
const source = decode(sourceBytes);
const declarations = [...source.matchAll(/create function (public|private)\.([a-z_]+)\([\s\S]*?\)\s*returns[\s\S]*?as \$\$([\s\S]*?)\$\$;/g)];
const names = ['private.orders_incrementar_version', 'public.admin_listar_pedidos', 'public.admin_operar_pedido'];
assert.deepEqual(declarations.map(m => `${m[1]}.${m[2]}`).sort(), names);

type FunctionReference = {
  schema: string;
  name: string;
  arguments: string;
  returns: string;
  owner: string;
  definer: boolean;
  settings: string[];
  source: string;
};

const catalog = `select jsonb_agg(jsonb_build_object(
  'schema', n.nspname, 'name', p.proname,
  'arguments', pg_get_function_identity_arguments(p.oid),
  'returns', p.prorettype::regtype::text, 'owner', pg_get_userbyid(p.proowner),
  'definer', p.prosecdef, 'settings', p.proconfig, 'source', p.prosrc
) order by n.nspname,p.proname)
from pg_proc p join pg_namespace n on n.oid=p.pronamespace
where (n.nspname,p.proname) in (
  ('private','orders_incrementar_version'),('public','admin_listar_pedidos'),('public','admin_operar_pedido')
)`;

function queryLocal(sql: string): FunctionReference[] {
  const bytes = execFileSync('docker', [
    'exec', '-i', '-e', 'PGCLIENTENCODING=UTF8', 'supabase_db_steffen-web',
    'psql', '-X', '-h', '/var/run/postgresql', '-U', 'postgres', '-d', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1',
  ], { input: Buffer.from(sql, 'utf8'), stdio: ['pipe', 'pipe', 'pipe'] });
  return JSON.parse(decode(bytes).trim()) as FunctionReference[];
}

const before = queryLocal(`begin read only; ${catalog}; rollback;`);
const functions = queryLocal(`begin;
  set local client_encoding='UTF8';
  ${declarations.map(m => m[0].replace(/^create function /, 'create or replace function ')).join('\n')}
  ${catalog};
  rollback;`);
const after = queryLocal(`begin read only; ${catalog}; rollback;`);
assert.deepEqual(after, before, 'La generación no debe dejar cambios en la base local.');

const normalize = (text: string) => text.replace(/\r\n/g, '\n').trim();
for (const declaration of declarations) {
  const compiled = functions.find(f => f.schema === declaration[1] && f.name === declaration[2]);
  assert.ok(compiled);
  assert.equal(normalize(compiled.source), normalize(declaration[3]), 'El cuerpo compilado debe conservar el UTF-8 original.');
}

const output = resolve(process.argv[2] ?? join(tmpdir(), 'steffen-admin-orders-reference-utf8.json'));
const reference = {
  migration,
  sourceSHA256: createHash('sha256').update(sourceBytes).digest('hex'),
  encoding: 'UTF-8',
  localChangesRolledBack: true,
  functions,
};
const json = JSON.stringify(reference, null, 2);
writeFileSync(output, Buffer.from(json, 'utf8'));
assert.equal(decode(readFileSync(output)), json, 'El archivo guardado debe conservar los mismos bytes UTF-8.');
console.log(`Referencia UTF-8 verificada: ${functions.length} funciones; cambios locales revertidos. Archivo: ${output}`);
