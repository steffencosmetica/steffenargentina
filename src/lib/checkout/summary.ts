// Resumen del checkout: carrito cotizado + envío + total. Lo arma SIEMPRE el servidor con datos actuales
// (public.cotizar_carrito y public.cotizar_envio); el navegador solo lo muestra y devuelve el total que vio
// para que crear_pedido() lo compare con el vigente.

import type { Centavos } from '../money.ts';
import type { CartQuote } from '../cart/types.ts';

export type ShippingSummary =
  | { status: 'pending' } // todavía no se eligió la provincia
  | { status: 'no_coverage' }
  | { status: 'ok'; zoneName: string; costCentavos: Centavos; isFree: boolean; freeFromCentavos: Centavos | null };

export type CheckoutSummary = {
  quote: CartQuote;
  shipping: ShippingSummary;
  /** null mientras no se pueda confirmar (falta provincia, sin cobertura o artículos con problemas) */
  totalCentavos: Centavos | null;
};

/** ¿Se puede confirmar con este resumen? (la base lo vuelve a verificar todo) */
export function canConfirm(summary: CheckoutSummary | null): boolean {
  return !!summary && summary.quote.checkoutEnabled && summary.quote.canCheckout && summary.shipping.status === 'ok' && summary.totalCentavos !== null;
}

/** Motivo por el que no se puede confirmar todavía (para mostrarlo junto al botón), o null. */
export function blockedReason(summary: CheckoutSummary | null): string | null {
  if (!summary) return null;
  if (!summary.quote.checkoutEnabled) return 'Las compras online todavía no están habilitadas. Tu carrito queda guardado.';
  if (!summary.quote.canCheckout) {
    return summary.quote.exceedsOrderLimit
      ? `Superaste el máximo de ${summary.quote.limits.maxUnitsPerOrder} unidades por compra. Ajustá las cantidades en el carrito.`
      : 'Hay productos del carrito que no se pueden comprar. Revisalos en el carrito.';
  }
  if (summary.shipping.status === 'pending') return 'Elegí la provincia para calcular el envío.';
  if (summary.shipping.status === 'no_coverage') return 'Todavía no hacemos envíos a esa provincia.';
  return null;
}
