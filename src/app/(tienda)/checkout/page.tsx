import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { connection } from 'next/server';
import { isCheckoutAvailable, listProvinces } from '@/lib/checkout/server';
import StoreHeading from '@/components/tienda/StoreHeading';
import CheckoutForm from '@/components/checkout/CheckoutForm';

// /checkout (Fase 4B.5). Solo existe donde el carrito está habilitado (Supabase local, fuera de Vercel) y
// con la clave de servidor; en Preview y Production responde 404. Sin registro ni inicio de sesión.
// Cabeceras (no-store, no-referrer, noindex): next.config.ts.

export const metadata: Metadata = {
  title: 'Finalizar compra',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function CheckoutPage() {
  await connection(); // siempre en el momento: provincias con cobertura y flag del entorno actuales
  if (!isCheckoutAvailable()) notFound();
  const provinces = await listProvinces();

  return (
    <main className="store ck" id="contenido">
      <StoreHeading kicker="Tu compra" title="FINALIZAR COMPRA" as="h1" />
      <CheckoutForm provinces={provinces} />
    </main>
  );
}
