'use client';

import { useState } from 'react';
import { useCartOptional } from './CartProvider';

/**
 * «Agregar al carrito» para tarjetas y fichas. Sin carrito habilitado no renderiza nada (la página queda
 * igual que antes). Sin stock: deshabilitado. La compra real la valida la base al crear el pedido.
 */
export default function AddToCartButton({
  productId,
  productName,
  soldOut,
  variant,
}: {
  productId: string;
  productName: string;
  soldOut: boolean;
  variant: 'card' | 'primary';
}) {
  const cart = useCartOptional();
  const [busy, setBusy] = useState(false);
  if (!cart) return null;

  return (
    <button
      type="button"
      className={variant === 'card' ? 'cart-add cart-add-card' : 'cart-add store-btn'}
      disabled={soldOut || busy}
      aria-label={soldOut ? `${productName}: sin stock` : `Agregar ${productName} al carrito`}
      data-testid="add-to-cart"
      onClick={async () => {
        setBusy(true);
        try {
          await cart.add(productId, productName);
        } finally {
          setBusy(false);
        }
      }}
    >
      {variant === 'primary' && (
        <svg viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8">
          <path d="M6 7h12l-1 13H7L6 7Z" />
          <path d="M9 7V6a3 3 0 0 1 6 0v1" />
        </svg>
      )}
      {soldOut ? 'Sin stock' : 'Agregar al carrito'}
    </button>
  );
}
