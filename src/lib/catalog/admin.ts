import 'server-only';
import { createSessionClient } from '@/lib/supabase/server';
import { CATALOGO_BUCKET } from '@/lib/supabase/env';
import { centavosToDecimal } from '@/lib/money';
import type { CategoryInput, ProductInput } from './types';
import { assertValid, isValidStoragePath, validateCategoryInput, validateProductInput } from './validation';

// Operaciones de administración del catálogo, para usar desde Server Actions o Route Handlers.
// Doble control:
//   1. requireAdmin() verifica la identidad con Supabase Auth (getUser valida el token contra
//      el servidor de Auth, no solo lee la cookie) y consulta el rol en la tabla admin_users.
//   2. Las escrituras van con la sesión del usuario, así que las políticas RLS las vuelven a
//      rechazar si no es administrador, aunque este código tuviera un error.
// No se usa la clave service_role: ninguna operación de acá saltea RLS.

export class AdminAuthError extends Error {
  constructor(message = 'Se requiere una sesión de administrador.') {
    super(message);
    this.name = 'AdminAuthError';
  }
}

export async function requireAdmin() {
  const supabase = await createSessionClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new AdminAuthError();

  const { data: isAdmin, error } = await supabase.rpc('is_admin');
  if (error) throw error;
  if (!isAdmin) throw new AdminAuthError('El usuario no tiene permisos de administrador.');

  return { supabase, user: userData.user };
}

function categoryRow(input: CategoryInput) {
  return {
    name: input.name.trim(),
    slug: input.slug,
    description: input.description?.trim() || null,
    image_path: input.imagePath || null,
    sort_order: input.sortOrder ?? 0,
    is_active: input.isActive ?? true,
  };
}

function productRow(input: ProductInput) {
  return {
    sku: input.sku,
    name: input.name.trim(),
    slug: input.slug,
    short_description: input.shortDescription?.trim() || null,
    description: input.description?.trim() || null,
    usage_instructions: input.usageInstructions?.trim() || null,
    category_id: input.categoryId,
    // se envía como texto decimal exacto ("12500.50"); PostgREST lo guarda en numeric(12,2)
    // sin pasar por float. Los tipos generados lo declaran number, de ahí la conversión de tipo.
    price_ars: centavosToDecimal(input.priceCentavos) as unknown as number,
    stock: input.stock,
    weight_grams: input.weightGrams ?? null,
    package_length_mm: input.packageLengthMm ?? null,
    package_width_mm: input.packageWidthMm ?? null,
    package_height_mm: input.packageHeightMm ?? null,
    is_featured: input.isFeatured ?? false,
    is_active: input.isActive ?? true,
    sort_order: input.sortOrder ?? 0,
  };
}

// ---------------------------------------------------------------------------
// Categorías
// ---------------------------------------------------------------------------

export async function createCategory(input: CategoryInput) {
  assertValid(validateCategoryInput(input));
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.from('categories').insert(categoryRow(input)).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function updateCategory(id: string, input: CategoryInput) {
  assertValid(validateCategoryInput(input));
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from('categories').update(categoryRow(input)).eq('id', id);
  if (error) throw error;
}

export async function setCategoryActive(id: string, isActive: boolean) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from('categories').update({ is_active: isActive }).eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Productos
// ---------------------------------------------------------------------------

export async function createProduct(input: ProductInput) {
  assertValid(validateProductInput(input));
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.from('products').insert(productRow(input)).select('id').single();
  if (error) throw error;
  return data.id;
}

export async function updateProduct(id: string, input: ProductInput) {
  assertValid(validateProductInput(input));
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from('products').update(productRow(input)).eq('id', id);
  if (error) throw error;
}

export async function setProductActive(id: string, isActive: boolean) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from('products').update({ is_active: isActive }).eq('id', id);
  if (error) throw error;
}

export async function setProductStock(id: string, stock: number) {
  if (!Number.isInteger(stock) || stock < 0) throw new RangeError('El stock debe ser un entero mayor o igual a cero.');
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from('products').update({ stock }).eq('id', id);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Imágenes
// ---------------------------------------------------------------------------

const MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

/** Sube una imagen al bucket y la asocia al producto. */
export async function addProductImage(productId: string, file: File, opts: { altText?: string; isPrimary?: boolean; sortOrder?: number } = {}) {
  const ext = MIME_EXT[file.type];
  if (!ext) throw new RangeError('Formato de imagen no admitido (JPG, PNG, WebP o AVIF).');
  const { supabase } = await requireAdmin();

  const path = `productos/${productId}/${crypto.randomUUID()}.${ext}`;
  const upload = await supabase.storage.from(CATALOGO_BUCKET).upload(path, file, { contentType: file.type, upsert: false });
  if (upload.error) throw upload.error;

  const { data, error } = await supabase
    .from('product_images')
    .insert({
      product_id: productId,
      storage_path: path,
      alt_text: opts.altText?.trim() || null,
      sort_order: opts.sortOrder ?? 0,
      is_primary: false,
    })
    .select('id')
    .single();
  if (error) {
    // no dejar archivos huérfanos si falla el registro
    await supabase.storage.from(CATALOGO_BUCKET).remove([path]);
    throw error;
  }
  if (opts.isPrimary) await setPrimaryProductImage(data.id);
  return data.id;
}

export async function setPrimaryProductImage(imageId: string) {
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc('set_primary_product_image', { p_image_id: imageId });
  if (error) throw error;
}

export async function deleteProductImage(imageId: string) {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.from('product_images').delete().eq('id', imageId).select('storage_path').maybeSingle();
  if (error) throw error;
  if (data && isValidStoragePath(data.storage_path)) {
    const removed = await supabase.storage.from(CATALOGO_BUCKET).remove([data.storage_path]);
    if (removed.error) throw removed.error;
  }
}
