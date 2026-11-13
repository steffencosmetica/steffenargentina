import Link from 'next/link';
import { randomUUID } from 'node:crypto';
import { notFound } from 'next/navigation';
import { requireAdmin } from '@/lib/catalog/admin';
import { getOrder } from '@/lib/orders/admin';
import { dateTime, eventLabels, fulfillmentLabels, paymentLabels, reasonLabels, resolutionLabels } from '@/lib/orders/admin-model';
import { formatArs, parseCentavos } from '@/lib/money';
import OrderControls, { CopyData } from '@/components/admin/OrderControls';
import AfterSalesPanel from '@/components/admin/AfterSalesPanel';
import { readAfterSales } from '@/lib/orders/after-sales';
import OrderOfficePanel from '@/components/admin/OrderOfficePanel';
import { readOrderOffice } from '@/lib/orders/office';

export const metadata = { title: 'Detalle de pedido' };
export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const detail = await getOrder(id);
  if (!detail) notFound();
  const { order: o, items, events, province } = detail;
  const afterSales = await readAfterSales(id);
  const office = await readOrderOffice(id);
  const money = (value: number) => formatArs(parseCentavos(String(value)));
  const address = `${o.ship_street} ${o.ship_number}${o.ship_unit ? `, ${o.ship_unit}` : ''}, ${o.ship_city}, ${province}, CP ${o.ship_postal_code}${o.ship_notes ? `. ${o.ship_notes}` : ''}`;
  return <>
    <Link href="/admin/pedidos" className="adm-back">← Pedidos</Link>
    <div className="adm-page-header"><div><h1>{o.code}</h1><p>{dateTime(o.created_at)}</p><p>{paymentLabels[o.payment_status]} · {fulfillmentLabels[o.fulfillment_status]} · {resolutionLabels[o.resolution_status]}</p></div></div>
    {o.resolution_reason && <div className="adm-notice adm-notice-warning adm-block" role="status"><div>{reasonLabels[o.resolution_reason]}{o.resolution_status === 'resolved' ? ' · Resuelto' : afterSales ? ' · Requiere gestión individual' : o.resolution_reason === 'duplicate_payment' ? ' · reintegro pendiente de Fase 5' : o.resolution_reason === 'amount_mismatch' ? ' · revisión y posible reintegro pendientes de Fase 5' : ''}<p>{afterSales ? 'Consultá el detalle financiero antes de acordar una solución con el comprador.' : 'Los pagos y reembolsos se gestionarán con Mercado Pago en la Fase 5.'}</p></div></div>}
    <div className="adm-order-detail"><div className="adm-stack">
      <section className="adm-card adm-card-body"><h2>Comprador</h2><p>{o.buyer_name}</p><p>{o.buyer_email}</p><p>{o.buyer_phone}</p><CopyData label="Copiar contacto" text={`${o.buyer_name}\n${o.buyer_email}\n${o.buyer_phone}`} /></section>
      <section className="adm-card adm-card-body"><h2>Entrega</h2><p>{o.ship_street} {o.ship_number}</p><p>Piso / departamento: {o.ship_unit ?? '—'}</p><p>{o.ship_city} · {province} · CP {o.ship_postal_code}</p><p>Indicaciones: {o.ship_notes ?? '—'}</p><p>Zona histórica: {o.shipping_zone_name}</p><CopyData label="Copiar dirección" text={address} /></section>
      <section className="adm-card adm-card-body"><h2>Artículos e importes históricos</h2><ul className="adm-order-items">{items.map(item => <li key={item.id}><strong>{item.name}</strong><p>SKU: {item.sku} · {item.quantity} × {money(item.unit_price_ars)}</p><p>{money(item.line_total_ars)}</p></li>)}</ul><dl className="adm-order-summary"><dt>Subtotal</dt><dd>{money(o.subtotal_ars)}</dd><dt>Envío</dt><dd>{money(o.shipping_ars)}</dd><dt>Total</dt><dd><strong>{money(o.total_ars)}</strong></dd></dl></section>
      <section className="adm-card adm-card-body"><h2>Despacho y fechas operativas</h2><p>Transportista: {o.dispatch_carrier ?? '—'}</p><p>Seguimiento: {o.dispatch_tracking ?? '—'}</p><dl className="adm-order-summary">{([['Vencimiento de reserva', o.reservation_expires_at], ['Pago', o.paid_at], ['Cancelación', o.cancelled_at], ['Liberación de stock', o.stock_released_at], ['Despacho', o.dispatched_at], ['Entrega', o.delivered_at]] as const).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{dateTime(value)}</dd></div>)}</dl><p>Fechas del pedido expresadas en hora de Argentina.</p></section>
      {afterSales && <AfterSalesPanel order={id} refundKey={randomUUID()} returnKey={randomUUID()}
        data={afterSales} items={items} dispatched={['shipped','delivered'].includes(o.fulfillment_status)} shortage={o.resolution_reason === 'stock_shortage'} />}
      <section className="adm-card adm-card-body"><h2>Historial de movimientos</h2><ol className="adm-order-events">{events.map(event => { const data = event.data && typeof event.data === 'object' && !Array.isArray(event.data) ? event.data : {}; return <li key={event.id}><strong>{eventLabels[event.event_type] ?? 'Movimiento del pedido'}</strong><p>{dateTime(event.created_at)} · {event.actor === 'admin' ? 'Administrador' : event.actor === 'payment' ? 'Pago' : event.actor === 'checkout' ? 'Checkout' : 'Sistema'}</p>{typeof data.to === 'string' && fulfillmentLabels[data.to] && <p>{fulfillmentLabels[data.to]}</p>}</li>; })}</ol></section>
      {office && <OrderOfficePanel order={id} version={o.admin_version} dispatched={['shipped','delivered'].includes(o.fulfillment_status)} carrier={o.dispatch_carrier} tracking={o.dispatch_tracking} email={o.buyer_email} data={office} />}
    </div><OrderControls key={o.id} order={o} /></div>
  </>;
}
