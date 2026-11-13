import { NextRequest } from 'next/server';
import { json, notFound, onlyPost } from '@/lib/http/json-api';
import { readBoundedJson, revocationClientIp } from '@/lib/legal/api';
import { createServiceClient } from '@/lib/supabase/admin';
import { orderRecoveryEnabled, ORDER_SESSION_COOKIE } from '@/lib/orders/recovery-server';
import { isOrderCode, isOrderToken } from '@/lib/checkout/order-view';
export async function POST(request:NextRequest){
 if(!orderRecoveryEnabled())return notFound();
 const read=await readBoundedJson(request,512);if('response'in read)return read.response;
 const p=read.body as {token?:unknown}|null;
 if(!p||Object.keys(p).length!==1||!isOrderToken(p.token))return json({error:'invalid_access'},404);
 const ip=revocationClientIp(request);if(!ip)return json({error:'unavailable'},503);
 try{const r=await createServiceClient().rpc('canjear_recuperacion_pedido',{p_token:p.token,p_ip:ip});
  if(r.error)return json({error:'unavailable'},503);
  const access=r.data as {code?:unknown;session?:unknown;limited?:boolean}|null;
  if(access?.limited)return json({error:'rate_limited'},429);
  if(!isOrderCode(access?.code)||!isOrderToken(access?.session))return json({error:'invalid_access'},404);
  const response=json({code:access.code});response.cookies.set(ORDER_SESSION_COOKIE,access.session,
   {httpOnly:true,sameSite:'strict',secure:request.nextUrl.protocol==='https:',path:'/api/pedido',maxAge:1800});return response;
 }catch{return json({error:'unavailable'},503);}
}
export const {GET,PUT,PATCH,DELETE}=onlyPost;export const HEAD=notFound;
