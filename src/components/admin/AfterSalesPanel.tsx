'use client';

import { useActionState, useState, type ReactNode } from 'react';
import { afterSalesAction } from '@/app/(admin)/admin/(panel)/pedidos/actions';
import { formatArs, parsePesosInput } from '@/lib/money';
import { dateTime } from '@/lib/orders/admin-model';
import { documentationLabels, disputeLabels, refundErrorLabels, refundLabels, returnLabels, type AfterSales } from '@/lib/orders/after-sales-model';

function ActionForm({ order, id, operation, children, label, ready = true }: {
  order: string; id: string; operation: string; children?: ReactNode; label: string; ready?: boolean;
}) {
  const [state, action, pending] = useActionState(afterSalesAction, { status: 'idle' });
  return <form action={action} className="adm-stack">
    <input type="hidden" name="order" value={order} /><input type="hidden" name="id" value={id} />
    <input type="hidden" name="operation" value={operation} />
    {children}
    {ready && <button type="submit" className="adm-btn" disabled={pending}>{pending ? 'Guardando…' : label}</button>}
    {state.status !== 'idle' && <p role={state.status === 'error' ? 'alert' : 'status'}>{state.message}</p>}
  </form>;
}

function RefundRequest({ order, id, data, shortage }: { order: string; id: string; data: AfterSales; shortage: boolean }) {
  const [kind, setKind] = useState('full');
  const [amount, setAmount] = useState('');
  const [payment, setPayment] = useState(data.transactions[0]?.id ?? '');
  const [reason, setReason] = useState('');
  const [review, setReview] = useState(false);
  const cents = kind === 'full' ? data.balance : parsePesosInput(amount);
  const transaction = data.transactions.find(item => item.id === payment);
  const limit = kind === 'full' ? data.balance : Math.min(data.balance, (transaction?.paid ?? 0) - (transaction?.refunded ?? 0));
  return <ActionForm order={order} id={id} operation="refund_request" label="Enviar reintegro simulado" ready={review}>
    <input type="hidden" name="expected" value={data.refunded} />
    <label>Tipo de reintegro <select name="kind" value={kind} onChange={event => { setKind(event.target.value); setReview(false); }}>
      <option value="full">Total del saldo disponible</option><option value="partial">Parcial</option>
    </select></label>
    {kind === 'partial' && <>
      <label>Transacción <select name="payment" value={payment} onChange={event => { setPayment(event.target.value); setReview(false); }}>
        {data.transactions.map(item => <option key={item.id} value={item.id}>{item.id} · {formatArs(item.paid - item.refunded)}</option>)}
      </select></label>
      <label>Importe parcial <input name="amount" value={amount} inputMode="decimal" required maxLength={24}
        onChange={event => { setAmount(event.target.value); setReview(false); }} /></label>
    </>}
    <label>Motivo del reintegro <textarea name="reason" required minLength={8} maxLength={400}
      value={reason} onChange={event => { setReason(event.target.value); setReview(false); }} /></label>
    {shortage && <label><input type="checkbox" name="contact" value="yes" required /> Contacté al comprador por el faltante.</label>}
    <button type="button" className="adm-btn adm-btn-secondary" disabled={!cents || cents > limit || reason.trim().length < 8}
      onClick={() => setReview(true)}>Revisar reintegro</button>
    {review && cents ? <div role="group" aria-label="Confirmación de reintegro">
      <p>{kind === 'full' ? 'Total del saldo' : 'Parcial'} · {formatArs(cents)} · {reason.trim()}</p>
      <label><input type="checkbox" name="confirm" value="yes" required /> Confirmo el envío del reintegro simulado.</label>
    </div> : null}
  </ActionForm>;
}

const physicalActions: Record<string, [string, string]> = {
  requested: ['coordinate', 'Marcar coordinada'], coordinated: ['receive', 'Registrar recepción'],
  received: ['inspect', 'Registrar inspección'], inspected: ['resolve', 'Resolver devolución'],
};

