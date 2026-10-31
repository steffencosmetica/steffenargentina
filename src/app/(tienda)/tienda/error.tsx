'use client';

import StoreEmpty from '@/components/tienda/StoreEmpty';
import StoreHeading from '@/components/tienda/StoreHeading';

// Error al consultar el catálogo (Supabase sin respuesta, por ejemplo). No muestra detalles técnicos.
export default function TiendaError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="store">
      <StoreHeading kicker="Descubrí Steffen" title="TIENDA ONLINE" as="h1" />
      <StoreEmpty
        title="No pudimos cargar los productos"
        action={
          <button type="button" className="store-btn store-btn-ghost" onClick={reset}>
            Reintentar
          </button>
        }
      >
        Puede ser un problema momentáneo de conexión. Intentá de nuevo en unos segundos.
      </StoreEmpty>
    </main>
  );
}
