import { cartEnabledFor } from '../cart/flag.ts';
import { legalPagesEnabledFor, revocationEnabledFor } from '../legal/flag.ts';

type Env = Record<string, string | undefined>;

/**
 * ¿Pueden existir el checkout y el seguimiento de pedidos? Enclavamiento de publicación (Fase 4B.8):
 *   1. carrito habilitado (STEFFEN_CART_ENABLED=1, Supabase local, fuera de Vercel; ver cart/flag.ts);
 *   2. clave de servidor presente (crear_pedido y consultar_pedido son solo de service_role);
 *   3. páginas legales publicadas (el comprador acepta Términos y Privacidad: deben existir);
 *   4. Botón de Arrepentimiento publicado (obligatorio en toda venta a distancia).
 * Una configuración parcial nunca habilita compras. Además, la base exige store_settings.checkout_enabled.
 */
export function checkoutAvailableFor(env: Env, hasServiceKey: boolean): boolean {
  return cartEnabledFor(env) && hasServiceKey && legalPagesEnabledFor(env) && revocationEnabledFor(env);
}
