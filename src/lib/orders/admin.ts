import 'server-only';
import { assertUuid, requireAdmin } from '@/lib/catalog/admin';
import type { Database } from '@/lib/supabase/database.types';
import type { Filters } from './admin-model';

type OrderRow = Database['public']['Tables']['orders']['Row'];
export type AdminOrder = Pick<OrderRow, 'id' | 'code' | 'created_at' | 'buyer_name' | 'buyer_email' | 'buyer_phone' | 'ship_street' | 'ship_number' | 'ship_unit' | 'ship_city' | 'ship_postal_code' | 'ship_province_code' | 'ship_notes' | 'shipping_zone_name' | 'subtotal_ars' | 'shipping_ars' | 'total_ars' | 'payment_status' | 'fulfillment_status' | 'resolution_status' | 'resolution_reason' | 'stock_state' | 'reservation_expires_at' | 'paid_at' | 'cancelled_at' | 'stock_released_at' | 'dispatch_carrier' | 'dispatch_tracking' | 'dispatched_at' | 'delivered_at' | 'admin_notes'> & { admin_version: number };
export type ListRow = Pick<AdminOrder, 'id' | 'code' | 'created_at' | 'buyer_name' | 'buyer_email' | 'total_ars' | 'payment_status' | 'fulfillment_status' | 'resolution_status'>;
const SELECT = 'id,code,created_at,buyer_name,buyer_email,buyer_phone,ship_street,ship_number,ship_unit,ship_city,ship_postal_code,ship_province_code,ship_notes,shipping_zone_name,subtotal_ars,shipping_ars,total_ars,payment_status,fulfillment_status,resolution_status,resolution_reason,stock_state,reservation_expires_at,paid_at,cancelled_at,stock_released_at,dispatch_carrier,dispatch_tracking,dispatched_at,delivered_at,admin_notes,admin_version' as const;
export async function listOrders(filters: Filters, page: number) {
  const { supabase } = await requireAdmin();
  const { data, error } = await supabase.rpc('admin_listar_pedidos', { p_filters: filters, p_page: page });
  if (error) throw new Error('No se pudieron consultar los pedidos.');
  return data as unknown as { rows: ListRow[]; count: number; to_prepare: number; to_resolve: number };
}
export async function getOrder(id: string) {
  const { supabase } = await requireAdmin();
  assertUuid(id);
  const { data: order, error } = await supabase.from('orders').select(SELECT).eq('id', id).maybeSingle();
  if (error) throw new Error('No se pudo consultar el pedido.');
  if (!order) return null;
  const results = await Promise.all([
    supabase.from('order_items').select('id,sku,name,quantity,unit_price_ars,line_total_ars').eq('order_id', id).order('id'),
    supabase.from('order_events').select('id,created_at,event_type,actor,data').eq('order_id', id).order('created_at').order('id'),
    supabase.from('provinces').select('name').eq('code', order.ship_province_code).single(),
  ]);
  if (results.some(r => r.error)) throw new Error('No se pudo consultar el detalle.');
  return { order: order as AdminOrder, items: results[0].data!, events: results[1].data!, province: results[2].data!.name };
}
export async function operateOrder(form: FormData) {
  const { supabase } = await requireAdmin();
  const id = String(form.get('id') ?? '');
  assertUuid(id);
  const version = Number(form.get('version'));
  if (!form.has('version') || !Number.isSafeInteger(version) || version < 0) throw new Error('Versión inválida');
  const timestamp = String(form.get('dispatched_at') ?? '');
  if (timestamp && !Number.isFinite(Date.parse(timestamp))) throw new Error('Fecha de despacho inválida.');
  const { error } = await supabase.rpc('admin_operar_pedido', {
    p_order_id: id, p_version: version, p_operation: String(form.get('operation') ?? ''),
    p_notes: String(form.get('notes') ?? ''), p_carrier: String(form.get('carrier') ?? ''), p_tracking: String(form.get('tracking') ?? ''),
    ...(timestamp ? { p_dispatched_at: new Date(timestamp).toISOString() } : {}),
  });
  if (error) {
    const messages: Record<string, string> = { SR004: 'El pedido cambió. Recargá la página y revisá los datos antes de continuar.', '55000': 'La operación ya no está disponible. Revisá el pago, el stock y las incidencias.', SR002: 'La transición no está permitida.', '22023': 'Revisá las notas, el transporte y la fecha de despacho.', '42501': 'No tenés permisos para esta operación.' };
    throw new Error(messages[error.code] ?? 'No se pudo guardar el pedido.');
  }
}
