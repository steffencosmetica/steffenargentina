import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOME_PATH, loginPath, loginUrl, safeNextPath } from './routes.ts';

const UUID = '368333c6-3a18-4edb-8cf7-0fee1812d2ed';

test('safeNextPath acepta las pantallas existentes del panel', () => {
  for (const path of [
    '/admin',
    '/admin/productos',
    '/admin/productos/nuevo',
    `/admin/productos/${UUID}`,
    '/admin/categorias',
    '/admin/categorias/nueva',
    `/admin/categorias/${UUID}`,
  ]) {
    assert.equal(safeNextPath(path), path, path);
  }
});

test('safeNextPath conserva solo los filtros del listado de productos', () => {
  assert.equal(safeNextPath('/admin/productos?q=shampoo&estado=activos'), '/admin/productos?q=shampoo&estado=activos');
  assert.equal(safeNextPath('/admin/productos?q=x&creado=1&next=https://malicioso.com'), '/admin/productos?q=x');
  assert.equal(safeNextPath(`/admin/productos/${UUID}?creado=1`), `/admin/productos/${UUID}`);
  assert.equal(safeNextPath('/admin/productos?q=' + 'a'.repeat(200)).length, HOME_PATH.length + 3 + 80);
});

test('regresión: variantes del login nunca son destino', () => {
  for (const next of [
    '/admin/login',
    '/admin/login.',
    '/admin/login/',
    '/admin/login?next=/admin/categorias',
    '/admin/login%2e',
    '/admin/LOGIN',
    '/admin/login..',
    '/admin/./login',
  ]) {
    assert.equal(safeNextPath(next), HOME_PATH, next);
  }
});

test('regresión: rutas inexistentes o mal formadas del panel van al inicio', () => {
  for (const next of [
    '/admin/',
    '/admin/productos/',
    '/admin/productos.',
    '/admin/productos/no-es-uuid',
    '/admin/productos/nuevo/extra',
    '/admin/categorias/../../afuera',
    '/admin/xyz',
    '/administrador',
    '/admin%2fproductos',
    `/admin/productos/${UUID}/x`,
  ]) {
    assert.equal(safeNextPath(next), HOME_PATH, next);
  }
});

test('regresión: destinos fuera del panel o externos van al inicio', () => {
  for (const next of [
    null,
    undefined,
    '',
    '/',
    '/productos',
    '/shampoos',
    'admin/productos',
    'https://malicioso.com/admin',
    'http://panel.local/admin/productos',
    '//malicioso.com/admin',
    '/\\malicioso.com',
    '/admin\\productos',
    '/admin/../productos',
    '/admin/%2e%2e/productos',
    'javascript:alert(1)',
    '/admin/productos\n',
    ' /admin/productos',
    '/admin/productos?' + 'x'.repeat(600),
  ]) {
    assert.equal(safeNextPath(next), HOME_PATH, JSON.stringify(next));
  }
});

test('loginUrl solo propaga destinos válidos', () => {
  const url = loginUrl('http://localhost:3000/admin/productos', { next: '/admin/categorias', reason: 'expirada' });
  assert.equal(url.pathname, '/admin/login');
  assert.equal(url.searchParams.get('next'), '/admin/categorias');
  assert.equal(url.searchParams.get('motivo'), 'expirada');
  assert.equal(loginUrl('http://localhost:3000', { next: 'https://malicioso.com' }).searchParams.has('next'), false);
  assert.equal(loginUrl('http://localhost:3000', { next: '/admin/login.' }).searchParams.has('next'), false);
  assert.equal(loginPath({ next: '/admin/xyz', reason: 'sin-permiso' }), '/admin/login?motivo=sin-permiso');
});
