// Tipos del carrito, compartidos por el navegador y el servidor (sin dependencias de ninguno).
// El carrito del navegador guarda SOLO producto y cantidad: precios, estado y límites siempre vienen
// de una cotización del servidor (public.cotizar_carrito), nunca de lo guardado.

import type { Centavos } from '../money.ts';

export type CartItem = { productId: string; quantity: number };

/** Límites públicos de store_settings (los define el administrador; la base los vuelve a validar al crear el pedido). */
export type CartLimits = { maxUnitsPerProduct: number; maxUnitsPerOrder: number };

export type QuoteLineStatus = 'ok' | 'unavailable' | 'out_of_stock' | 'exceeds_limit' | 'exceeds_stock';

export type QuoteLine = {
  productId: string;
  status: QuoteLineStatus;
  /** cantidad pedida en la cotización */
  quantity: number;
  /** null si el producto ya no existe */
  name: string | null;
  slug: string | null;
  priceCentavos: Centavos | null;
  imageUrl: string | null;
  /** máximo comprable acotado por el límite por producto (nunca el stock exacto) */
  maxQuantity: number;
  lineTotalCentavos: Centavos | null;
};

export type CartQuote = {
  checkoutEnabled: boolean;
  limits: CartLimits;
  lines: QuoteLine[];
  /** unidades de los artículos que se pueden comprar */
  units: number;
  subtotalCentavos: Centavos;
  exceedsOrderLimit: boolean;
  canCheckout: boolean;
};

/** Validación técnica de una solicitud (igual que public.cotizar_carrito). No son límites comerciales. */
export const MAX_CART_LINES = 50;
export const MAX_LINE_QUANTITY = 9999;

/**
 * Página de checkout (Fase 4B.5). El servidor indica si existe en este despliegue (CartProvider →
 * checkoutAvailable, ver src/lib/checkout/server.ts): si no, «Finalizar compra» queda deshabilitado.
 * Comprar además exige checkout_enabled en la base.
 */
export const CHECKOUT_PATH = '/checkout';
