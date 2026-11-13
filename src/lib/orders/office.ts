import 'server-only';
import {assertUuid,requireAdmin} from '@/lib/catalog/admin';
import {orderOfficeEnabled} from '@/lib/mail/order-config';
import {parsePesosInput} from '@/lib/money';
import {invoiceNumber,type OrderOffice} from './office-model';
export async function readOrderOffice(order:string){
 const{supabase}=await requireAdmin();if(!orderOfficeEnabled(process.env))return null;assertUuid(order);
 const r=await supabase.rpc('admin_ver_oficina_pedido',{p_order:order});if(r.error)throw new Error('No se pudo consultar la oficina del pedido.');return r.data as unknown as OrderOffice;
}
export async function changeOrderOffice(form:FormData){
 const{supabase}=await requireAdmin();if(!orderOfficeEnabled(process.env))throw new Error('La gestión de comunicaciones y facturas está deshabilitada.');
 const value=(name:string)=>String(form.get(name)??'').trim();const order=value('order');assertUuid(order);
 const version=Number(value('version'));if(!/^-?\d{1,9}$/.test(value('version'))||!Number.isSafeInteger(version))throw new Error('Recargá el pedido antes de continuar.');
 const note=value('notes');if(note.length<5||note.length>500)throw new Error('Indicá un motivo de entre 5 y 500 caracteres.');
 const op=value('operation');let result;
 if(op==='message'){
  const id=value('message');assertUuid(id);
  result=await supabase.rpc('admin_comunicacion_pedido',{p_order:order,p_id:id,p_version:version,p_action:value('action'),p_note:note});
 }else{
  if(value('confirm')!=='yes')throw new Error('Confirmá expresamente la operación.');
  if(op==='invoice'){
   const pos=invoiceNumber(value('pos'),5),number=invoiceNumber(value('number'),8),amount=parsePesosInput(value('amount'));
   if(!pos||!number||!amount||!/^\d{4}-\d{2}-\d{2}$/.test(value('date')))throw new Error('Revisá el número, la fecha y el importe de la Factura C.');
   result=await supabase.rpc('admin_registrar_factura',{p_order:order,p_version:version,p_pos:pos,p_number:number,p_date:value('date'),p_cents:amount,p_note:note,p_confirm:true});
  }else if(op==='invoice_send'){
   const time=Date.parse(value('date'));if(!Number.isFinite(time))throw new Error('Indicá la fecha y hora del envío declarado.');
   result=await supabase.rpc('admin_registrar_envio_factura',{p_order:order,p_version:version,p_status:value('status'),p_email:value('email'),p_date:new Date(time).toISOString(),p_note:note,p_confirm:true});
  }else if(op==='dispatch_correction'){
   const time=Date.parse(value('date'));if(!Number.isFinite(time))throw new Error('Indicá una fecha de despacho válida.');
   result=await supabase.rpc('admin_corregir_despacho',{p_order:order,p_version:version,p_carrier:value('carrier'),p_tracking:value('tracking'),p_date:new Date(time).toISOString(),p_note:note,p_confirm:true});
  }else throw new Error('Operación inválida.');
 }
 if(result.error){const specific=result.error.message==='dispatch_sending'?'Hay un email de despacho en curso. Esperá su resolución antes de corregirlo.':
  result.error.code==='23505'?'Ese punto de venta y número ya están registrados.':'Los datos cambiaron o no son válidos. Recargá y revisá el estado antes de continuar.';throw new Error(specific);}
 return order;
}
