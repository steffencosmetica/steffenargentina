export type Invoice={order_id:string;type:'C';pos:string;number:string;issued_on:string;cents:number;currency:'ARS';registered_at:string;admin_id:string;
 notes:string|null;version:number;send_status:'pending'|'sent'|'failed';sent_at:string|null;recipient:string|null;sent_admin:string|null};
export type OrderOffice={invoice:Invoice|null;review_required:boolean;
 events:{id:number;actor:string;kind:string;note:string;created_at:string;before_data:unknown;after_data:unknown}[];
 messages:{id:string;kind:string;status:string;attempts:number;error:string|null;version:number;created_at:string;accepted_at:string|null}[]};
export const messageLabels:Record<string,string>={pedido_recibido:'Pedido recibido',pago_confirmado:'Pago confirmado',pedido_despachado:'Despacho',recuperacion_pedido:'Recuperación de seguimiento',alerta:'Alerta interna'};
export const mailStatusLabels:Record<string,string>={pendiente:'Pendiente de envío',enviando:'En procesamiento',aceptado:'Aceptado por el proveedor (no confirma lectura)',fallido:'Fallido: requiere revisión',rebotado:'Rebote declarado',resuelto_manual:'Resuelto por otro canal',vencido:'Sustituido o vencido'};
export function invoiceNumber(input:string,width:5|8){return new RegExp(`^[0-9]{1,${width}}$`).test(input)&&Number(input)>0?input.padStart(width,'0'):null;}
