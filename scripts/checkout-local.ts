// Habilita o deshabilita temporalmente las compras en Supabase LOCAL, para probar el checkout a mano.
//
//   npm run checkout:local -- estado
//   npm run checkout:local -- activar --confirmo=local:127.0.0.1:55322
//   npm run checkout:local -- desactivar
//
// Salvaguardas:
//   - la base es SIEMPRE la local de supabase/config.toml (127.0.0.1:55322): no lee variables de entorno ni
//     el proyecto vinculado, así que no hay forma de apuntarlo a Cloud;
//   - localSql() se niega a ejecutar contra cualquier host que no sea 127.0.0.1 / localhost;
//   - activar exige escribir la confirmación exacta del destino (--confirmo=local:<host>:<puerto>);
//   - comprueba que el stack local esté levantado antes de tocar nada.
// Para ver el carrito y el checkout además hace falta el build local con STEFFEN_CART_ENABLED=1 y
// SUPABASE_SECRET_KEY de la base local (ver supabase/docs/checkout.md).

import { LOCAL_SUPABASE, localCheckoutConfirmation, localCheckoutEnabled, setLocalCheckout } from '../e2e/local.ts';

const [action, ...flags] = process.argv.slice(2);
const expected = localCheckoutConfirmation();

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

// verifica que el stack local responde (lanza si no está levantado)
void LOCAL_SUPABASE.publishableKey;

switch (action) {
  case 'estado':
    console.log(`Checkout en ${expected}: ${localCheckoutEnabled() ? 'HABILITADO' : 'deshabilitado'}`);
    break;
  case 'activar': {
    const confirm = flags.find((f) => f.startsWith('--confirmo='))?.slice('--confirmo='.length);
    if (confirm !== expected) {
      fail(`Para habilitar las compras en la base local escribí exactamente:\n  npm run checkout:local -- activar --confirmo=${expected}`);
    }
    setLocalCheckout(true);
    console.log(`Checkout HABILITADO solo en ${expected}. Deshacer: npm run checkout:local -- desactivar`);
    break;
  }
  case 'desactivar':
    setLocalCheckout(false);
    console.log(`Checkout deshabilitado en ${expected}.`);
    break;
  default:
    fail('Uso: npm run checkout:local -- estado | activar --confirmo=<destino> | desactivar');
}
