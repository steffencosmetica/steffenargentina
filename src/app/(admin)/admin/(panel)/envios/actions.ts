'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { formatArs, parsePesosInput } from '@/lib/money';
import {
  deleteShippingZone,
  moveShippingZone,
  saveShippingZone,
  setShippingZoneActive,
  simulateShippingQuote,
} from '@/lib/shipping/admin';
import { ZoneValidationError, describeZoneDbError } from '@/lib/shipping/errors';
import { ShippingQuoteError } from '@/lib/shipping/quote';
import { validateZoneInput, zoneFromForm } from '@/lib/shipping/validation';
import { toActionError } from '@/lib/admin/action-errors';
import type { ActionState } from '@/lib/admin/action-state';

// Server Actions de envíos. Cada operación de @/lib/shipping/admin verifica requireAdmin() y escribe
// con la sesión del usuario (RLS + is_admin() en la base).

function refresh() {
  revalidatePath('/admin/envios', 'layout');
}

function id(formData: FormData) {
  return String(formData.get('id') ?? '');
}

function zoneError(error: unknown): ActionState {
  if (error instanceof ZoneValidationError) {
    return { status: 'error', message: 'Revisá los campos marcados.', fieldErrors: error.errors };
  }
  const friendly = typeof error === 'object' && error !== null ? describeZoneDbError(error as { code?: string; message?: string }) : null;
  if (friendly) {
    return { status: 'error', message: friendly.message, fieldErrors: friendly.field ? { [friendly.field]: friendly.message } : undefined };
  }
  return toActionError(error);
}

export async function saveZoneAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const zoneId = id(formData) || null;
  const { input, errors } = zoneFromForm(formData);
  const fieldErrors = { ...validateZoneInput(input), ...errors };
  if (Object.keys(fieldErrors).length) return { status: 'error', message: 'Revisá los campos marcados.', fieldErrors };

  let result;
  try {
    result = await saveShippingZone(zoneId, input);
  } catch (error) {
    return zoneError(error);
  }
  refresh();
  if (!zoneId) redirect('/admin/envios?creada=1');
  const changes = [
    result.added.length && `${result.added.length} provincia${result.added.length === 1 ? '' : 's'} agregada${result.added.length === 1 ? '' : 's'}`,
    result.moved.length && `${result.moved.length} movida${result.moved.length === 1 ? '' : 's'} desde otra zona`,
    result.removed.length && `${result.removed.length} quitada${result.removed.length === 1 ? '' : 's'}`,
  ].filter(Boolean);
  return { status: 'ok', message: `Cambios guardados.${changes.length ? ` ${changes.join(', ')}.` : ''}` };
}

export async function toggleZoneActiveAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const active = formData.get('value') === 'true';
  try {
    await setShippingZoneActive(id(formData), active);
  } catch (error) {
    return toActionError(error);
  }
  refresh();
  return { status: 'ok', message: active ? 'Zona activada.' : 'Zona desactivada: sus provincias quedan sin cobertura.' };
}

export async function moveZoneAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await moveShippingZone(id(formData), formData.get('direction') === 'up' ? 'up' : 'down');
  } catch (error) {
    return toActionError(error);
  }
  refresh();
  return { status: 'ok', message: 'Orden actualizado.' };
}

export async function deleteZoneAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  try {
    await deleteShippingZone(id(formData));
  } catch (error) {
    return toActionError(error);
  }
  refresh();
  redirect('/admin/envios?eliminada=1');
}

/** Simulador del panel: muestra exactamente lo que cotizaría el checkout. */
export async function simulateQuoteAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const province = String(formData.get('province') ?? '');
  const subtotal = parsePesosInput(String(formData.get('subtotal') ?? ''));
  if (subtotal === null) return { status: 'error', message: 'Escribí el subtotal como 25.000 o 25.000,50.' };
  try {
    const quote = await simulateShippingQuote(province, subtotal);
    if (!quote.hasCoverage) return { status: 'error', message: 'Sin cobertura: el checkout no permitirá confirmar pedidos a esta provincia.' };
    const detalle = quote.isFree
      ? `Envío gratis (zona ${quote.zone.name}: gratis desde ${formatArs(quote.freeFromCentavos!)})`
      : `Envío ${formatArs(quote.costCentavos)} (zona ${quote.zone.name}${quote.freeFromCentavos !== null ? `, gratis desde ${formatArs(quote.freeFromCentavos)}` : ''})`;
    return { status: 'ok', message: detalle };
  } catch (error) {
    if (error instanceof ShippingQuoteError) return { status: 'error', message: error.message };
    return toActionError(error);
  }
}
