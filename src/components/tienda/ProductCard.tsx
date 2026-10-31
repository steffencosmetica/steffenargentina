import Image from 'next/image';
import Link from 'next/link';
import { formatArs } from '@/lib/money';
import { availability } from '@/lib/catalog/store';
import type { Product } from '@/lib/catalog/types';
import AvailabilityBadge from './AvailabilityBadge';
import NoImage from './NoImage';

// Ancho real de la foto en cada grilla: 2 columnas en celulares, 3 en tablet, 4 en escritorio
export const CARD_SIZES = '(max-width: 600px) 46vw, (max-width: 1200px) 31vw, 300px';

/**
 * Tarjeta de producto: toda la tarjeta es un enlace a la ficha.
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
  const level = availability(product.stock);
  return (
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
        <AvailabilityBadge stock={product.stock} />
      </span>
    </Link>
  );
}

