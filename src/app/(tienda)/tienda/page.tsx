import type { Metadata } from 'next';
import Link from 'next/link';
import { listCategories, listStoreProducts } from '@/lib/catalog/queries';
import { PAGE_SIZE, filterProducts, parseStoreQuery, storeHref } from '@/lib/catalog/store';
import { pageMetadata } from '@/lib/metadata';
import { CATALOGO_PDF } from '@/lib/site';
import StoreHeading from '@/components/tienda/StoreHeading';
import StoreBrowser from '@/components/tienda/StoreBrowser';
import ProductGrid from '@/components/tienda/ProductGrid';
import StoreEmpty from '@/components/tienda/StoreEmpty';

export const metadata: Metadata = pageMetadata(
  'Tienda online',
  'Tienda online de Steffen Cosmética Capilar: productos para el cuidado del cabello con precio público y disponibilidad.',
  '/tienda',
);

type Props = { searchParams: Promise<Record<string, string | string[] | undefined>> };

export default async function TiendaPage({ searchParams }: Props) {
  const query = parseStoreQuery(await searchParams);
  // Una sola lista cacheada (tag "catalogo") con todo lo visible; filtros y orden se aplican en memoria.
  // Si la consulta falla, el error lo muestra tienda/error.tsx con la opción de reintentar.
  const [products, categories] = await Promise.all([listStoreProducts(), listCategories()]);

  // solo las categorías que tienen algún producto a la venta
  const withProducts = new Set(products.map((p) => p.category.slug));
  const chips = categories.filter((c) => withProducts.has(c.slug)).map(({ slug, name }) => ({ slug, name }));
  const categoryName = chips.find((c) => c.slug === query.categoria)?.name;

  const results = filterProducts(products, query);
  const shown = results.slice(0, query.mostrar);
  const filtering = Boolean(query.q || query.categoria);

  return (
    <main className="store" id="contenido">
      <StoreHeading kicker="Descubrí Steffen" title="TIENDA ONLINE" as="h1" />

      {products.length === 0 ? (
        <StoreEmpty
          title="Todavía no hay productos en la tienda"
          action={
            <a href={CATALOGO_PDF} className="store-btn store-btn-ghost" target="_blank" rel="noopener">
              Ver el catálogo
            </a>
          }
        />
      ) : (
        <StoreBrowser categories={chips} query={query}>
          <div className="store-summary">
            <span data-testid="store-count" aria-live="polite">
              {results.length} {results.length === 1 ? 'producto' : 'productos'}
              {categoryName ? ` en ${categoryName}` : ''}
              {query.q ? ` para «${query.q}»` : ''}
            </span>
            {filtering && (
              <Link href={storeHref({ orden: query.orden })} scroll={false}>
                Limpiar filtros
              </Link>
            )}
          </div>

          {results.length === 0 ? (
            <StoreEmpty title="No encontramos productos" action={{ href: '/tienda', label: 'Limpiar filtros' }}>
              Probá con otra búsqueda o elegí otra categoría.
            </StoreEmpty>
          ) : (
            <>
              <ProductGrid products={shown} label="Productos" />
              {results.length > shown.length && (
                <div className="store-more">
                  <Link href={storeHref({ ...query, mostrar: query.mostrar + PAGE_SIZE })} scroll={false} className="store-btn store-btn-ghost">
                    Ver más productos
                  </Link>
                </div>
              )}
            </>
          )}
        </StoreBrowser>
      )}
    </main>
  );
}
