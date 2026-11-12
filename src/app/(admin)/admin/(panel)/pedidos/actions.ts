'use server';
import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requireAdmin } from '@/lib/catalog/admin';
import { operateOrder } from '@/lib/orders/admin';
import { changeAfterSales } from '@/lib/orders/after-sales';
import { filtersFrom } from '@/lib/orders/admin-model';
import type { ActionState } from '@/lib/admin/action-state';

export async function filterOrdersAction(form: FormData) {
  await requireAdmin();
  const filters = filtersFrom(Object.fromEntries(form));
  (await cookies()).set('admin-order-filters', JSON.stringify(filters), { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/admin/pedidos', maxAge: 3600 });
  redirect('/admin/pedidos');
}
export async function orderAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  try { await operateOrder(form); }
  catch (error) { return { status: 'error', message: error instanceof Error ? error.message : 'No se pudo guardar el pedido.' }; }
  revalidatePath('/admin/pedidos', 'layout');
  return { status: 'ok', message: 'Cambios guardados.' };
}

export async function afterSalesAction(_previous: ActionState, form: FormData): Promise<ActionState> {
  await requireAdmin();
  try {
    const result = await changeAfterSales(form);
    revalidatePath('/admin/pedidos');
    revalidatePath('/admin/pedidos/' + result.order);
    return { status: 'ok', message: result.message };
  } catch (error) {
    return { status: 'error', message: error instanceof Error ? error.message : 'No se pudo registrar la operación.' };
  }
}
