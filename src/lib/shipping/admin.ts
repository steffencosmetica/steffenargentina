import 'server-only';
import { centavosToDecimal, parseCentavos } from '@/lib/money';
import { AdminActionError, assertUuid, requireAdmin } from '@/lib/catalog/admin';
import { quoteShipping, type ShippingQuote } from './quote';
import { validateZoneInput, type ZoneInput } from './validation';
import { ZoneValidationError } from './errors';

// Administración de zonas y tarifas de envío, para Server Actions.
// Mismo doble control que @/lib/catalog/admin: requireAdmin() acá, y RLS + is_admin() en la base.

export type AdminZone = {
  id: string;
  name: string;
  priceCentavos: number;
  freeFromCentavos: number | null;
  isActive: boolean;
  sortOrder: number;
  provinces: { code: string; name: string }[];
};

export type AdminProvince = { code: string; name: string; zoneId: string | null };

function decimal(centavos: number) {
  // numeric(12,2) exacto como texto; los tipos generados lo declaran number
  return centavosToDecimal(centavos) as unknown as number;
}

type ZoneRow = {
  id: string;
  name: string;
  price_ars: string;
  free_from_ars: string | null;
  is_active: boolean;
  sort_order: number;
  provinces: { province: { code: string; name: string } }[];
};

function toZone(row: ZoneRow): AdminZone {
  return {
    id: row.id,
    name: row.name,
    priceCentavos: parseCentavos(row.price_ars),
    freeFromCentavos: row.free_from_ars === null ? null : parseCentavos(row.free_from_ars),
    isActive: row.is_active,
    sortOrder: row.sort_order,
    provinces: row.provinces.map((p) => p.province).sort((a, b) => a.name.localeCompare(b.name, 'es')),
  };
}

const ZONE_SELECT =
  'id, name, price_ars::text, free_from_ars::text, is_active, sort_order, provinces:shipping_zone_provinces ( province:provinces ( code, name ) )';

export async function listShippingZones(): Promise<AdminZone[]> {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase
    .from('shipping_zones')
    .select(ZONE_SELECT)
    .order('sort_order')
    .order('name')
    .overrideTypes<ZoneRow[], { merge: false }>();
  if (error) throw error;
  return data.map(toZone);
}

export async function getShippingZone(id: string): Promise<AdminZone | null> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase
    .from('shipping_zones')
    .select(ZONE_SELECT)
    .eq('id', id)
    .maybeSingle()
    .overrideTypes<ZoneRow | null, { merge: false }>();
  if (error) throw error;
  return data ? toZone(data) : null;
}

/** Las 24 provincias con la zona que las cubre (o null). */
export async function listProvincesWithZone(): Promise<AdminProvince[]> {
  const { supabase } = await requireAdmin();
  const [provinces, assigned] = await Promise.all([
    supabase.from('provinces').select('code, name').order('name'),
    supabase.from('shipping_zone_provinces').select('province_code, zone_id'),
  ]);
  if (provinces.error) throw provinces.error;
  if (assigned.error) throw assigned.error;
  const zoneOf = new Map(assigned.data.map((a) => [a.province_code, a.zone_id]));
  return provinces.data.map((p) => ({ code: p.code, name: p.name, zoneId: zoneOf.get(p.code) ?? null }));
}

/**
 * Crea (id null) o edita una zona con sus provincias, en una sola transacción (admin_save_zone).
 * Si alguna provincia está en otra zona y no se confirmó mover (input.move), falla sin cambiar nada.
 */
export async function saveShippingZone(id: string | null, input: ZoneInput) {
  if (id) assertUuid(id);
  const errors = validateZoneInput(input);
  if (Object.keys(errors).length) throw new ZoneValidationError(errors);
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase
    .rpc('admin_save_zone', {
      p_id: id as unknown as string,
      p_name: input.name,
      p_price_ars: decimal(input.priceCentavos),
      p_free_from_ars: (input.freeFromCentavos === null ? null : decimal(input.freeFromCentavos)) as unknown as number,
      p_is_active: input.isActive,
      p_codes: input.provinces,
      p_move: input.move,
    })
    .single();
  if (error) throw error;
  return { zoneId: data.zone_id, added: data.added ?? [], removed: data.removed ?? [], moved: data.moved ?? [] };
}

export async function setShippingZoneActive(id: string, isActive: boolean) {
  assertUuid(id);
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.from('shipping_zones').update({ is_active: isActive }).eq('id', id).select('id');
  if (error) throw error;
  if (!data.length) throw new AdminActionError('La zona ya no existe.');
}

/** Sube o baja una zona un lugar (reescribe el orden 10, 20, 30… solo donde cambia). */
export async function moveShippingZone(id: string, direction: 'up' | 'down') {
  assertUuid(id);
  const { supabase } = await requireAdmin();
  const { data: rows, error } = await supabase.from('shipping_zones').select('id, sort_order').order('sort_order').order('name');
  if (error) throw error;
  const ids = rows.map((r) => r.id);
  const index = ids.indexOf(id);
  const target = direction === 'up' ? index - 1 : index + 1;
  if (index === -1 || target < 0 || target >= ids.length) return;
  [ids[index], ids[target]] = [ids[target], ids[index]];
  const current = new Map(rows.map((r) => [r.id, r.sort_order]));
  for (const [i, zoneId] of ids.entries()) {
    const sortOrder = (i + 1) * 10;
    if (current.get(zoneId) === sortOrder) continue;
    const { error: updateError } = await supabase.from('shipping_zones').update({ sort_order: sortOrder }).eq('id', zoneId);
    if (updateError) throw updateError;
  }
}

/** Borra una zona sin provincias. Con provincias, la base lo impide (on delete restrict). */
export async function deleteShippingZone(id: string) {
  assertUuid(id);
  const { supabase } = await requireAdmin();
  const { data: assigned, error: countError } = await supabase.from('shipping_zone_provinces').select('province_code').eq('zone_id', id);
  if (countError) throw countError;
  if (assigned.length) {
    throw new AdminActionError(
      `La zona cubre ${assigned.length} provincia${assigned.length === 1 ? '' : 's'}: quitalas antes de eliminarla, o desactivá la zona.`,
    );
  }
  const { data, error } = await supabase.from('shipping_zones').delete().eq('id', id).select('id');
  if (error) throw error;
  if (!data.length) throw new AdminActionError('La zona ya no existe.');
}

/** Simulador del panel: la misma cotización que usará el checkout. */
export async function simulateShippingQuote(provinceCode: string, subtotalCentavos: number): Promise<ShippingQuote> {
  await requireAdmin();
  return quoteShipping(provinceCode, subtotalCentavos);
}
