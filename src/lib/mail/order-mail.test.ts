import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readdir,readFile,rm,writeFile,unlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {renderMessage,type ClaimedMessage} from './templates.ts';
import {fileTransport} from './transports.ts';
import {orderOfficeEnabled,orderMailEnabled} from './order-config.ts';
import {invoiceNumber} from '../orders/office-model.ts';
import {drainOnce,type MailQueue} from './worker.ts';
import {smtpEvidence} from './smtp-evidence.ts';
import {mailConfigFromEnv} from './config.ts';
test('SMTP: resultado final, rechazo, fallo conocido y aceptación potencial sin respuesta',()=>{
 assert.equal(smtpEvidence({phase:'final_ack',responseCode:250,accepted:1}),'accepted');
 assert.equal(smtpEvidence({phase:'final_ack',responseCode:550}),'permanent_failure');
 assert.equal(smtpEvidence({phase:'data',responseCode:451}),'temporary_failure');
 assert.equal(smtpEvidence({phase:'connect'}),'temporary_failure');
 for(const phase of ['data','final_ack','unknown'] as const)assert.equal(smtpEvidence({phase}),'uncertain');
 assert.equal(smtpEvidence({phase:'final_ack',accepted:1}),'uncertain','sin respuesta final verificable no se confirma');
});
test('SMTP bloqueado en Vercel aunque todos los parámetros reales se configuren accidentalmente',()=>{
 const env={MAIL_TRANSPORT:'smtp',MAIL_ALLOW_REAL_SEND:'1',MAIL_FROM:'info@steffenargentina.com.ar',MAIL_LINK_BASE_URL:'https://steffenargentina.com.ar',NEXT_PUBLIC_SUPABASE_URL:'https://example.supabase.co',MAIL_SUPABASE_HOST:'example.supabase.co',MAIL_SMTP_HOST:'smtp.zoho.com',MAIL_SMTP_USER:'fixture',MAIL_SMTP_PASSWORD:'fixture'};
 assert.equal(mailConfigFromEnv({...env,VERCEL:'1'}).ok,false);assert.equal(mailConfigFromEnv({...env,VERCEL_ENV:'preview'}).ok,false);
});
const ctx={linkBaseUrl:'http://localhost:3100',contactEmail:'info@steffenargentina.com.ar',whatsapp:'+54 9 223-559-0428'};
const payload={code:'STF-2026-ABCD',created_at:'2026-11-12T12:00:00Z',subtotal_cents:400020,shipping_cents:150021,total_cents:550041,
 items:[{name:'Producto <script>alert(1)</script>',quantity:2,unit_cents:200010,line_cents:400020}]};
