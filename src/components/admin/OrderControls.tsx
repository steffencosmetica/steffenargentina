'use client';
import { useActionState, useState } from 'react';
import { useRouter } from 'next/navigation';
import { orderAction } from '@/app/(admin)/admin/(panel)/pedidos/actions';
import { IDLE } from '@/lib/admin/action-state';
import type { AdminOrder } from '@/lib/orders/admin';
import { allowedOperations } from '@/lib/orders/admin-model';
import { ActionNotice, ConfirmButton, SubmitButton } from './ui';

export function CopyData({ text, label }: { text: string; label: string }) {
  const [message, setMessage] = useState('');
  return <><button className="adm-btn adm-btn-sm" type="button" onClick={async () => { try { await navigator.clipboard.writeText(text); setMessage('Copiado.'); } catch { setMessage('No se pudo copiar. Seleccioná el texto.'); } }}>{label}</button><span role="status">{message}</span></>;
}
const labels: Record<string, string> = { cancel: 'Cancelar pedido', preparing: 'Comenzar preparación', pending: 'Volver a por preparar', shipped: 'Registrar despacho', delivered: 'Marcar entregado', resolve_stock: 'Resolver faltante con stock disponible' };
function Operation({ order, operation }: { order: AdminOrder; operation: string }) {
  const [state, action] = useActionState(orderAction, IDLE);
  const router = useRouter();
  return <form action={action} className="adm-stack-sm">
    <input type="hidden" name="id" value={order.id} /><input type="hidden" name="version" value={order.admin_version} /><input type="hidden" name="operation" value={operation} />
    {operation === 'shipped' && <><label>Transportista<input className="adm-input" name="carrier" maxLength={80} required /></label><label>Código de seguimiento (opcional)<input className="adm-input" name="tracking" maxLength={120} /></label><label>Fecha de despacho (hora local del dispositivo)<input className="adm-input" type="datetime-local" name="dispatch_local" required onChange={e => { const target = e.currentTarget.form?.elements.namedItem('dispatched_at') as HTMLInputElement; target.value = e.target.value ? new Date(e.target.value).toISOString() : ''; }} /><input type="hidden" name="dispatched_at" /></label></>}
    <ActionNotice state={state} />
    <ConfirmButton title={labels[operation]} description="Se verificará el estado actual y se registrará la operación en el historial." confirmLabel="Confirmar" className="adm-btn" disabled={state.status === 'ok'}>{labels[operation]}</ConfirmButton>
    {state.status === 'error' && <button className="adm-btn" type="button" onClick={() => router.refresh()}>Recargar pedido</button>}
  </form>;
}
export default function OrderControls({ order }: { order: AdminOrder }) {
  const [state, action] = useActionState(orderAction, IDLE);
  return <div className="adm-stack">
    <section className="adm-card adm-card-body adm-stack-sm"><h2>Operaciones</h2>
      {allowedOperations(order).length === 0 && <p>No hay transiciones disponibles para este estado.</p>}
      {allowedOperations(order).map(operation => <Operation key={`${operation}-${order.admin_version}`} order={order} operation={operation} />)}
    </section>
    <section className="adm-card adm-card-body"><h2>Notas internas</h2><form action={action} className="adm-stack-sm">
      <input type="hidden" name="id" value={order.id} /><input type="hidden" name="version" value={order.admin_version} /><input type="hidden" name="operation" value="notes" />
      <label htmlFor="notes">Notas (hasta 2000 caracteres)</label><textarea className="adm-input" id="notes" name="notes" maxLength={2000} rows={6} defaultValue={order.admin_notes ?? ''} />
      <ActionNotice state={state} /><SubmitButton>Guardar notas</SubmitButton>
      {state.status === 'error' && <p>Copiá tus notas antes de recargar si querés conservar el borrador.</p>}
    </form></section>
  </div>;
}
