import 'server-only';
import { createPublicClient } from '@/lib/supabase/public';
import { CATALOGO_BUCKET } from '@/lib/supabase/env';
import { cartEnabledFor } from './flag';
import { parseQuoteResponse } from './quote';
import type { CartItem, CartQuote } from './types';

// Carrito del lado del servidor.

/** ¿Se muestra el carrito? Ver las condiciones en flag.ts. */
export function isCartEnabled(): boolean {
  return cartEnabledFor(process.env);
}

/**
 * Cotiza el carrito con datos actuales: cliente público (clave publicable, sin service_role) y sin caché
 * de Next, así un cambio de precio o de stock se ve en la próxima cotización.
 */
export async function quoteCart(items: CartItem[]): Promise<CartQuote> {
  const client = createPublicClient({ cache: false });
  const { data, error } = await client.rpc('cotizar_carrito', {
    p_items: items.map((i) => ({ product_id: i.productId, quantity: i.quantity })),
  });
  if (error) throw error;
  return parseQuoteResponse(data as never, (path) => client.storage.from(CATALOGO_BUCKET).getPublicUrl(path).data.publicUrl);
}
