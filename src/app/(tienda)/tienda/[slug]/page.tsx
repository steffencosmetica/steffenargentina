import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { cache } from 'react';
import { getProductBySlug, listStoreProducts } from '@/lib/catalog/queries';
import { relatedProducts, storeHref } from '@/lib/catalog/store';
import { isSupabaseConfigured } from '@/lib/supabase/env';
import { formatArs } from '@/lib/money';
import { baseMetadata } from '@/lib/metadata';
import { SITE_NAME } from '@/lib/site';
import Breadcrumbs from '@/components/tienda/Breadcrumbs';
import ProductGallery from '@/components/tienda/ProductGallery';
import AvailabilityBadge from '@/components/tienda/AvailabilityBadge';
import ProductSections from '@/components/tienda/ProductSections';
import RelatedProducts from '@/components/tienda/RelatedProducts';
import WhatsAppConsult from '@/components/tienda/WhatsAppConsult';
import ProductJsonLd from '@/components/tienda/ProductJsonLd';

type Props = { params: Promise<{ slug: string }> };

// metadata y página piden el mismo producto: una sola consulta por render
const getProduct = cache(getProductBySlug);

// Las fichas de los productos activos se generan en el build; las nuevas, en la primera visita.
// Todas quedan cacheadas con el tag "catalogo" y se regeneran cuando el panel modifica el catálogo.
export async function generateStaticParams() {
  if (!isSupabaseConfigured()) return [];
  try {
    return (await listStoreProducts()).map((p) => ({ slug: p.slug }));
  } catch (error) {
    console.error('No se pudieron listar las fichas para el build:', error instanceof Error ? error.message : error);
    return [];
  }
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const product = await getProduct((await params).slug);
  if (!product) return { title: 'Producto no encontrado', robots: { index: false } };

  const description =
    product.shortDescription ||
    product.description?.slice(0, 160) ||
    `${product.name}, de la línea ${product.category.name} de ${SITE_NAME}.`;
  const path = `/tienda/${product.slug}`;
  const image = product.images[0];
  return {
    title: product.name,
    description,
    alternates: { canonical: path },
    openGraph: {
      ...baseMetadata.openGraph,
      title: `${product.name} | ${SITE_NAME}`,
      description,
      url: path,
      ...(image && { images: [{ url: image.url, alt: image.altText || product.name }] }),
    },
  };
}

export default async function ProductoPage({ params }: Props) {
  const product = await getProduct((await params).slug);
  // inexistente, inactivo o de una categoría inactiva: 404 (RLS y la consulta lo excluyen)
  if (!product) notFound();

  const related = relatedProducts(await listStoreProducts(), product, 4);
  const categoryHref = storeHref({ categoria: product.category.slug });

  return (
    <main className="store" id="contenido">
      <ProductJsonLd product={product} />
      <Breadcrumbs
        items={[
          { label: 'Tienda', href: '/tienda' },
          { label: product.category.name, href: categoryHref },
          { label: product.name },
        ]}
      />

      <div className="store-product">
        <ProductGallery images={product.images} name={product.name} />

        <div className="store-product-info">
          <Link href={categoryHref} className="store-product-category">
            {product.category.name}
          </Link>
          <h1 className="store-product-name">{product.name}</h1>
          <span className="store-price" data-testid="product-price">
            {formatArs(product.priceCentavos)}
          </span>
          <AvailabilityBadge level={product.availability} />
          {product.shortDescription && <p className="store-product-short">{product.shortDescription}</p>}
          {/* espacio de la acción de compra: hoy, la consulta por WhatsApp */}
          <div className="store-product-actions">
            <WhatsAppConsult productName={product.name} />
          </div>
        </div>
      </div>

      <ProductSections product={product} />
      <RelatedProducts products={related} categoryName={product.category.name} />
    </main>
  );
}