const message=(kind:ClaimedMessage['kind'],extra:Record<string,unknown>={}):ClaimedMessage=>({id:'test-order',leaseId:'lease',kind,recipient:'comprador@test.local',attempt:1,payload:{...payload,...extra}});
test('pedido recibido: precios históricos exactos, envío, texto/HTML y escape',()=>{
 const m=renderMessage(message('pedido_recibido'),ctx);assert.match(m.text,/pendiente de pago/);assert.match(m.text,/5.500,41/);
 assert.match(m.text,/1.500,21/);assert.match(m.html,/&lt;script&gt;/);assert.doesNotMatch(m.html,/<script>/);
 assert.match(m.html,/viewport/);assert.doesNotMatch(m.html,/<img/);assert.match(m.text,/info@steffenargentina/);
});
test('plantillas rechazan sumas y cantidades alteradas',()=>{
 for(const extra of [{total_cents:550042},{shipping_cents:1},{subtotal_cents:400020.1},{items:[{name:'x',quantity:2,unit_cents:3,line_cents:7}]}])
  assert.throws(()=>renderMessage(message('pedido_recibido',extra),ctx));
});
test('acreditación con incidencia no promete preparación; normal informa plazo separado del transporte',()=>{
 const normal=renderMessage(message('pago_confirmado',{needs_attention:false}),ctx);
 assert.match(normal.text,/1 y 3 días hábiles/);assert.match(normal.text,/no incluye el transporte/);
 const incident=renderMessage(message('pago_confirmado',{needs_attention:true}),ctx);assert.doesNotMatch(incident.text,/1 y 3/);assert.match(incident.text,/acordar una solución/);
});
test('despacho y corrección: transportista y número sin enlaces inventados',()=>{
 const m=renderMessage(message('pedido_despachado',{carrier:'Andreani',tracking:'<X&Y>',dispatched_at:'2026-11-12T13:00:00Z',correction:true}),ctx);
 assert.match(m.subject,/Corrección/);assert.match(m.text,/Andreani/);assert.match(m.html,/&lt;X&amp;Y&gt;/);assert.doesNotMatch(m.html,/andreani\.com/);
});
test('recuperación: fragmento de un uso y origen local; no token permanente',()=>{
 const m=renderMessage(message('recuperacion_pedido',{token:'a'.repeat(43)}),ctx);assert.match(m.text,/#t=a{43}/);assert.match(m.text,/15 minutos/);
 assert.throws(()=>renderMessage(message('recuperacion_pedido',{token:'bad'}),ctx));
 assert.throws(()=>renderMessage(message('recuperacion_pedido',{token:'a'.repeat(43)}),{...ctx,linkBaseUrl:'https://evil.test'}));
});
test('aislamiento: credenciales no habilitan comunicaciones, Cloud y Vercel bloqueados',()=>{
 const env={STEFFEN_ORDER_COMMS:'1',NEXT_PUBLIC_SUPABASE_URL:'http://127.0.0.1:55321',MAIL_TRANSPORT:'archivo',MAIL_LINK_BASE_URL:'http://localhost:3100'};
 assert.equal(orderMailEnabled(env),true);assert.equal(orderOfficeEnabled({...env,VERCEL:'1'}),false);
 assert.equal(orderMailEnabled({...env,MAIL_TRANSPORT:'smtp'}),false);assert.equal(orderOfficeEnabled({...env,NEXT_PUBLIC_SUPABASE_URL:'https://zzxlghpopmccwsaqbsko.supabase.co'}),false);
 assert.equal(orderOfficeEnabled({MAIL_SMTP_PASSWORD:'accidental'}),false);
});
test('numeración fiscal administrativa: normaliza datos reales sin asignar números',()=>{
 assert.equal(invoiceNumber('12',5),'00012');assert.equal(invoiceNumber('123',8),'00000123');
 for(const s of ['0','00000','-1','1.5','abc','123456'])assert.equal(invoiceNumber(s,5),null);
});
test('proveedor archivo: entrega concurrente idempotente y rechazo de concesión vencida',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'steffen-order-mail-'));try{
  const provider=fileTransport({transport:'archivo',captureDir:dir,from:'info@steffenargentina.com.ar',linkBaseUrl:ctx.linkBaseUrl});const mail={id:'same-event',to:'comprador@test.local',subject:'Prueba',text:'Texto',html:'<p>Texto</p>',idempotent:true,expiresAt:new Date(Date.now()+60000).toISOString()};
  const results=await Promise.all([provider.send(mail),provider.send(mail)]);assert.deepEqual(results[0],results[1]);
  assert.deepEqual(await readdir(dir),['tienda-same-event.json']);assert.match(await readFile(join(dir,'tienda-same-event.json'),'utf8'),/Texto/);
  await assert.rejects(provider.send({...mail,id:'expired',expiresAt:new Date(0).toISOString()}));assert.equal((await readdir(dir)).length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('trabajador reiniciado después de aceptación no persistida: recupera sin otra entrega',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'steffen-mail-restart-'));try{
  let attempts=0,failReport=true;const queue:MailQueue={claim:async()=>[{...message('pedido_recibido',{_lease_until:new Date(Date.now()+60000).toISOString()}),leaseId:'lease-'+(++attempts)}],
   validate:async()=>true,report:async()=>{if(failReport)throw Error('postgres_unavailable');return 'aceptado';}};
  const opts={queue,transport:fileTransport({transport:'archivo',captureDir:dir,from:ctx.contactEmail,linkBaseUrl:ctx.linkBaseUrl}),context:ctx,worker:'restart-test'};
  assert.equal((await drainOnce(opts)).reportErrors,1);failReport=false;assert.equal((await drainOnce(opts)).accepted,1);
  assert.equal((await readdir(dir)).length,1);assert.equal(attempts,2);
  queue.validate=async()=>false;assert.equal((await drainOnce(opts)).unchanged,1);assert.equal((await readdir(dir)).length,1);
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('proveedor caído: conserva trabajo para reintentar y falla sin enviar',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'steffen-mail-outage-'));try{
  await writeFile(join(dir,'CAIDA'),'');const provider=fileTransport({transport:'archivo',captureDir:dir,from:ctx.contactEmail,linkBaseUrl:ctx.linkBaseUrl});
  const mail={id:'retry',to:'a@test.local',subject:'Prueba',text:'texto',html:'<p>texto</p>',idempotent:true,expiresAt:new Date(Date.now()+60000).toISOString()};
  await assert.rejects(provider.send(mail));assert.deepEqual(await readdir(dir),['CAIDA']);await unlink(join(dir,'CAIDA'));
  await provider.send(mail);assert.deepEqual(await readdir(dir),['tienda-retry.json']);
 }finally{await rm(dir,{recursive:true,force:true});}
});
