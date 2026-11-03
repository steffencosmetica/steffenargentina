// Operaciones del carrito con sus límites. Son una ayuda para el comprador: la validación definitiva la
// hace PostgreSQL al crear el pedido. Los límites vienen del servidor (store_settings), no de constantes.

import type { CartItem, CartLimits } from './types.ts';

export type LimitReason = 'product_limit' | 'stock_limit' | 'order_limit';

export type CartChange = {
  items: CartItem[];
  /** cantidad final de la línea afectada */
  quantity: number;
  /** unidades efectivamente agregadas (puede ser menos de lo pedido) */
  added: number;
  /** por qué no se pudo llegar a lo pedido, si fue el caso */
  limitedBy?: LimitReason;
};

export function totalUnits(items: CartItem[]): number {
  return items.reduce((sum, i) => sum + i.quantity, 0);
}

export function quantityOf(items: CartItem[], productId: string): number {
  return items.find((i) => i.productId === productId)?.quantity ?? 0;
}

/**
 * Tope de una línea: el límite por producto y, si se conoce, el máximo comprable que informó la
 * última cotización (que ya viene acotado por ese límite y nunca revela el stock exacto).
 */
function lineCap(limits: CartLimits, maxQuantity: number | undefined) {
  const byStock = maxQuantity === undefined ? Number.POSITIVE_INFINITY : maxQuantity;
  return {
    cap: Math.min(limits.maxUnitsPerProduct, byStock),
    reason: (byStock < limits.maxUnitsPerProduct ? 'stock_limit' : 'product_limit') as LimitReason,
  };
}

function withQuantity(items: CartItem[], productId: string, quantity: number): CartItem[] {
  if (quantity <= 0) return items.filter((i) => i.productId !== productId);
  return items.some((i) => i.productId === productId)
    ? items.map((i) => (i.productId === productId ? { ...i, quantity } : i))
    : [...items, { productId, quantity }];
}

/** Lleva una línea a `desired` unidades respetando los límites (lo que no entra se informa). */
export function setLineQuantity(
  items: CartItem[],
  productId: string,
  desired: number,
  limits: CartLimits,
  maxQuantity?: number,
): CartChange {
  const current = quantityOf(items, productId);
  const target = Math.max(0, Math.floor(desired));
  const { cap, reason } = lineCap(limits, maxQuantity);
  const room = limits.maxUnitsPerOrder - (totalUnits(items) - current);

  let quantity = target;
  let limitedBy: LimitReason | undefined;
  if (quantity > cap) {
    quantity = cap;
    limitedBy = reason;
  }
  if (quantity > room) {
    quantity = Math.max(room, 0);
    limitedBy = 'order_limit';
  }
  // bajar nunca está limitado (aunque el carrito ya supere un límite que se redujo)
  if (target < current) {
    quantity = target;
    limitedBy = undefined;
  }
  quantity = Math.max(quantity, 0);
  return { items: withQuantity(items, productId, quantity), quantity, added: Math.max(quantity - current, 0), limitedBy };
}

/** Suma unidades a una línea (botón «Agregar al carrito» o «+»). */
export function addToCart(
  items: CartItem[],
  productId: string,
  amount: number,
  limits: CartLimits,
  maxQuantity?: number,
): CartChange {
  const current = quantityOf(items, productId);
  const change = setLineQuantity(items, productId, current + amount, limits, maxQuantity);
  // si no entró nada, la línea queda como estaba (no se agrega una línea en 0)
  return change.added === 0 && current === 0 ? { ...change, items, quantity: 0 } : change;
}

export function removeFromCart(items: CartItem[], productId: string): CartItem[] {
  return items.filter((i) => i.productId !== productId);
}

/** Mensaje para el comprador cuando un límite impidió agregar lo pedido. */
export function limitMessage(reason: LimitReason, limits: CartLimits, maxQuantity?: number): string {
  switch (reason) {
    case 'product_limit':
      return `Podés agregar hasta ${limits.maxUnitsPerProduct} ${limits.maxUnitsPerProduct === 1 ? 'unidad' : 'unidades'} de este producto.`;
    case 'stock_limit':
      return maxQuantity && maxQuantity > 0
        ? `No hay más unidades disponibles de este producto para agregar.`
        : 'Este producto no tiene stock disponible.';
    case 'order_limit':
      return `Tu carrito puede tener hasta ${limits.maxUnitsPerOrder} unidades en total.`;
  }
}
