'use server';

import { revalidatePath, updateTag } from 'next/cache';
import { redirect } from 'next/navigation';
import { createCategory, deleteCategory, moveCategory, setCategoryActive, updateCategory } from '@/lib/catalog/admin';
import { categoryFromForm } from '@/lib/catalog/form';
import { validateCategoryInput } from '@/lib/catalog/validation';
import { toActionError } from '@/lib/admin/action-errors';
import type { ActionState } from '@/lib/admin/action-state';

// Server Actions de categorías. Igual que en productos, cada operación de @/lib/catalog/admin
// verifica requireAdmin() y escribe con la sesión del usuario (RLS).

function refresh() {
  revalidatePath('/admin', 'layout');
  updateTag('catalogo');
}

function id(formData: FormData) {
  return String(formData.get('id') ?? '');
}

export async function saveCategoryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const categoryId = id(formData);
  const { input } = categoryFromForm(formData);
  const fieldErrors = validateCategoryInput(input);
  if (Object.keys(fieldErrors).length) return { status: 'error', message: 'Revisá los campos marcados.', fieldErrors };

  try {
    if (categoryId) await updateCategory(categoryId, input);
    else await createCategory(input);
  } catch (error) {
    return toActionError(error);
  }
  refresh();
  if (!categoryId) redirect('/admin/categorias?creada=1');
  return { status: 'ok', message: 'Cambios guardados.' };
}

export async function toggleCategoryActiveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const active = formData.get('value') === 'true';
  try {
    await setCategoryActive(id(formData), active);
  } catch (error) {
    return toActionError(error);
  }
  refresh();
  return { status: 'ok', message: active ? 'Categoría activada.' : 'Categoría desactivada.' };
}

export async function moveCategoryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await moveCategory(id(formData), formData.get('direction') === 'up' ? 'up' : 'down');
  } catch (error) {
    return toActionError(error);
  }
  refresh();
  return { status: 'ok', message: 'Orden actualizado.' };
}

export async function deleteCategoryAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await deleteCategory(id(formData));
  } catch (error) {
    return toActionError(error);
  }
  refresh();
  redirect('/admin/categorias?eliminada=1');
}
