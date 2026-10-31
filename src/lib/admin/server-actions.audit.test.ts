// Auditoría estática de los Server Actions del panel.
// Cada función exportada de un archivo 'use server' es un endpoint HTTP público: cualquiera que
// conozca su id puede invocarla. Este test falla si alguna operación administrativa no pasa por
// requireAdmin(), directamente o a través de @/lib/catalog/admin.
// Analiza el código con el compilador de TypeScript, así que cubre también los archivos que se agreguen.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import ts from 'typescript';

const ROOT = join(import.meta.dirname, '..', '..', '..');
const ADMIN_LIB = join(ROOT, 'src', 'lib', 'catalog', 'admin.ts');

// Acciones públicas a propósito: el login (todavía no hay sesión) y el logout (solo cierra la propia)
const PUBLIC_ACTIONS = new Set(['loginAction', 'logoutAction']);

function parse(file: string) {
  return ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
}

/** Nombres de las funciones llamadas dentro de un nodo. */
function calls(node: ts.Node) {
  const names = new Set<string>();
  const visit = (n: ts.Node) => {
    if (ts.isCallExpression(n) && ts.isIdentifier(n.expression)) names.add(n.expression.text);
    ts.forEachChild(n, visit);
  };
  visit(node);
  return names;
}

function isExported(node: ts.Node) {
  return ts.canHaveModifiers(node) && (ts.getModifiers(node) ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
}

/** Funciones de admin.ts que verifican requireAdmin(), directamente o a través de otra función local. */
function guardedAdminFunctions() {
  const source = parse(ADMIN_LIB);
  const bodies = new Map<string, ts.Node>();
  const exported = new Set<string>();
  for (const stmt of source.statements) {
    if (ts.isFunctionDeclaration(stmt) && stmt.name && stmt.body) {
      bodies.set(stmt.name.text, stmt.body);
      if (isExported(stmt)) exported.add(stmt.name.text);
    }
  }
  const guarded = new Set<string>();
  // punto fijo: una función está protegida si llama a requireAdmin o a otra función protegida
  let changed = true;
  while (changed) {
    changed = false;
    for (const [name, body] of bodies) {
      if (guarded.has(name)) continue;
      const called = calls(body);
      if (called.has('requireAdmin') || [...called].some((c) => guarded.has(c))) {
        guarded.add(name);
        changed = true;
      }
    }
  }
  return { guarded, exported, source };
}

function serverActionFiles() {
  const dir = join(ROOT, 'src');
  return (readdirSync(dir, { recursive: true }) as string[])
    .filter((f) => /\.tsx?$/.test(f))
    .map((f) => join(dir, f))
    .filter((f) => /^\s*['"]use server['"]/.test(readFileSync(f, 'utf8')));
}

test('en admin.ts, toda función exportada que usa la base verifica requireAdmin()', () => {
  const { guarded, exported, source } = guardedAdminFunctions();
  const usesDb = (name: string) => {
    const fn = source.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === name);
    return Boolean(fn?.body && /\bsupabase\b|updateProductFields|setPrimaryProductImage/.test(fn.body.getText()));
  };
  for (const name of exported) {
    if (usesDb(name)) assert.ok(guarded.has(name), `${name} usa la base sin requireAdmin()`);
  }
  // el único lugar que crea el cliente con sesión es requireAdmin
  assert.equal(source.getText().match(/createSessionClient\(\)/g)?.length, 1, 'createSessionClient() solo dentro de requireAdmin');
});

test('todos los Server Actions administrativos pasan por requireAdmin()', () => {
  const { guarded } = guardedAdminFunctions();
  const files = serverActionFiles();
  assert.ok(files.length >= 3, 'se encontraron los archivos de Server Actions');

  const checked: string[] = [];
  for (const file of files) {
    const source = parse(file);
    const text = source.getText();

    // nombres importados de @/lib/catalog/admin (y su alias local)
    const fromAdmin = new Map<string, string>();
    for (const stmt of source.statements) {
      if (ts.isImportDeclaration(stmt) && (stmt.moduleSpecifier as ts.StringLiteral).text === '@/lib/catalog/admin') {
        const named = stmt.importClause?.namedBindings;
        if (named && ts.isNamedImports(named)) {
          for (const el of named.elements) fromAdmin.set(el.name.text, (el.propertyName ?? el.name).text);
        }
      }
    }

    for (const stmt of source.statements) {
      if (!ts.isFunctionDeclaration(stmt) || !stmt.name || !stmt.body || !isExported(stmt)) continue;
      const name = stmt.name.text;
      if (PUBLIC_ACTIONS.has(name)) continue;
      const called = [...calls(stmt.body)];
      const ok = called.some((c) => c === 'requireAdmin' || (fromAdmin.has(c) && guarded.has(fromAdmin.get(c)!)));
      assert.ok(ok, `${name} (${file}) no llama a requireAdmin() ni a una operación protegida de @/lib/catalog/admin`);
      checked.push(name);
    }

    // las acciones administrativas no pueden crear su propio cliente de Supabase (saltearían requireAdmin)
    if (!file.endsWith('auth-actions.ts')) {
      assert.doesNotMatch(text, /@\/lib\/supabase\/(server|public|browser)/, `${file} importa un cliente de Supabase directamente`);
      assert.doesNotMatch(text, /createSessionClient|createClient|createServerClient/, `${file} crea un cliente de Supabase`);
    }
  }
  assert.ok(checked.length >= 16, `se auditaron ${checked.length} acciones`);
});

test('las acciones públicas son solo login y logout', () => {
  const files = serverActionFiles().filter((f) => f.endsWith('auth-actions.ts'));
  assert.equal(files.length, 1);
  const exported = parse(files[0]).statements
    .filter((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && isExported(s))
    .map((s) => s.name!.text)
    .sort();
  assert.deepEqual(exported, ['loginAction', 'logoutAction']);
});
