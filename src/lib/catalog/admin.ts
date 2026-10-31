import 'server-only';
import { cache } from 'react';
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

/** Error de negocio con un mensaje que se puede mostrar tal cual al administrador. */
export class AdminActionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AdminActionError';
  }
}

// cache(): dentro de un mismo render (layout + página) se verifica una sola vez.
// En los Server Actions no hay render compartido, así que cada acción verifica de nuevo.
export const requireAdmin = cache(async () => {
  const supabase = await createSessionClient();
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData.user) throw new AdminAuthError();

  const { data: isAdmin, error } = await supabase.rpc('is_admin');
  if (error) throw error;
  if (!isAdmin) throw new AdminAuthError('El usuario no tiene permisos de administrador.');

  return { supabase, user: userData.user };
});

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function assertUuid(id: string) {
  if (!UUID_RE.test(id)) throw new AdminActionError('Identificador inválido.');
}

function categoryRow(input: CategoryInput) {
  return {
    name: input.name.trim(),
    slug: input.slug,
    description: input.description?.trim() || null,
    is_active: input.isActive ?? true,
    // el orden y la imagen solo se tocan si vienen: editar el nombre no los pisa
    ...(input.sortOrder !== undefined && { sort_order: input.sortOrder }),
    ...(input.imagePath !== undefined && { image_path: input.imagePath || null }),
  };
}

// se envía como texto decimal exacto ("12500.50"); PostgREST lo guarda en numeric(12,2)
// sin pasar por float. Los tipos generados lo declaran number, de ahí la conversión de tipo.
function priceValue(centavos: number) {
  return centavosToDecimal(centavos) as unknown as number;
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
    price_ars: priceValue(input.priceCentavos),
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
  // las categorías nuevas van al final de la lista
  const { data: last, error: lastError } = await supabase
    .from('categories')
    .select('sort_order')
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (lastError) throw lastError;
  const sortOrder = input.sortOrder ?? (last ? last.sort_order + 10 : 10);

  const { data, error } = await supabase
    .from('categories')
    .insert({ ...categoryRow(input), sort_order: sortOrder })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}

export async function updateCategory(id: string, input: CategoryInput) {
  assertUuid(id);
  assertValid(validateCategoryInput(input));
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.from('categories').update(categoryRow(input)).eq('id', id).select('id');
  if (error) throw error;
  if (!data.length) throw new AdminActionError('La categoría ya no existe.');
}

export async function setCategoryActive(id: string, isActive: boolean) {
  assertUuid(id);
  const { supabase } = await requireAdmin();
  const { error } = await supabase.from('categories').update({ is_active: isActive }).eq('id', id);
  if (error) throw error;
}

/** Sube o baja una categoría un lugar. Reescribe el orden de todas (10, 20, 30…) para que no haya empates. */
export async function moveCategory(id: string, direction: 'up' | 'down') {
  assertUuid(id);
  const { supabase } = await requireAdmin();
  const { data: rows, error } = await supabase.from('categories').select('id, sort_order').order('sort_order').order('name');
  if (error) throw error;

  const ids = rows.map((r) => r.id);
  const index = ids.indexOf(id);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index === -1 || target < 0 || target >= ids.length) return;
  [ids[index], ids[target]] = [ids[target], ids[index]];

  await renumber(supabase, 'categories', ids, rows);
}

/** Borra una categoría solo si no tiene productos (la base además lo impide con on delete restrict). */
export async function deleteCategory(id: string) {
  assertUuid(id);
  const { supabase } = await requireAdmin();
  const { count, error: countError } = await supabase
    .from('products')
    .select('id', { count: 'exact', head: true })
    .eq('category_id', id);
  if (countError) throw countError;
  if (count) {
    throw new AdminActionError(
      `La categoría tiene ${count} producto${count === 1 ? '' : 's'} asociado${count === 1 ? '' : 's'}: movelos o desactivala en lugar de borrarla.`,
    );
  }
  const { data, error } = await supabase.from('categories').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data.length) throw new AdminActionError('La categoría ya no existe.');
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
  assertUuid(id);
  assertValid(validateProductInput(input));
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.from('products').update(productRow(input)).eq('id', id).select('id');
  if (error) throw error;
  if (!data.length) throw new AdminActionError('El producto ya no existe.');
}

async function updateProductFields(
  id: string,
  fields: { is_active?: boolean; is_featured?: boolean; stock?: number; price_ars?: number },
) {
  assertUuid(id);
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.from('products').update(fields).eq('id', id).select('id');
  if (error) throw error;
  if (!data.length) throw new AdminActionError('El producto ya no existe.');
}

export function setProductActive(id: string, isActive: boolean) {
  return updateProductFields(id, { is_active: isActive });
}

export function setProductFeatured(id: string, isFeatured: boolean) {
  return updateProductFields(id, { is_featured: isFeatured });
}

export function setProductStock(id: string, stock: number) {
  if (!Number.isInteger(stock) || stock < 0) throw new RangeError('El stock debe ser un entero mayor o igual a cero.');
  return updateProductFields(id, { stock });
}

