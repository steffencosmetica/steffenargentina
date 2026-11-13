import { formatArs, MAX_CENTAVOS } from '../money.ts';
import { formatArgentina, TemplateError, type ClaimedMessage, type RenderedMail, type TemplateContext } from './templates.ts';
const esc=(s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const text=(v:unknown,max=250)=>{if(typeof v!=='string'||!v.trim()||v.length>max)throw new TemplateError('contenido');return v;};
const cents=(v:unknown)=>{if(typeof v!=='number'||!Number.isSafeInteger(v)||v<0||v>MAX_CENTAVOS)throw new TemplateError('importe');return v;};
function frame(subject:string,paragraphs:string[],href?:string):RenderedMail {
 const content=paragraphs.map(p=>`<p style="margin:0 0 18px">${esc(p).replace(/\n/g,'<br>')}</p>`).join('');
 const html=`<!doctype html><html lang="es"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f6f5f1;color:#222;font-family:Arial,Helvetica,sans-serif;line-height:1.6"><table role="presentation" style="width:100%;border-collapse:collapse"><tr><td style="padding:24px 12px"><table role="presentation" style="width:100%;max-width:600px;margin:auto;background:white;border-top:4px solid #987a2b;border-collapse:collapse"><tr><td style="padding:28px"><h1 style="font-size:23px;color:#765e20">STEFFEN</h1>${content}${href?`<p><a style="color:#765e20;font-weight:bold" href="${esc(href)}">Abrir acceso privado de un solo uso</a></p>`:''}</td></tr></table></td></tr></table></body></html>`;
 return {subject,text:paragraphs.join('\n\n')+(href?'\n\n'+href:'')+'\n',html};
}
function summary(p:Record<string,unknown>) {
 if(!Array.isArray(p.items)||!p.items.length)throw new TemplateError('items');let total=0;
 const lines=p.items.map(raw=>{const i=raw as Record<string,unknown>;const q=i.quantity;
  if(typeof q!=='number'||!Number.isSafeInteger(q)||q<1||q>1000)throw new TemplateError('cantidad');
  const unit=cents(i.unit_cents),line=cents(i.line_cents);if(unit*q!==line)throw new TemplateError('suma');total+=line;
  return `${text(i.name,250)} × ${q} · ${formatArs(unit)} · ${formatArs(line)}`;
 });
 const subtotal=cents(p.subtotal_cents),shipping=cents(p.shipping_cents),amount=cents(p.total_cents);
 if(total!==subtotal||subtotal+shipping!==amount||amount<1)throw new TemplateError('suma');
 return [...lines,`Productos: ${formatArs(subtotal)}\nEnvío: ${formatArs(shipping)}\nTotal: ${formatArs(amount)}`].join('\n');
}
export function renderOrderMessage(message:ClaimedMessage,ctx:TemplateContext):RenderedMail {
 const p=message.payload;const code=text(p.code,25);if(!/^STF-\d{4}-[2-9A-HJ-NP-Z]{4}$/.test(code))throw new TemplateError('codigo');
 const footer=`Steffen Cosmética Capilar · ${ctx.contactEmail}\nAtención: lunes a viernes de 8:00 a 16:00, hora de Argentina.\nComunicación exclusivamente transaccional de Steffen Tienda.`;
 const recover=`Para consultar el estado, solicitá un acceso privado con tu código de pedido y el email de la compra en ${ctx.linkBaseUrl}/pedido/recuperar. No necesitás registrarte.`;
 if(message.kind==='recuperacion_pedido') {
  const token=text(p.token,43);if(!/^[A-Za-z0-9_-]{43}$/.test(token))throw new TemplateError('token');
  const origin=new URL(ctx.linkBaseUrl);if(!['localhost','127.0.0.1'].includes(origin.hostname)||origin.origin!==ctx.linkBaseUrl)throw new TemplateError('origen');
  return frame(`Acceso privado a tu pedido ${code}`,[`Solicitaste consultar el pedido ${code}.`,`El acceso vence en 15 minutos y sirve una sola vez. Abrilo y confirmá que querés consultar el pedido. No lo compartas. Si no lo solicitaste, ignorá este mensaje.`,footer],`${origin.origin}/pedido/recuperar#t=${token}`);
 }
 if(message.kind==='pedido_recibido')return frame(`Recibimos tu pedido ${code}`,[
  `Recibimos el pedido ${code} el ${formatArgentina(text(p.created_at))}.`,summary(p),
  'Estado al registrar el pedido: pendiente de pago. Pedido recibido no significa pago aprobado. La preparación comienza después de confirmar la acreditación. Consultá el estado actual en tu seguimiento.',recover,footer]);
 if(message.kind==='pago_confirmado')return frame(`Pago confirmado · ${code}`,[`Confirmamos la acreditación del pedido ${code}. Importe confirmado: ${formatArs(cents(p.total_cents))}.`,summary(p),
  p.needs_attention===true?'El pedido requiere una revisión individual. Vamos a contactarte para acordar una solución; todavía no confirmamos preparación ni despacho.':
  'La preparación y el despacho se realizan entre 1 y 3 días hábiles después de confirmar el pago. Este plazo no incluye el transporte, que tiene sus propios tiempos.',recover,footer]);
 if(message.kind==='pedido_despachado')return frame(`${p.correction===true?'Corrección de despacho':'Pedido despachado'} · ${code}`,[
  p.correction===true?'Actualizamos los datos de despacho. Usá los datos de este mensaje.':'Steffen entregó tu pedido al transporte.',
  `Pedido: ${code}\nFecha de despacho: ${formatArgentina(text(p.dispatched_at))}\nTransportista: ${text(p.carrier,80)}${p.tracking?'\nNúmero de seguimiento: '+text(p.tracking,120):'\nEl transportista no tiene un número de seguimiento registrado.'}`,
  'El plazo de transporte es independiente de la preparación. No incluimos enlaces que no hayamos verificado.',recover,footer]);
 throw new TemplateError('tipo');
}
