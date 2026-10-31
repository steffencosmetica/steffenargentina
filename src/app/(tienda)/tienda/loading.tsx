import StoreHeading from '@/components/tienda/StoreHeading';

// Esqueleto mientras se cargan los productos: mismas proporciones que la grilla real (sin saltos)
export default function TiendaLoading() {
  return (
    <main className="store" aria-busy="true">
      <StoreHeading kicker="Descubrí Steffen" title="TIENDA ONLINE" as="h1" />
      <p className="store-sr-only" role="status">
        Cargando productos…
      </p>
      <ul className="store-grid" aria-hidden="true">
        {Array.from({ length: 8 }, (_, i) => (
          <li key={i}>
            <span className="store-skeleton store-skeleton-media" />
            <span className="store-skeleton store-skeleton-line" />
            <span className="store-skeleton store-skeleton-line short" />
          </li>
        ))}
      </ul>
    </main>
  );
}
