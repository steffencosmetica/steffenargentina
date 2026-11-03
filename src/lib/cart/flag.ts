// Interruptor del carrito (Fase 4B.4). Lo decide el SERVIDOR con variables que no llegan al navegador:
// no hay ninguna variable NEXT_PUBLIC_ que lo active. Hasta que se apruebe su publicación, el carrito
// solo puede verse con las tres condiciones juntas:
//   1. STEFFEN_CART_ENABLED=1 (variable de servidor, sin prefijo NEXT_PUBLIC_);
//   2. Supabase LOCAL (127.0.0.1 / localhost): un build conectado a Cloud nunca lo muestra;
//   3. fuera de Vercel (ni Preview ni Production).
// Aunque se viera, no crea pedidos: la base mantiene checkout_enabled = false y crear_pedido() lo valida.

type Env = Record<string, string | undefined>;

export function cartEnabledFor(env: Env): boolean {
  if (env.STEFFEN_CART_ENABLED !== '1') return false;
  if (env.VERCEL || env.VERCEL_ENV) return false;
  try {
    const host = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname;
    return host === '127.0.0.1' || host === 'localhost';
  } catch {
    return false;
  }
}
