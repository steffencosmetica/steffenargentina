'use client';

import { useCartOptional } from './CartProvider';

/** Ícono del carrito con contador para el header. Sin carrito habilitado no renderiza nada. */
export default function CartButton({ variant, onOpen }: { variant: 'desktop' | 'bar'; onOpen?: () => void }) {
  const cart = useCartOptional();
  if (!cart) return null;
  // el contador aparece recién después de leer localStorage (el HTML del servidor no lo conoce)
  const units = cart.hydrated ? cart.units : 0;
  const label = cart.hydrated && units > 0 ? `Abrir carrito, ${units} ${units === 1 ? 'unidad' : 'unidades'}` : 'Abrir carrito';
  return (
    <button
      type="button"
      className={`cart-toggle cart-toggle-${variant}`}
      aria-label={label}
      aria-haspopup="dialog"
      aria-expanded={cart.isOpen}
      aria-controls="cart-drawer"
      data-testid="cart-button"
      onClick={(e) => {
        onOpen?.();
        cart.open(e.currentTarget);
      }}
    >
      <svg viewBox="0 0 24 24" aria-hidden="true">
        <path d="M6 7h12l-1 13H7L6 7Z" />
        <path d="M9 7V6a3 3 0 0 1 6 0v1" />
      </svg>
      {units > 0 && (
        <span className="cart-count" data-testid="cart-count" aria-hidden="true">
          {units}
        </span>
      )}
    </button>
  );
}
