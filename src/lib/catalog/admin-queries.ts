import 'server-only';
import { CATALOGO_BUCKET } from '@/lib/supabase/env';
import { parseCentavos } from '@/lib/money';
import { requireAdmin } from './admin';

// Lecturas del panel. A diferencia de queries.ts (catálogo público), incluyen lo inactivo:
// la política RLS de lectura deja ver todo cuando is_admin() es verdadero.

type Supabase = Awaited<ReturnType<typeof requireAdmin>>['supabase'];

function publicUrl(supabase: Supabase, path: string) {
  return supabase.storage.from(CATALOGO_BUCKET).getPublicUrl(path).data.publicUrl;
}

export type AdminProductRow = {
  id: string;
  sku: string;
  name: string;
  priceCentavos: number;
  stock: number;
  isActive: boolean;
  isFeatured: boolean;
  category: { id: string; name: string; isActive: boolean } | null;
  imageUrl: string | null;
};

export type AdminProductFilters = { q?: string; categoryId?: string; estado?: 'activos' | 'inactivos' | 'destacados' };

function sanitizeSearch(q: string) {
  return q.replace(/[,()*%_\\:."']/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 80);
}

export async function listAdminProducts(filters: AdminProductFilters = {}): Promise<AdminProductRow[]> {
  const { supabase } = await requireAdmin();
  let query = supabase
    .from('products')
    .select(
      'id, sku, name, price_ars::text, stock, is_active, is_featured, sort_order, category:categories ( id, name, is_active ), images:product_images ( storage_path, is_primary, sort_order )',
    );
  const q = filters.q ? sanitizeSearch(filters.q) : '';
  if (q) query = query.or(`name.ilike.*${q}*,sku.ilike.*${q}*`);
  if (filters.categoryId && /^[0-9a-f-]{36}$/i.test(filters.categoryId)) query = query.eq('category_id', filters.categoryId);
  if (filters.estado === 'activos') query = query.eq('is_active', true);
  if (filters.estado === 'inactivos') query = query.eq('is_active', false);
  if (filters.estado === 'destacados') query = query.eq('is_featured', true);

  const { data, error } = await query
    .order('sort_order')
    .order('name')
    .overrideTypes<
      {
        id: string;
        sku: string;
        name: string;
        price_ars: string;
        stock: number;
        is_active: boolean;
        is_featured: boolean;
        category: { id: string; name: string; is_active: boolean } | null;
        images: { storage_path: string; is_primary: boolean; sort_order: number }[];
      }[],
      { merge: false }
    >();
  if (error) throw error;

  return data.map((row) => {
    const primary = [...row.images].sort((a, b) => Number(b.is_primary) - Number(a.is_primary) || a.sort_order - b.sort_order)[0];
    return {
      id: row.id,
      sku: row.sku,
      name: row.name,
      priceCentavos: parseCentavos(row.price_ars),
      stock: row.stock,
      isActive: row.is_active,
      isFeatured: row.is_featured,
      category: row.category ? { id: row.category.id, name: row.category.name, isActive: row.category.is_active } : null,
      imageUrl: primary ? publicUrl(supabase, primary.storage_path) : null,
    };
  });
}

export type AdminProductImage = { id: string; url: string; altText: string | null; isPrimary: boolean; sortOrder: number };

export type AdminProduct = {
  id: string;
  sku: string;
  name: string;
  slug: string;
  shortDescription: string | null;
  description: string | null;
  usageInstructions: string | null;
  categoryId: string;
  priceCentavos: number;
  stock: number;
  weightGrams: number | null;
  packageLengthMm: number | null;
  packageWidthMm: number | null;
  packageHeightMm: number | null;
  isFeatured: boolean;
  isActive: boolean;
  sortOrder: number;
  images: AdminProductImage[];
};

export async function getAdminProduct(id: string): Promise<AdminProduct | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase
    .from('products')
    .select('*, price_ars::text, images:product_images ( id, storage_path, alt_text, is_primary, sort_order, created_at )')
    .eq('id', id)
    .maybeSingle()
    .overrideTypes<
      {
        id: string;
        sku: string;
        name: string;
        slug: string;
        short_description: string | null;
        description: string | null;
        usage_instructions: string | null;
        category_id: string;
        price_ars: string;
        stock: number;
        weight_grams: number | null;
        package_length_mm: number | null;
        package_width_mm: number | null;
        package_height_mm: number | null;
        is_featured: boolean;
        is_active: boolean;
        sort_order: number;
        images: { id: string; storage_path: string; alt_text: string | null; is_primary: boolean; sort_order: number; created_at: string }[];
      } | null,
      { merge: false }
    >();
  if (error) throw error;
  if (!data) return null;

  return {
    id: data.id,
    sku: data.sku,
    name: data.name,
    slug: data.slug,
    shortDescription: data.short_description,
    description: data.description,
    usageInstructions: data.usage_instructions,
    categoryId: data.category_id,
    priceCentavos: parseCentavos(data.price_ars),
    stock: data.stock,
    weightGrams: data.weight_grams,
    packageLengthMm: data.package_length_mm,
    packageWidthMm: data.package_width_mm,
    packageHeightMm: data.package_height_mm,
    isFeatured: data.is_featured,
    isActive: data.is_active,
    sortOrder: data.sort_order,
    images: [...data.images]
      .sort((a, b) => a.sort_order - b.sort_order || a.created_at.localeCompare(b.created_at))
      .map((img) => ({
        id: img.id,
        url: publicUrl(supabase, img.storage_path),
        altText: img.alt_text,
        isPrimary: img.is_primary,
        sortOrder: img.sort_order,
      })),
  };
}

export type AdminCategory = {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  isActive: boolean;
  sortOrder: number;
  productCount: number;
};

export async function listAdminCategories(): Promise<AdminCategory[]> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase
    .from('categories')
    .select('id, name, slug, description, is_active, sort_order, products(count)')
    .order('sort_order')
    .order('name')
    .overrideTypes<
      { id: string; name: string; slug: string; description: string | null; is_active: boolean; sort_order: number; products: { count: number }[] }[],
      { merge: false }
    >();
  if (error) throw error;
  return data.map((c) => ({
    id: c.id,
    name: c.name,
    slug: c.slug,
    description: c.description,
    isActive: c.is_active,
    sortOrder: c.sort_order,
    productCount: c.products[0]?.count ?? 0,
  }));
}

export async function getAdminCategory(id: string): Promise<AdminCategory | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const categories = await listAdminCategories();
  return categories.find((c) => c.id === id) ?? null;
}
