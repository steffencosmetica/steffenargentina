import { test } from 'node:test';
import assert from 'node:assert/strict';
import { checkoutAvailableFor } from './availability.ts';

const LOCAL = 'http://127.0.0.1:55321';
const all = { STEFFEN_CART_ENABLED: '1', NEXT_PUBLIC_SUPABASE_URL: LOCAL, STEFFEN_LEGAL_PAGES: '1', STEFFEN_REVOCATION_ENABLED: '1' };

test('checkout: solo con carrito, clave de servidor, páginas legales y arrepentimiento publicados', () => {
  assert.equal(checkoutAvailableFor(all, true), true);
  assert.equal(checkoutAvailableFor(all, false), false, 'sin clave de servidor');
  for (const key of Object.keys(all) as (keyof typeof all)[]) {
    assert.equal(checkoutAvailableFor({ ...all, [key]: undefined }, true), false, `sin ${key}`);
    assert.equal(checkoutAvailableFor({ ...all, [key]: '0' }, true), false, `${key}=0`);
  }
});

test('configuraciones de Preview y producción: nunca habilitan el checkout', () => {
  assert.equal(checkoutAvailableFor({}, false), false, 'todo apagado');
  assert.equal(checkoutAvailableFor({ ...all, VERCEL: '1' }, true), false, 'Vercel');
  assert.equal(checkoutAvailableFor({ ...all, VERCEL_ENV: 'preview' }, true), false, 'Vercel Preview');
  assert.equal(checkoutAvailableFor({ ...all, NEXT_PUBLIC_SUPABASE_URL: 'https://zzxlghpopmccwsaqbsko.supabase.co' }, true), false, 'Supabase Cloud');
  assert.equal(checkoutAvailableFor({ ...all, STEFFEN_CART_ENABLED: 'true' }, true), false, 'valor no exacto');
});
