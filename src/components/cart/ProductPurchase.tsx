'use client';

import WhatsAppConsult from '@/components/tienda/WhatsAppConsult';
import AddToCartButton from './AddToCartButton';
import { useCartOptional } from './CartProvider';

/**
 * Acción de compra de la ficha. Con carrito: «Agregar al carrito» (principal) y WhatsApp como alternativa.
 * Sin carrito habilitado: la consulta por WhatsApp de siempre.
 */
export default function ProductPurchase({ productId, productName, soldOut }: { productId: string; productName: string; soldOut: boolean }) {
  const cart = useCartOptional();
  if (!cart) return <WhatsAppConsult productName={productName} />;
  return (
    <>
      <AddToCartButton productId={productId} productName={productName} soldOut={soldOut} variant="primary" />
      <WhatsAppConsult productName={productName} secondary />
    </>
  );
}