export default function AfterSalesPanel({ order, refundKey, returnKey, data, items, dispatched, shortage }: {
  order: string; refundKey: string; returnKey: string; data: AfterSales;
  items: { id: string; name: string; quantity: number }[]; dispatched: boolean; shortage: boolean;
}) {
  const incidents = data.events.filter(event => event.kind.endsWith('_mismatch') || event.kind === 'refund_chargeback_overlap');
  return <section className="adm-card adm-card-body adm-stack adm-posventa" aria-label="Posventa simulada">
    <h2>Posventa simulada</h2>
    <dl className="adm-order-summary"><dt>Acreditado</dt><dd>{formatArs(data.paid)}</dd>
      <dt>Reembolsado</dt><dd>{formatArs(data.refunded)}</dd><dt>Saldo financiero</dt><dd>{formatArs(data.balance)}</dd></dl>
    <h3>Reintegros</h3>
    {dispatched && <p>Pedido despachado. Evaluá el motivo y la gestión individual antes de confirmar.</p>}
    {!data.blocked && data.balance > 0 && <RefundRequest key={refundKey} order={order} id={refundKey} data={data} shortage={shortage} />}
    {data.blocked && data.balance > 0 && <p>Solicitud de reintegro bloqueada. Revisá las operaciones y disputas abiertas.</p>}
    {data.requests.map(request => <div key={request.id}>
      <p><strong>{refundLabels[request.state]}</strong> · {request.kind === 'full' ? 'Total del saldo' : 'Parcial'} · {formatArs(request.cents)} · {dateTime(request.created_at)}</p>
      <p>{request.reason}{request.error && ` · ${refundErrorLabels[request.error] ?? 'La operación requiere revisión.'}`}</p>
      {['requested','unknown','processing'].includes(request.state) && <p role="status">Resultado pendiente de conciliación. Revisá el historial antes de repetir la operación.</p>}
      {['requested','unknown','processing'].includes(request.state) && <ActionForm order={order} id={request.id}
        operation="refund_resume" label="Conciliar y retomar el mismo reintegro">
        <label><input type="checkbox" name="confirm" value="yes" required /> Confirmo retomar este mismo reintegro.</label>
      </ActionForm>}
    </div>)}
    {data.external.map(refund => <p key={refund.id}>Reintegro externo confirmado · {formatArs(refund.cents)} · {dateTime(refund.confirmed_at)}</p>)}
    <h3>Devoluciones físicas</h3>
    <p>La recepción y la inspección registran unidades físicas. La reincorporación al inventario requiere una integración administrativa pendiente.</p>
    {dispatched && <ActionForm order={order} id={returnKey} operation="return_request" label="Registrar devolución">
      <label>Artículo <select name="item" required>{items.map(item => <option key={item.id} value={item.id}>{item.name} · {item.quantity} compradas</option>)}</select></label>
      <label>Cantidad <input name="quantity" type="number" min={1} step={1} required /></label>
      <label>Motivo de devolución <input name="reason" minLength={5} maxLength={400} required /></label>
    </ActionForm>}
    {data.returns.map(entry => {
      const next = physicalActions[entry.state];
      return <div key={entry.id}><p><strong>{returnLabels[entry.state]}</strong> · {items.find(item => item.id === entry.item_id)?.name} × {entry.quantity}</p>
        <p>{entry.reason}</p>
        {entry.received_at && <p>Recepción · {dateTime(entry.received_at)}</p>}
        {entry.inspected_at && <p>Inspección · {dateTime(entry.inspected_at)} · Aptas {entry.suitable} · No aptas {entry.unsuitable}</p>}
        {entry.notes && <p>{entry.notes}</p>}
        {next && <ActionForm order={order} id={entry.id} operation={`return_${next[0]}`} label={next[1]}>
          {entry.state === 'received' && <>
            <label>Condición <select name="condition" required><option value="sealed">Sellado</option><option value="opened">Abierto</option>
              <option value="used">Usado</option><option value="damaged">Dañado</option><option value="mixed">Lote mixto</option></select></label>
            <label>Unidades aptas <input name="suitable" type="number" min={0} max={entry.quantity} required /></label>
          </>}
          <label>Observaciones <input name="notes" maxLength={500} /></label>
        </ActionForm>}
      </div>;
    })}
    <h3>Contracargos</h3>
    {data.cases.length === 0 && <p>Sin contracargos registrados.</p>}
    {data.cases.map(dispute => <div key={dispute.id}>
      <p><strong>{disputeLabels[dispute.status]}</strong> · {formatArs(dispute.cents)} · {documentationLabels[dispute.documentation]}</p>
      <p>Abierto {dateTime(dispute.opened_at)} · Plazo {dateTime(dispute.deadline)} · Impacto confirmado {formatArs(dispute.impact_cents)}</p>
      {data.events.filter(event => event.subject === dispute.id && event.kind === 'chargeback_note').map(event =>
        <p key={event.id}>{dateTime(event.created_at)} · {event.details.note}{event.details.reference && ` · ${event.details.reference}`}</p>)}
      <ActionForm order={order} id={dispute.id} operation="chargeback_note" label="Guardar observación">
        <label>Observación del contracargo <input name="notes" minLength={5} maxLength={500} required /></label>
        <label>Referencia interna de evidencia <input name="reference" maxLength={120} /></label>
      </ActionForm>
    </div>)}
    {incidents.length > 0 && <div role="status"><strong>Requiere intervención</strong>
      <ul>{incidents.map(event => <li key={event.id}>{dateTime(event.created_at)} · {event.kind === 'refund_chargeback_overlap'
        ? 'Reintegro y contracargo sobre el mismo pago' : 'Evidencia financiera inconsistente'}</li>)}</ul>
    </div>}
  </section>;
}