export function setProductPrice(id: string, priceCentavos: number) {
  return updateProductFields(id, { price_ars: priceValue(priceCentavos) });
}

/**
 * Borra un producto y sus imágenes.
 * Hoy no hay tablas comerciales (pedidos) que lo referencien; cuando existan, sus claves foráneas
 * con on delete restrict harán fallar el borrado (23503) y el panel pedirá desactivarlo.
 * Las filas de product_images se borran en cascada; los archivos se borran después. Si eso falla,
 * el producto ya no existe y los archivos quedan huérfanos: se informan para limpiarlos más tarde.
 */
export async function deleteProduct(id: string): Promise<{ orphanedFiles: number }> {
  assertUuid(id);
  const { supabase } = await requireAdmin();
  const { data: images, error: imagesError } = await supabase.from('product_images').select('storage_path').eq('product_id', id);
  if (imagesError) throw imagesError;

  const { data, error } = await supabase.from('products').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data.length) throw new AdminActionError('El producto ya no existe.');

  const paths = images.map((i) => i.storage_path).filter(isValidStoragePath);
  return { orphanedFiles: await removeFiles(supabase, paths) };
}

// ---------------------------------------------------------------------------
// Imágenes de productos
// ---------------------------------------------------------------------------
// Subida en tres pasos, sin que el archivo pase por el servidor de Next:
//   1. prepareProductImageUpload: verifica admin y formato, y pide a Storage una URL firmada para
//      una ruta nueva (productos/<id>/<uuid>.<ext>). Crearla requiere permiso de INSERT en
//      storage.objects, que por RLS solo tienen los administradores.
//   2. El navegador sube el archivo con uploadToSignedUrl. El token solo sirve para esa ruta y
//      vence a las 2 horas; no da acceso a nada más. El bucket rechaza tipos y tamaños no permitidos.
//   3. registerProductImage: verifica que el archivo exista y crea la fila en product_images.

export const MAX_IMAGE_BYTES = 5 * 1024 * 1024; // igual que file_size_limit del bucket

export const IMAGE_MIME_EXT: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/avif': 'avif',
};

const PRODUCT_IMAGE_PATH_RE = /^productos\/([0-9a-f-]{36})\/[0-9a-f-]{36}\.(jpg|png|webp|avif)$/i;

export async function prepareProductImageUpload(productId: string, contentType: string, size: number) {
  assertUuid(productId);
  const ext = IMAGE_MIME_EXT[contentType];
  if (!ext) throw new AdminActionError('Formato no admitido. Usá JPG, PNG, WebP o AVIF.');
  if (!Number.isFinite(size) || size <= 0 || size > MAX_IMAGE_BYTES) {
    throw new AdminActionError('La imagen supera los 5 MB permitidos.');
  }
  const { supabase } = await requireAdmin();

  const { data: product, error: productError } = await supabase.from('products').select('id').eq('id', productId).maybeSingle();
  if (productError) throw productError;
  if (!product) throw new AdminActionError('El producto ya no existe.');

  const path = `productos/${productId}/${crypto.randomUUID()}.${ext}`;
  const { data, error } = await supabase.storage.from(CATALOGO_BUCKET).createSignedUploadUrl(path);
  if (error) throw error;
  return { path: data.path, token: data.token };
}

export async function registerProductImage(productId: string, path: string, altText?: string | null) {
  assertUuid(productId);
  const match = PRODUCT_IMAGE_PATH_RE.exec(path);
  if (!match || match[1].toLowerCase() !== productId.toLowerCase()) {
    throw new AdminActionError('La ruta de la imagen no corresponde al producto.');
  }
  const { supabase } = await requireAdmin();

  // exists() responde false (con un error 4xx) cuando el archivo no está
  const { data: exists } = await supabase.storage.from(CATALOGO_BUCKET).exists(path);
  if (!exists) throw new AdminActionError('La imagen no se terminó de subir. Intentá de nuevo.');

  const { data: siblings, error: siblingsError } = await supabase
    .from('product_images')
    .select('sort_order, is_primary')
    .eq('product_id', productId);
  if (siblingsError) throw siblingsError;

  const { data, error } = await supabase
    .from('product_images')
    .insert({
      product_id: productId,
      storage_path: path,
      alt_text: altText?.trim() || null,
      sort_order: siblings.length ? Math.max(...siblings.map((s) => s.sort_order)) + 1 : 0,
      // la primera imagen de un producto queda como principal
      is_primary: !siblings.some((s) => s.is_primary),
    })
    .select('id')
    .single();
  if (error) {
    // no dejar el archivo huérfano si falla el registro
    await removeFiles(supabase, [path]);
    throw error;
  }
  return data.id;
}

export async function setPrimaryProductImage(imageId: string) {
  assertUuid(imageId);
  const { supabase } = await requireAdmin();
  const { error } = await supabase.rpc('set_primary_product_image', { p_image_id: imageId });
  if (error) throw error;
}

