// Vista previa offline ficticia. No conecta PostgreSQL ni crea un transporte de correo.
import {mkdir,writeFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {renderMessage,type ClaimedMessage} from '../src/lib/mail/templates.ts';
const dir=join(process.cwd(),'.mail-capturas','previews');
const snapshot={code:'STF-2611-ABCD',created_at:new Date().toISOString(),subtotal_cents:400020,shipping_cents:150021,total_cents:550041,
 items:[{name:'Producto ficticio de vista previa',quantity:2,unit_cents:200010,line_cents:400020}]};
const previews:{name:string;kind:ClaimedMessage['kind'];data:Record<string,unknown>}[]=[
 {name:'pedido-recibido',kind:'pedido_recibido',data:{}},
 {name:'pago-confirmado',kind:'pago_confirmado',data:{needs_attention:false}},
 {name:'pago-con-incidencia',kind:'pago_confirmado',data:{needs_attention:true}},
 {name:'pedido-despachado',kind:'pedido_despachado',data:{carrier:'Andreani',tracking:'SEGUIMIENTO-FICTICIO',dispatched_at:new Date().toISOString()}},
 {name:'correccion-despacho',kind:'pedido_despachado',data:{carrier:'Otro transporte',tracking:'DATO-CORREGIDO-FICTICIO',dispatched_at:new Date().toISOString(),correction:true}},
 {name:'recuperacion-pedido',kind:'recuperacion_pedido',data:{token:randomBytes(32).toString('base64url')}},
];
await mkdir(dir,{recursive:true});
for(const preview of previews){
 const mail=renderMessage({id:'preview',leaseId:'preview',kind:preview.kind,recipient:'comprador@example.test',attempt:1,payload:{...snapshot,...preview.data}},
  {linkBaseUrl:'http://localhost:3000',contactEmail:'info@steffenargentina.com.ar',whatsapp:'+54 9 223-559-0428'});
 await writeFile(join(dir,preview.name+'.html'),mail.html);await writeFile(join(dir,preview.name+'.txt'),mail.subject+'\n\n'+mail.text);
}
console.log('Seis vistas previas ficticias en .mail-capturas/previews/ (HTML y texto). Sin base ni envío de correo.');
