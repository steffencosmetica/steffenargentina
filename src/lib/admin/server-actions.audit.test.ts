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
// Módulos con las operaciones administrativas (cada una debe pasar por requireAdmin()).
const ADMIN_LIBS: Record<string, string> = {
  '@/lib/orders/after-sales': join(ROOT, 'src', 'lib', 'orders', 'after-sales.ts'),
  '@/lib/orders/admin': join(ROOT, 'src', 'lib', 'orders', 'admin.ts'),
  '@/lib/catalog/admin': join(ROOT, 'src', 'lib', 'catalog', 'admin.ts'),
  '@/lib/shipping/admin': join(ROOT, 'src', 'lib', 'shipping', 'admin.ts'),
};

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

/** Funciones de un módulo administrativo que verifican requireAdmin(), directamente o a través de otra función local. */
function guardedAdminFunctions(file: string) {
  const source = parse(file);
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

for (const [module, file] of Object.entries(ADMIN_LIBS)) {
  test(`en ${module}, toda función exportada que usa la base o la cotización verifica requireAdmin()`, () => {
    const { guarded, exported, source } = guardedAdminFunctions(file);
    const usesDb = (name: string) => {
      const fn = source.statements.find((s): s is ts.FunctionDeclaration => ts.isFunctionDeclaration(s) && s.name?.text === name);
      return Boolean(fn?.body && /\bsupabase\b|updateProductFields|setPrimaryProductImage|quoteShipping/.test(fn.body.getText()));
    };
    for (const name of exported) {
      if (usesDb(name)) assert.ok(guarded.has(name), `${module}: ${name} usa la base sin requireAdmin()`);
    }
    // el único lugar que crea el cliente con sesión es requireAdmin (en @/lib/catalog/admin)
    const sessionClients = source.getText().match(/createSessionClient\(\)/g)?.length ?? 0;
    assert.equal(sessionClients, module === '@/lib/catalog/admin' ? 1 : 0, 'createSessionClient() solo dentro de requireAdmin');
  });
}

test('todos los Server Actions administrativos pasan por requireAdmin()', () => {
  const guardedByModule = new Map(Object.entries(ADMIN_LIBS).map(([module, file]) => [module, guardedAdminFunctions(file).guarded]));
  const files = serverActionFiles();
  assert.ok(files.length >= 3, 'se encontraron los archivos de Server Actions');

  const checked: string[] = [];
  for (const file of files) {
    const source = parse(file);
    const text = source.getText();

    // nombres importados de los módulos administrativos: alias local -> [módulo, nombre original]
    const fromAdmin = new Map<string, [string, string]>();
    for (const stmt of source.statements) {
      const module = ts.isImportDeclaration(stmt) ? (stmt.moduleSpecifier as ts.StringLiteral).text : '';
      if (ts.isImportDeclaration(stmt) && guardedByModule.has(module)) {
        const named = stmt.importClause?.namedBindings;
        if (named && ts.isNamedImports(named)) {
          for (const el of named.elements) fromAdmin.set(el.name.text, [module, (el.propertyName ?? el.name).text]);
        }
      }
    }

    for (const stmt of source.statements) {
      if (!ts.isFunctionDeclaration(stmt) || !stmt.name || !stmt.body || !isExported(stmt)) continue;
      const name = stmt.name.text;
      if (PUBLIC_ACTIONS.has(name)) continue;
      const called = [...calls(stmt.body)];
      const ok = called.some((c) => {
        if (c === 'requireAdmin') return true;
        const imported = fromAdmin.get(c);
        return Boolean(imported && guardedByModule.get(imported[0])!.has(imported[1]));
      });
      assert.ok(ok, ` () no llama a requireAdmin() ni a una operación protegida de un módulo administrativo`);
      checked.push(name);
    }

    // las acciones administrativas no pueden crear su propio cliente de Supabase (saltearían requireAdmin)
    if (!file.endsWith('auth-actions.ts')) {
      assert.doesNotMatch(text, /@\/lib\/supabase\/(server|public|browser)/, `${file} importa un cliente de Supabase directamente`);
      assert.doesNotMatch(text, /createSessionClient|createClient|createServerClient/, `${file} crea un cliente de Supabase`);
    }
  }
  assert.ok(checked.length >= 21, `se auditaron ${checked.length} acciones`);
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
