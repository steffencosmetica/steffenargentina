import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HOME_PATH, loginUrl, safeNextPath } from './routes.ts';

test('safeNextPath acepta rutas internas del panel', () => {
  assert.equal(safeNextPath('/admin/categorias'), '/admin/categorias');
  assert.equal(safeNextPath('/admin/productos?q=shampoo'), '/admin/productos?q=shampoo');
  assert.equal(safeNextPath('/admin'), '/admin');
});

test('safeNextPath rechaza destinos externos o fuera del panel', () => {
  for (const next of [
    null,
    '',
    'https://malicioso.com/admin',
    '//malicioso.com/admin',
    '/\\malicioso.com',
    '/admin/../productos',
    '/administrador',
    '/',
    '/admin/login',
  ]) {
    assert.equal(safeNextPath(next), HOME_PATH, String(next));
  }
});

test('loginUrl arma el destino y el motivo', () => {
  const url = loginUrl('http://localhost:3000/admin/productos', { next: '/admin/categorias', reason: 'expirada' });
  assert.equal(url.pathname, '/admin/login');
  assert.equal(url.searchParams.get('next'), '/admin/categorias');
  assert.equal(url.searchParams.get('motivo'), 'expirada');
  assert.equal(loginUrl('http://localhost:3000', { next: 'https://malicioso.com' }).searchParams.has('next'), false);
});
