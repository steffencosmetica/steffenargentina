'use client';
import {useActionState,type ReactNode} from 'react';
import {orderOfficeAction} from '@/app/(admin)/admin/(panel)/pedidos/actions';
import {type OrderOffice,mailStatusLabels,messageLabels} from '@/lib/orders/office-model';
import {formatArs,centavosToDecimal} from '@/lib/money';
import {dateTime} from '@/lib/orders/admin-model';
function LocalDateTime({label}:{label:string}){
 return <label>{label}<input className="adm-input" name="date_local" type="datetime-local" required onChange={event=>{
  const hidden=event.currentTarget.form?.elements.namedItem('date') as HTMLInputElement|null;
  if(hidden)hidden.value=event.target.value?new Date(event.target.value).toISOString():'';
 }}/><input type="hidden" name="date"/></label>;
}
function HistoricalRecord({value}:{value:unknown}){
 if(!value||typeof value!=='object'||Array.isArray(value))return <p>Sin registro anterior.</p>;
 const v=value as Record<string,unknown>;
 const fields:Record<string,string>={pos:'Punto de venta',number:'Número',issued_on:'Fecha de emisión',cents:'Importe en centavos',currency:'Moneda',send_status:'Estado del envío declarado',sent_at:'Fecha de envío',recipient:'Destinatario',carrier:'Transportista',tracking:'Seguimiento',date:'Fecha de despacho'};
 return <dl>{Object.entries(fields).flatMap(([key,label])=>v[key]===null||v[key]===undefined?[]:[<div key={key}><dt>{label}</dt><dd>{String(v[key])}</dd></div>])}</dl>;
}
function Form({order,operation,version,children,label,confirm=true}:{order:string;operation:string;version:number;children:ReactNode;label:string;confirm?:boolean}){
 const[state,action,busy]=useActionState(orderOfficeAction,{status:'idle'});
 return <form action={action} className="adm-stack-sm"><input type="hidden" name="order" value={order}/><input type="hidden" name="operation" value={operation}/><input type="hidden" name="version" value={version}/>
 {children}<label>Motivo u observaciones del registro<textarea className="adm-input" name="notes" required minLength={5} maxLength={500}/></label>
 {confirm&&<label><input type="checkbox" name="confirm" value="yes" required/> Confirmo el registro administrativo y los datos ingresados.</label>}
 <button className="adm-btn" disabled={busy}>{busy?'Guardando…':label}</button>{state.status!=='idle'&&<p role={state.status==='error'?'alert':'status'}>{state.message}</p>}</form>;
}
export default function OrderOfficePanel({order,version,dispatched,carrier,tracking,data,email}:{order:string;version:number;dispatched:boolean;carrier:string|null;tracking:string|null;data:OrderOffice;email:string}){
 const invoice=data.invoice;
 return <section className="adm-card adm-card-body adm-stack adm-posventa" aria-label="Comunicaciones y Factura C"><h2>Comunicaciones y Factura C</h2>
 <h3>Correos del pedido</h3><p>Solo comunicaciones transaccionales. Aceptado por el proveedor no significa entrega ni lectura.</p>
 {data.messages.length===0&&<p>Sin comunicaciones registradas.</p>}
 {data.messages.map(m=><div key={m.id}><p><strong>{messageLabels[m.kind]??'Comunicación'}</strong> · {mailStatusLabels[m.status]} · {m.attempts} intento(s) · {dateTime(m.created_at)}</p>
 {m.error&&<p>El envío requiere revisión. Consultá los intentos y el monitor de comunicaciones.</p>}
 {['fallido','rebotado','pendiente'].includes(m.status)&&<Form key={`${m.id}-${m.version}`} order={order} operation="message" version={m.version} label="Registrar intervención de correo" confirm={false}>
 <input type="hidden" name="message" value={m.id}/><label>Acción<select className="adm-input" name="action"><option value="resuelto_manual">Resuelto por otro canal</option>
 {m.kind!=='recuperacion_pedido'&&['fallido','rebotado'].includes(m.status)&&<option value="reintento_manual">Reintentar la misma comunicación</option>}</select></label></Form>}</div>)}
 {dispatched&&<details><summary>Corregir datos de despacho</summary><p>Los cambios se auditan. Un correo pendiente se sustituye; si el anterior fue enviado, se genera una comunicación explícita de corrección.</p>
 <Form key={version} order={order} operation="dispatch_correction" version={version} label="Confirmar corrección de despacho">
 <label>Transportista corregido<input className="adm-input" name="carrier" required maxLength={80} defaultValue={carrier??'Andreani'}/></label>
 <label>Seguimiento corregido<input className="adm-input" name="tracking" maxLength={120} defaultValue={tracking??''}/></label>
 <LocalDateTime label="Fecha real corregida (hora local del dispositivo)"/></Form></details>}
 <h3>Factura C — registro administrativo</h3><p>Se emite manualmente en ARCA. Este registro no emite un comprobante ni acredita su validez fiscal. El PDF se envía manualmente desde Zoho.</p>
 {data.review_required&&<p role="status" className="adm-notice adm-notice-warning">Revisión fiscal pendiente: revisá el pago, importe, reembolsos, devolución o disputa antes de decidir la gestión fiscal correspondiente. No se generan notas de crédito automáticamente.</p>}
 {invoice?<div><p><strong>Emitida · Factura C {invoice.pos}-{invoice.number}</strong></p><p>Fecha: {invoice.issued_on} · {formatArs(invoice.cents)} · {invoice.currency}</p>
 <p>Registrada: {dateTime(invoice.registered_at)}</p><p>Envío: {invoice.send_status==='sent'?'Enviada (declaración administrativa)':invoice.send_status==='failed'?'Envío fallido declarado':'Envío pendiente'}</p>
 {invoice.recipient&&<p>Destinatario declarado: {invoice.recipient} · {dateTime(invoice.sent_at)}</p>}</div>:<p>Pendiente de emisión.</p>}
 <details><summary>{invoice?'Corregir registro de Factura C':'Registrar Factura C emitida en ARCA'}</summary>
 <Form key={`invoice-${invoice?.version??-1}`} order={order} operation="invoice" version={invoice?.version??-1} label={invoice?'Guardar corrección del registro':'Registrar Factura C'}>
 <label>Punto de venta<input className="adm-input" name="pos" inputMode="numeric" pattern="[0-9]{1,5}" maxLength={5} required defaultValue={invoice?.pos??''}/></label>
 <label>Número de comprobante<input className="adm-input" name="number" inputMode="numeric" pattern="[0-9]{1,8}" maxLength={8} required defaultValue={invoice?.number??''}/></label>
 <label>Fecha de emisión<input className="adm-input" name="date" type="date" required defaultValue={invoice?.issued_on??''}/></label>
 <label>Importe facturado (ARS)<input className="adm-input" name="amount" inputMode="decimal" required defaultValue={invoice?centavosToDecimal(invoice.cents):''}/></label>
 <p>Ingresá los datos del comprobante realmente emitido. Corregir el registro no corrige la factura en ARCA y deja pendiente la revisión del envío.</p></Form></details>
 {invoice&&<details><summary>Registrar envío manual del PDF</summary><Form key={`send-${invoice.version}`} order={order} operation="invoice_send" version={invoice.version} label="Guardar declaración de envío">
 <label>Estado declarado<select className="adm-input" name="status"><option value="sent">Enviado manualmente desde Zoho</option><option value="failed">Envío fallido</option><option value="pending">Pendiente de envío</option></select></label>
 <label>Email destinatario<input className="adm-input" name="email" type="email" required maxLength={254} defaultValue={invoice.recipient??email}/></label>
 <LocalDateTime label="Fecha del envío o gestión declarada (hora local del dispositivo)"/><p>No se genera un PDF ni se envía correo desde esta pantalla.</p></Form></details>}
 <h3>Historial administrativo</h3><ol>{data.events.map(e=><li key={e.id}>{dateTime(e.created_at)} · {e.kind.startsWith('invoice')?'Registro de facturación':'Corrección de despacho'} · {e.note}<small>Administrador: {e.actor}</small><details><summary>Ver datos registrados en este evento</summary><h4>Antes</h4><HistoricalRecord value={e.before_data}/><h4>Después</h4><HistoricalRecord value={e.after_data}/></details></li>)}</ol>
 </section>;
}