export async function moveProductImage(imageId: string, direction: 'up' | 'down') {
  assertUuid(imageId);
  const { supabase } = await requireAdmin();
  const { data: image, error: imageError } = await supabase.from('product_images').select('product_id').eq('id', imageId).maybeSingle();
  if (imageError) throw imageError;
  if (!image) throw new AdminActionError('La imagen ya no existe.');

  const { data: rows, error } = await supabase
    .from('product_images')
    .select('id, sort_order')
    .eq('product_id', image.product_id)
    .order('sort_order')
    .order('created_at');
  if (error) throw error;

  const ids = rows.map((r) => r.id);
  const index = ids.indexOf(imageId);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (target < 0 || target >= ids.length) return;
  [ids[index], ids[target]] = [ids[target], ids[index]];

  await renumber(supabase, 'product_images', ids, rows, 1);
}

/**
 * Borra la fila y después el archivo. Si se borró la principal, la siguiente pasa a serlo.
 * Si el archivo no se pudo borrar, la imagen igual desaparece del catálogo y el archivo queda
 * para cleanupOrphanImages().
 */
export async function deleteProductImage(imageId: string): Promise<{ orphanedFiles: number }> {
  assertUuid(imageId);
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase
    .from('product_images')
    .delete()
    .eq('id', imageId)
    .select('product_id, storage_path, is_primary')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new AdminActionError('La imagen ya no existe.');

  if (data.is_primary) {
    const { data: next, error: nextError } = await supabase
      .from('product_images')
      .select('id')
      .eq('product_id', data.product_id)
      .order('sort_order')
      .limit(1)
      .maybeSingle();
    if (nextError) throw nextError;
    if (next) await setPrimaryProductImage(next.id);
  }

  return { orphanedFiles: isValidStoragePath(data.storage_path) ? await removeFiles(supabase, [data.storage_path]) : 0 };
}

/**
 * Borra del bucket los archivos de productos que ya no figuran en product_images
 * (subidas interrumpidas o borrados que fallaron a medias). Solo mira la carpeta productos/.
 * Los archivos de menos de 3 horas se respetan: pueden ser subidas en curso (el token dura 2 horas).
 */
export async function cleanupOrphanImages(): Promise<{ removed: number; failed: number }> {
  const { supabase } = await requireAdmin();
  const bucket = supabase.storage.from(CATALOGO_BUCKET);

  const { data: referenced, error: refError } = await supabase.from('product_images').select('storage_path');
  if (refError) throw refError;
  const inUse = new Set(referenced.map((r) => r.storage_path));

  const folders = await listAll(bucket, 'productos');
  const limit = Date.now() - 3 * 60 * 60 * 1000;
  const orphans: string[] = [];
  for (const folder of folders) {
    if (folder.id) continue; // los archivos tienen id; las carpetas no
    const files = await listAll(bucket, `productos/${folder.name}`);
    for (const file of files) {
      const path = `productos/${folder.name}/${file.name}`;
      const created = Date.parse(file.created_at ?? '');
      if (file.id && !inUse.has(path) && Number.isFinite(created) && created < limit) orphans.push(path);
    }
  }
  const failed = await removeFiles(supabase, orphans);
  return { removed: orphans.length - failed, failed };
}

// ---------------------------------------------------------------------------
// Auxiliares
// ---------------------------------------------------------------------------

type SessionClient = Awaited<ReturnType<typeof createSessionClient>>;
type Bucket = ReturnType<SessionClient['storage']['from']>;

async function listAll(bucket: Bucket, prefix: string) {
  const all: { id: string | null; name: string; created_at?: string | null }[] = [];
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await bucket.list(prefix, { limit: 1000, offset });
    if (error) throw error;
    all.push(...data);
    if (data.length < 1000) return all;
  }
}

/** Borra archivos del bucket. Devuelve cuántos no se pudieron borrar (no lanza error). */
async function removeFiles(supabase: SessionClient, paths: string[]) {
  if (!paths.length) return 0;
  // remove() no informa los archivos que ya no existían: eso cuenta como borrado
  const { error } = await supabase.storage.from(CATALOGO_BUCKET).remove(paths);
  if (error) {
    console.error('No se pudieron borrar archivos del bucket', { paths, error: error.message });
    return paths.length;
  }
  return 0;
}

/** Reescribe sort_order según el orden de ids, solo en las filas que cambian. */
async function renumber(
  supabase: SessionClient,
  table: 'categories' | 'product_images',
  ids: string[],
  rows: { id: string; sort_order: number }[],
  step = 10,
) {
  const current = new Map(rows.map((r) => [r.id, r.sort_order]));
  for (const [i, id] of ids.entries()) {
    const sortOrder = (i + 1) * step;
    if (current.get(id) === sortOrder) continue;
    const { error } = await supabase.from(table).update({ sort_order: sortOrder }).eq('id', id);
    if (error) throw error;
  }
}
