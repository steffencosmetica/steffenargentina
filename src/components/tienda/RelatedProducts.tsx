import type { Product } from '@/lib/catalog/types';
import ProductGrid from './ProductGrid';
import StoreHeading from './StoreHeading';

/** Hasta cuatro productos de la misma categoría. Sin relacionados no renderiza nada. */
export default function RelatedProducts({ products, categoryName }: { products: Product[]; categoryName: string }) {
  if (!products.length) return null;
  return (
    <section className="store-related" aria-labelledby="relacionados-titulo" data-testid="related">
      <StoreHeading kicker={categoryName} title="PRODUCTOS RELACIONADOS" id="relacionados-titulo" />
      <ProductGrid products={products} label="Productos relacionados" eager={false} />
    </section>
  );
}
