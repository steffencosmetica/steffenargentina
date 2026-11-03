// Reconciliación del carrito con una cotización nueva: ajusta cantidades que ya no se pueden comprar y
// arma los avisos de cambios (precio, disponibilidad). Los precios anteriores solo se recuerdan en
// memoria para detectar diferencias; nunca son la fuente de un importe.

import { formatArs, type Centavos } from '../money.ts';
import type { CartItem, CartQuote, QuoteLineStatus } from './types.ts';

export type Snapshot = Map<string, { price: Centavos | null; status: QuoteLineStatus }>;

export type Reconciled = {
  items: CartItem[];
  notices: string[];
  snapshot: Snapshot;
  /** true si se ajustó alguna cantidad (hay que volver a cotizar) */
  adjusted: boolean;
};

const label = (name: string | null) => name ?? 'Un producto';

export function reconcile(items: CartItem[], quote: CartQuote, previous: Snapshot): Reconciled {
  const notices: string[] = [];
  const snapshot: Snapshot = new Map();
  let adjusted = false;
  const byId = new Map(quote.lines.map((l) => [l.productId, l]));

  const next = items.map((item) => {
    const line = byId.get(item.productId);
    // la cotización corresponde a otra versión del carrito: se deja la línea como está
    if (!line || line.quantity !== item.quantity) return item;
    const before = previous.get(item.productId);
    snapshot.set(item.productId, { price: line.priceCentavos, status: line.status });

    if (before && before.price !== null && line.priceCentavos !== null && before.price !== line.priceCentavos) {
      notices.push(`El precio de ${label(line.name)} cambió de ${formatArs(before.price)} a ${formatArs(line.priceCentavos)}.`);
    }

    switch (line.status) {
      case 'unavailable':
        if (before?.status !== 'unavailable') notices.push(`${label(line.name)} ya no está disponible. Podés quitarlo del carrito.`);
        return item;
      case 'out_of_stock':
        if (before?.status !== 'out_of_stock') notices.push(`${label(line.name)} se quedó sin stock. Podés quitarlo del carrito.`);
        return item;
      case 'exceeds_limit':
      case 'exceeds_stock':
        if (line.maxQuantity > 0) {
          adjusted = true;
          notices.push(
            line.status === 'exceeds_limit'
              ? `Ajustamos ${label(line.name)} a ${line.maxQuantity} ${line.maxQuantity === 1 ? 'unidad' : 'unidades'}: es el máximo por producto.`
              : `Ajustamos ${label(line.name)} a ${line.maxQuantity} ${line.maxQuantity === 1 ? 'unidad' : 'unidades'}: no hay más disponibles.`,
          );
          return { ...item, quantity: line.maxQuantity };
        }
        return item;
      default:
        return item;
    }
  });

  if (quote.exceedsOrderLimit) {
    notices.push(`Tu carrito supera el máximo de ${quote.limits.maxUnitsPerOrder} unidades. Reducí alguna cantidad para continuar.`);
  }
  return { items: next, notices, snapshot, adjusted };
}
