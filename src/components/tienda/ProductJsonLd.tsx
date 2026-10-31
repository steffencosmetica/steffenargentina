import { centavosToDecimal } from '@/lib/money';
import { availability } from '@/lib/catalog/store';
import type { Product } from '@/lib/catalog/types';
import { SITE_NAME, SITE_URL } from '@/lib/site';

const SCHEMA_AVAILABILITY = {
  disponible: 'https://schema.org/InStock',
  ultimas: 'https://schema.org/LimitedAvailability',
  'sin-stock': 'https://schema.org/OutOfStock',
} as const;

/** Datos estructurados schema.org (Product + Offer y BreadcrumbList) con datos reales del catálogo. */
export function productJsonLd(product: Product) {
  const url = `${SITE_URL}/tienda/${product.slug}`;
  const description = product.shortDescription || product.description;
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Product',
      name: product.name,
      sku: product.sku,
      url,
      ...(description && { description }),
      ...(product.images.length && { image: product.images.map((img) => img.url) }),
      category: product.category.name,
      brand: { '@type': 'Brand', name: 'Steffen' },
      offers: {
        '@type': 'Offer',
        url,
        priceCurrency: 'ARS',
        price: centavosToDecimal(product.priceCentavos),
        availability: SCHEMA_AVAILABILITY[availability(product.stock)],
        itemCondition: 'https://schema.org/NewCondition',
        seller: { '@type': 'Organization', name: SITE_NAME },
      },
    },
    {
      '@context': 'https://schema.org',
      '@type': 'BreadcrumbList',
      itemListElement: [
        { '@type': 'ListItem', position: 1, name: 'Tienda', item: `${SITE_URL}/tienda` },
        { '@type': 'ListItem', position: 2, name: product.category.name, item: `${SITE_URL}/tienda?categoria=${product.category.slug}` },
        { '@type': 'ListItem', position: 3, name: product.name, item: url },
      ],
    },
  ];
}

export default function ProductJsonLd({ product }: { product: Product }) {
  // "<" escapado: un texto cargado en el panel no puede cerrar el <script>
  const json = JSON.stringify(productJsonLd(product)).replace(/</g, '\\u003c');
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: json }} />;
}
