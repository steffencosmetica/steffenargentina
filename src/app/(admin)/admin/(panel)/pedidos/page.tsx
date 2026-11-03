import Link from 'next/link';
import { cookies } from 'next/headers';
import { requireAdmin } from '@/lib/catalog/admin';
import { listOrders } from '@/lib/orders/admin';
import { dateTime, filtersFrom, fulfillmentLabels, PAGE_SIZE, pageNumber, paymentLabels, resolutionLabels } from '@/lib/orders/admin-model';
import { formatArs, parseCentavos } from '@/lib/money';
import { filterOrdersAction } from './actions';

export const metadata = { title: 'Pedidos' };
export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ page?: string }> }) {
  await requireAdmin();
  let saved = {};
  try { saved = JSON.parse((await cookies()).get('admin-order-filters')?.value ?? '{}'); } catch { /* filtros vacíos */ }
  const filters = filtersFrom(saved);
  const page = pageNumber((await searchParams).page);
  const result = await listOrders(filters, page);
  const pages = Math.max(1, Math.ceil(result.count / PAGE_SIZE));
  return <>
    <div className="adm-page-header"><div><h1>Pedidos</h1><p>Consultá y gestioná la preparación de los pedidos.</p></div></div>
    <div className="adm-order-stats adm-block"><div className="adm-card adm-card-body"><strong>{result.to_prepare}</strong> pagados por preparar</div><div className="adm-card adm-card-body"><strong>{result.to_resolve}</strong> pendientes de resolución</div></div>
    <form action={filterOrdersAction} className="adm-card adm-card-body adm-order-filters adm-block">
      <label>Buscar por código, nombre o email<input className="adm-input" name="q" maxLength={120} defaultValue={filters.q} /></label>
      {([['payment', 'Pago', paymentLabels], ['fulfillment', 'Preparación', fulfillmentLabels], ['resolution', 'Resolución', resolutionLabels]] as const).map(([name, label, options]) => <label key={name}>{label}<select aria-label={label} className="adm-input" name={name} defaultValue={filters[name]}><option value="">Todos</option>{Object.entries(options).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>)}
      <label>Desde<input className="adm-input" type="date" name="from" defaultValue={filters.from} /></label><label>Hasta<input className="adm-input" type="date" name="to" defaultValue={filters.to} /></label>
      <button className="adm-btn adm-btn-primary">Aplicar filtros</button><button className="adm-btn" formAction={async () => { 'use server'; await filterOrdersAction(new FormData()); }}>Limpiar filtros</button>
    </form>
    <section className="adm-card adm-block"><div className="adm-card-body"><h2>{result.count} pedidos</h2></div>
      {result.rows.length === 0 ? <div className="adm-empty"><strong>No hay pedidos para mostrar</strong><p>Revisá los filtros o volvé a la primera página.</p><Link href="/admin/pedidos">Primera página</Link></div> : <div className="adm-order-table"><table><thead><tr><th>Pedido</th><th>Comprador</th><th>Total</th><th>Pago</th><th>Preparación</th><th>Resolución</th></tr></thead><tbody>{result.rows.map(o => <tr key={o.id}><td data-label="Pedido"><Link href={`/admin/pedidos/${o.id}`}><strong>{o.code}</strong></Link><small>{dateTime(o.created_at)}</small></td><td data-label="Comprador">{o.buyer_name}<small>{o.buyer_email}</small></td><td data-label="Total">{formatArs(parseCentavos(String(o.total_ars)))}</td><td data-label="Pago">{paymentLabels[o.payment_status]}</td><td data-label="Preparación">{fulfillmentLabels[o.fulfillment_status]}</td><td data-label="Resolución">{resolutionLabels[o.resolution_status]}</td></tr>)}</tbody></table></div>}
    </section><nav className="adm-order-pagination" aria-label="Páginas de pedidos">{page > 1 && <Link className="adm-btn" href={`?page=${page - 1}`}>Anterior</Link>}<span>Página {page} de {pages}</span>{page < pages && <Link className="adm-btn" href={`?page=${page + 1}`}>Siguiente</Link>}</nav>
  </>;
}
