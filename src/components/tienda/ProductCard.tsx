import Image from 'next/image';
import Link from 'next/link';
import { formatArs } from '@/lib/money';
import type { Product } from '@/lib/catalog/types';
import AvailabilityBadge from './AvailabilityBadge';
import NoImage from './NoImage';
import AddToCartButton from '@/components/cart/AddToCartButton';

// Ancho real de la foto en cada grilla: 2 columnas en celulares, 3 en tablet, 4 en escritorio
export const CARD_SIZES = '(max-width: 600px) 46vw, (max-width: 1200px) 31vw, 300px';

/**
 * Tarjeta de producto: foto, nombre y precio son un enlace a la ficha. Con el carrito habilitado, el botón
 * «Agregar al carrito» va debajo, FUERA del enlace (no se anida un botón en un link); sin carrito no se
 * renderiza nada más y la tarjeta queda igual que antes.
 * `eager`: la foto se pide sin esperar al scroll; `lcp`: además con prioridad alta (la primera visible).
 */
export default function ProductCard({
  product,
  eager = false,
  lcp = false,
  sizes = CARD_SIZES,
}: {
  product: Product;
  eager?: boolean;
  lcp?: boolean;
  sizes?: string;
}) {
  const image = product.images[0];
  const level = product.availability;
  return (
    <>
    <Link href={`/tienda/${product.slug}`} className="store-card" data-level={level} data-testid="store-card">
      <span className="store-card-media">
        {image ? (
          <Image
            src={image.url}
            alt={image.altText || product.name}
            fill
            sizes={sizes}
            loading={eager || lcp ? 'eager' : 'lazy'}
            fetchPriority={lcp ? 'high' : undefined}
          />
        ) : (
          <NoImage />
        )}
      </span>
      <span className="store-card-body">
        <span className="store-card-category">{product.category.name}</span>
        <span className="store-card-name">{product.name}</span>
        <span className="store-price">{formatArs(product.priceCentavos)}</span>
        <AvailabilityBadge level={product.availability} />
      </span>
    </Link>
    <AddToCartButton productId={product.id} productName={product.name} soldOut={level === 'sin-stock'} variant="card" />
    </>
  );
}

