import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { isCheckoutAvailable } from '@/lib/checkout/server';
import { isOrderCode } from '@/lib/checkout/order-view';
import StoreHeading from '@/components/tienda/StoreHeading';
import OrderStatus from '@/components/checkout/OrderStatus';

// /pedido/[codigo] — seguimiento privado. El servidor NO consulta nada acá: la página es la misma para
// cualquier código (no revela si un pedido existe). El navegador lee el token del fragmento (#t=…, que
// nunca viaja al servidor) o de sessionStorage y lo envía por POST a /api/pedido/consultar.
// Cabeceras (no-store, no-referrer, noindex): next.config.ts.

export const metadata: Metadata = {
  title: 'Estado del pedido',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

type Props = { params: Promise<{ codigo: string }> };

export default async function PedidoPage({ params }: Props) {
  await connection();
  if (!isCheckoutAvailable()) notFound();
  const { codigo } = await params;
  const code = decodeURIComponent(codigo).toUpperCase();

  return (
    <main className="store ck ck-order-page" id="contenido">
      <StoreHeading kicker="Seguimiento" title="TU PEDIDO" as="h1" />
      {/* un código mal formado se trata igual que uno inexistente, sin consultar */}
      <OrderStatus code={isOrderCode(code) ? code : null} />
    </main>
  );
}
