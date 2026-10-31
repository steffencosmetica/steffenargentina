import 'server-only';
import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/lib/supabase/database.types';
import { createPublicClient } from '@/lib/supabase/public';
import { CATALOGO_BUCKET } from '@/lib/supabase/env';
import { parseCentavos } from '@/lib/money';
import type { Category, Product, ProductImage } from './types';
import { isAvailability, sortProducts } from './store';

// Consultas públicas del catálogo. Usan el cliente anónimo, así que RLS solo deja ver
// categorías activas y productos activos de categorías activas. Además se filtra explícitamente,
// por si alguna vez se las llama con un cliente con sesión de administrador.
// El stock exacto no es público: anon solo puede leer la columna availability (permisos por columna,
// ver supabase/migrations/*_productos_stock_privado.sql). Pedir stock acá haría fallar la consulta.

type Client = SupabaseClient<Database>;

// price_ars::text: el importe llega como texto exacto y se pasa a centavos sin usar float
const PRODUCT_SELECT = `
  id, sku, name, slug, short_description, description, usage_instructions, benefits, presentation,
  price_ars::text, availability, weight_grams, package_length_mm, package_width_mm, package_height_mm,
  is_featured, sort_order, updated_at,
  category:categories!inner ( id, name, slug, is_active ),
  images:product_images ( id, storage_path, sort_order, is_primary, alt_text )
`;

function publicUrl(client: Client, path: string) {
  return client.storage.from(CATALOGO_BUCKET).getPublicUrl(path).data.publicUrl;
}

type ProductRow = {
  id: string;
  sku: string;
  name: string;
  slug: string;
  short_description: string | null;
  description: string | null;
  usage_instructions: string | null;
  benefits: string | null;
  presentation: string | null;
  price_ars: string;
  availability: string;
  weight_grams: number | null;
  package_length_mm: number | null;
  package_width_mm: number | null;
  package_height_mm: number | null;
  is_featured: boolean;
  sort_order: number;
  updated_at: string;
  category: { id: string; name: string; slug: string; is_active: boolean };
  images: { id: string; storage_path: string; sort_order: number; is_primary: boolean; alt_text: string | null }[];
};

function toProduct(client: Client, row: ProductRow): Product {
  const images: ProductImage[] = row.images
    .map((img) => ({
      id: img.id,
      url: publicUrl(client, img.storage_path),
      storagePath: img.storage_path,
      altText: img.alt_text,
      isPrimary: img.is_primary,
      sortOrder: img.sort_order,
    }))
    .sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.sortOrder - b.sortOrder);

  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    slug: row.slug,
    shortDescription: row.short_description,
    description: row.description,
    usageInstructions: row.usage_instructions,
    benefits: row.benefits,
    presentation: row.presentation,
    category: { id: row.category.id, name: row.category.name, slug: row.category.slug },
    priceCentavos: parseCentavos(row.price_ars),
    // un valor desconocido se trata como sin stock: nunca se ofrece algo que podría no estar disponible
    availability: isAvailability(row.availability) ? row.availability : 'sin-stock',
    weightGrams: row.weight_grams,
    packageMm: { length: row.package_length_mm, width: row.package_width_mm, height: row.package_height_mm },
    isFeatured: row.is_featured,
    sortOrder: row.sort_order,
    updatedAt: row.updated_at,
    images,
  };
}

// El texto del buscador va dentro de un filtro de PostgREST: se quitan los caracteres
// que tienen significado en esa sintaxis (comas, paréntesis, comodines)
function sanitizeSearch(q: string) {
  return q.replace(/[,()*%_\\:."']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export async function listCategories(client: Client = createPublicClient()): Promise<Category[]> {
  const { data, error } = await client
    .from('categories')
    .select('id, name, slug, description, image_path, sort_order')
    .eq('is_active', true)
    .order('sort_order')
    .order('name');
  if (error) throw error;
  return data.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description,
    imageUrl: c.image_path ? publicUrl(client, c.image_path) : null,
    sortOrder: c.sort_order,
  }));
}

export async function getCategoryBySlug(slug: string, client: Client = createPublicClient()): Promise<Category | null> {
  const categories = await listCategories(client);
  return categories.find((c) => c.slug === slug) ?? null;
}

export type ProductFilters = {
  categorySlug?: string;
  featured?: boolean;
  search?: string;
  limit?: number;
};

export async function listProducts(filters: ProductFilters = {}, client: Client = createPublicClient()): Promise<Product[]> {
  let query = client
    .from('products')
    .select(PRODUCT_SELECT)
    .eq('is_active', true)
    .eq('category.is_active', true);

  if (filters.categorySlug) query = query.eq('category.slug', filters.categorySlug);
  if (filters.featured) query = query.eq('is_featured', true);
  if (filters.search) {
    const q = sanitizeSearch(filters.search);
    if (q) query = query.or(`name.ilike.*${q}*,short_description.ilike.*${q}*,sku.ilike.*${q}*`);
  }
  query = query.order('sort_order').order('name');
  if (filters.limit) query = query.limit(filters.limit);

  const { data, error } = await query.overrideTypes<ProductRow[], { merge: false }>();
  if (error) throw error;
  return data.map((row) => toProduct(client, row));
}

/** Todo el catálogo visible en una sola consulta cacheada; la tienda filtra y ordena en memoria (store.ts). */
export function listStoreProducts(client: Client = createPublicClient()) {
  return listProducts({}, client);
}

/** Destacados para el inicio: hasta `limit`, con los que no tienen stock al final. */
export async function listFeaturedProducts(limit = 8, client: Client = createPublicClient()) {
  return sortProducts(await listProducts({ featured: true }, client), 'destacados').slice(0, limit);
}

export async function getProductBySlug(slug: string, client: Client = createPublicClient()): Promise<Product | null> {
  // un slug con otro formato no puede existir: se evita la consulta
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(slug)) return null;
  const { data, error } = await client
    .from('products')
    .select(PRODUCT_SELECT)
    .eq('is_active', true)
    .eq('category.is_active', true)
    .eq('slug', slug)
    .maybeSingle()
    .overrideTypes<ProductRow | null, { merge: false }>();
  if (error) throw error;
  return data ? toProduct(client, data) : null;
}
