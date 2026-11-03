export const paymentLabels: Record<string, string> = { pending: 'Pendiente de pago', approved: 'Pagado', expired: 'Vencido', cancelled: 'Cancelado' };
export const fulfillmentLabels: Record<string, string> = { pending: 'Por preparar', preparing: 'En preparación', shipped: 'Despachado', delivered: 'Entregado' };
export const resolutionLabels: Record<string, string> = { none: 'Sin incidencias', pending: 'Resolución pendiente', resolved: 'Resuelto' };
export const reasonLabels: Record<string, string> = { stock_shortage: 'Pago sin stock', duplicate_payment: 'Pago duplicado', amount_mismatch: 'Monto incorrecto' };
export const eventLabels: Record<string, string> = { created: 'Pedido creado', reservation_expired: 'Reserva vencida', cancelled: 'Pedido cancelado', payment_approved: 'Pago aprobado', payment_approved_late: 'Pago tardío aprobado', payment_rejected: 'Pago rechazado', payment_duplicate: 'Pago duplicado', payment_amount_mismatch: 'Monto incorrecto', stock_shortage: 'Faltante de stock', stock_shortage_resolved: 'Faltante resuelto', resolution_resolved: 'Incidencia resuelta', fulfillment_changed: 'Preparación actualizada', notes_updated: 'Notas actualizadas' };
export const PAGE_SIZE = 20;
export type Filters = { q: string; payment: string; fulfillment: string; resolution: string; from: string; to: string };
export function filtersFrom(input: unknown): Filters {
  const value: Record<string, unknown> = input && typeof input === 'object' && !Array.isArray(input) ? input as Record<string, unknown> : {};
  const text = (key: string) => typeof value[key] === 'string' ? (value[key] as string).trim() : '';
  const status = (key: string, labels: Record<string, string>) => Object.hasOwn(labels, text(key)) ? text(key) : '';
  const date = (key: string) => /^\d{4}-\d{2}-\d{2}$/.test(text(key)) && !isNaN(Date.parse(text(key))) && new Date(text(key)).toISOString().slice(0, 10) === text(key) ? text(key) : '';
  return { q: text('q').slice(0, 120), payment: status('payment', paymentLabels), fulfillment: status('fulfillment', fulfillmentLabels), resolution: status('resolution', resolutionLabels), from: date('from'), to: date('to') };
}
export function pageNumber(value: unknown) { return typeof value === 'string' && /^[1-9]\d{0,5}$/.test(value) ? Number(value) : 1; }
export function allowedOperations(o: { payment_status: string; stock_state: string; resolution_status: string; fulfillment_status: string }) {
  const result: string[] = [];
  if (o.payment_status === 'pending' && o.stock_state === 'reserved') result.push('cancel');
  if (o.stock_state === 'shortage') result.push('resolve_stock');
  if (o.payment_status === 'approved' && o.stock_state === 'consumed' && o.resolution_status !== 'pending') {
    if (o.fulfillment_status === 'pending') result.push('preparing');
    if (o.fulfillment_status === 'preparing') result.push('pending', 'shipped');
    if (o.fulfillment_status === 'shipped') result.push('delivered');
  }
  return result;
}
export function dateTime(value: string | null) { return value ? new Date(value).toLocaleString('es-AR', { timeZone: 'America/Argentina/Buenos_Aires' }) : '—'; }
