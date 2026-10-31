import type { Product } from '@/lib/catalog/types';
import ProductCard from './ProductCard';

export default function ProductGrid({ products, label, eager = true }: { products: Product[]; label: string; eager?: boolean }) {
  return (
    <ul className="store-grid" aria-label={label}>
      {products.map((p, i) => (
        <li key={p.id}>
          {/* las primeras fotos se ven sin hacer scroll: se piden enseguida, y la primera con prioridad alta (LCP) */}
          <ProductCard product={p} eager={eager && i < 4} lcp={eager && i === 0} />
        </li>
      ))}
    </ul>
  );
}
