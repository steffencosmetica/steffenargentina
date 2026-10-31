'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import {
  cleanupOrphanImages,
  createProduct,
  deleteProduct,
  deleteProductImage,
  moveProductImage,
  prepareProductImageUpload,
  registerProductImage,
  setPrimaryProductImage,
  setProductActive,
  setProductFeatured,
  setProductPrice,
  setProductStock,
  updateProduct,
} from '@/lib/catalog/admin';
import { productFromForm, quickPriceFromForm, quickStockFromForm } from '@/lib/catalog/form';
import { validateProductInput } from '@/lib/catalog/validation';
import { toActionError } from '@/lib/admin/action-errors';
import type { ActionState } from '@/lib/admin/action-state';

// Server Actions de productos. Cada función de @/lib/catalog/admin vuelve a ejecutar requireAdmin()
// y escribe con la sesión del usuario (RLS): llamar a estas acciones sin ser administrador
// termina en una redirección al login, nunca en una escritura.

function refresh() {
  revalidatePath('/admin', 'layout');
  // el futuro catálogo público cacheará sus consultas con este tag
  updateTag('catalogo');
}

function id(formData: FormData) {
  return String(formData.get('id') ?? '');
}

function orphanWarning(orphanedFiles: number) {
  if (!orphanedFiles) return undefined;
  const texto = orphanedFiles === 1 ? 'No se pudo borrar 1 archivo' : `No se pudieron borrar ${orphanedFiles} archivos`;
  return `${texto} del almacenamiento. Podés reintentarlo con «Limpiar imágenes sin uso».`;
}

export async function saveProductAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const productId = id(formData);
  const { input, errors } = productFromForm(formData);
  const fieldErrors = { ...validateProductInput(input), ...errors };
  if (Object.keys(fieldErrors).length) return { status: 'error', message: 'Revisá los campos marcados.', fieldErrors };

  let newId: string | null = null;
  try {
    if (productId) await updateProduct(productId, input);
    else newId = await createProduct(input);
  } catch (error) {
    return toActionError(error);
  }
  refresh();
  if (newId) redirect(`/admin/productos/${newId}?creado=1`);
  return { status: 'ok', message: 'Cambios guardados.' };
}

export async function updatePriceAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = quickPriceFromForm(formData);
  if ('error' in parsed) return { status: 'error', message: parsed.error };
  try {
    await setProductPrice(id(formData), parsed.centavos);
  } catch (error) {
    return toActionError(error);
  }
  refresh();
  return { status: 'ok', message: 'Precio actualizado.' };
}

export async function updateStockAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const parsed = quickStockFromForm(formData);
  if ('error' in parsed) return { status: 'error', message: parsed.error };
  try {
    await setProductStock(id(formData), parsed.stock);
  } catch (error) {
    return toActionError(error);
  }
  refresh();
  return { status: 'ok', message: 'Stock actualizado.' };
}

export async function toggleProductActiveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const active = formData.get('value') === 'true';
  try {
    await setProductActive(id(formData), active);
  } catch (error) {
    return toActionError(error);
  }
  refresh();
  return { status: 'ok', message: active ? 'Producto activado.' : 'Producto desactivado.' };
}

export async function toggleProductFeaturedAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const featured = formData.get('value') === 'true';
  try {
    await setProductFeatured(id(formData), featured);
  } catch (error) {
    return toActionError(error);
  }
  refresh();
  return { status: 'ok', message: featured ? 'Marcado como destacado.' : 'Ya no es destacado.' };
}

export async function deleteProductAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let orphanedFiles = 0;
  try {
    ({ orphanedFiles } = await deleteProduct(id(formData)));
  } catch (error) {
    return toActionError(error);
  }
  refresh();
  redirect(`/admin/productos?eliminado=1${orphanedFiles ? `&huerfanos=${orphanedFiles}` : ''}`);
}

// ---------------------------------------------------------------------------
// Imágenes
// ---------------------------------------------------------------------------

export type UploadTicket = { ok: true; path: string; token: string } | { ok: false; message: string };

/** Paso 1 de la subida: devuelve una URL firmada de un solo uso para una ruta nueva del producto. */
export async function prepareImageUploadAction(productId: string, contentType: string, size: number): Promise<UploadTicket> {
  try {
    const ticket = await prepareProductImageUpload(productId, contentType, size);
    return { ok: true, ...ticket };
  } catch (error) {
    const state = toActionError(error);
    return { ok: false, message: state.status === 'error' ? state.message : 'No se pudo preparar la subida.' };
  }
}

/** Paso 3: registra en la base el archivo que el navegador ya subió. */
export async function registerImageAction(productId: string, path: string, altText: string | null): Promise<ActionState> {
  try {
    await registerProductImage(productId, path, altText);
  } catch (error) {
    return toActionError(error);
  }
  refresh();
  return { status: 'ok', message: 'Imagen agregada.' };
}

export async function setPrimaryImageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await setPrimaryProductImage(id(formData));
  } catch (error) {
    return toActionError(error);
  }
  refresh();
  return { status: 'ok', message: 'Imagen principal actualizada.' };
}

export async function moveImageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await moveProductImage(id(formData), formData.get('direction') === 'up' ? 'up' : 'down');
  } catch (error) {
    return toActionError(error);
  }
  refresh();
  return { status: 'ok', message: 'Orden actualizado.' };
}

export async function deleteImageAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  let orphanedFiles = 0;
  try {
    ({ orphanedFiles } = await deleteProductImage(id(formData)));
  } catch (error) {
    return toActionError(error);
  }
  refresh();
  return { status: 'ok', message: 'Imagen eliminada.', warning: orphanWarning(orphanedFiles) };
}

export async function cleanupImagesAction(_prev: ActionState, _formData: FormData): Promise<ActionState> {
  try {
    const { removed, failed } = await cleanupOrphanImages();
    if (failed) return { status: 'error', message: `Se borraron ${removed} archivos, pero ${failed} no se pudieron borrar. Intentá más tarde.` };
    return { status: 'ok', message: removed ? `Se borraron ${removed} archivos sin uso.` : 'No hay imágenes sin uso.' };
  } catch (error) {
    return toActionError(error);
  }
}
