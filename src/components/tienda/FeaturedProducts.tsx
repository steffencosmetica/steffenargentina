import '@/styles/tienda.css';
import Link from 'next/link';
import { listFeaturedProducts } from '@/lib/catalog/queries';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import type { Product } from '@/lib/catalog/types';
import ProductCard from './ProductCard';
import StoreHeading from './StoreHeading';

// Ancho de cada tarjeta del carrusel: 62 % en celulares, un tercio en tablet, un cuarto en escritorio
const FEATURED_SIZES = '(max-width: 600px) 62vw, (max-width: 1200px) 31vw, 300px';

async function loadFeatured(): Promise<Product[]> {
  if (!isSupabaseConfigured()) return [];
  try {
    return await listFeaturedProducts(8);
  } catch (error) {
    // el inicio institucional nunca se cae por la tienda: se registra y la sección no se muestra
    const detail = error instanceof Error ? error.message : (error as { code?: string })?.code ?? 'desconocido';
    console.error('No se pudieron cargar los productos destacados:', detail);
    return [];
  }
}

/** Sección «Productos destacados» del inicio. Sin destacados (o sin conexión) no renderiza nada. */
export default async function FeaturedProducts() {
  const products = await loadFeatured();
  if (!products.length) return null;

  return (
    <section className="store-featured" aria-labelledby="destacados-titulo" data-testid="featured">
      <div className="store-featured-inner">
        <StoreHeading kicker="Elegidos para vos" title="PRODUCTOS DESTACADOS" reveal id="destacados-titulo" />
        <ul className="store-featured-track">
          {products.map((p) => (
            <li key={p.id}>
              <ProductCard product={p} sizes={FEATURED_SIZES} />
            </li>
          ))}
        </ul>
        <div className="store-featured-cta">
          {/* sin prefetch: la tienda usa otro layout raíz y se carga completa */}
          <Link href="/tienda" prefetch={false} className="store-btn">
            Ver toda la tienda
          </Link>
        </div>
      </div>
    </section>
  );
}
