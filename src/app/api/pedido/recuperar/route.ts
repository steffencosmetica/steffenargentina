import { NextRequest } from 'next/server';
import { json, notFound, onlyPost } from '@/lib/http/json-api';
import { readBoundedJson, revocationClientIp } from '@/lib/legal/api';
import { createServiceClient } from '@/lib/supabase/admin';
import { orderRecoveryEnabled } from '@/lib/orders/recovery-server';
import { isOrderCode } from '@/lib/checkout/order-view';
import { scheduleMailDrain } from '@/lib/mail/server';
export async function POST(request:NextRequest){
 if(!orderRecoveryEnabled())return notFound();
 const read=await readBoundedJson(request,1024);if('response'in read)return read.response;
 const p=read.body as Record<string,unknown>|null;
 const code=typeof p?.code==='string'?p.code.trim().toUpperCase():'';
 const email=typeof p?.email==='string'?p.email.trim().toLowerCase():'';
 if(!p||Object.keys(p).some(k=>!['code','email','website'].includes(k))||!isOrderCode(code)||email.length>254
  ||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)||!['',undefined].includes(p.website as ''|undefined))return json({error:'invalid_request'},422);
 const ip=revocationClientIp(request);if(!ip)return json({error:'unavailable'},503);
 try{const r=await createServiceClient().rpc('solicitar_recuperacion_pedido',{p_code:code,p_email:email,p_ip:ip});
  if(r.error)return json({error:'unavailable'},503);
  if((r.data as {limited?:boolean})?.limited)return json({error:'rate_limited'},429);
  scheduleMailDrain();return json({ok:true},202);
 }catch{return json({error:'unavailable'},503);}
}
export const {GET,PUT,PATCH,DELETE}=onlyPost;export const HEAD=notFound;
