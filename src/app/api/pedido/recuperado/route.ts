import { NextRequest } from 'next/server';
import { json, notFound, onlyPost } from '@/lib/http/json-api';
import { readBoundedJson, revocationClientIp } from '@/lib/legal/api';
import { createServiceClient } from '@/lib/supabase/admin';
import { orderRecoveryEnabled, ORDER_SESSION_COOKIE } from '@/lib/orders/recovery-server';
import { isOrderCode, isOrderToken, parseOrderLookup } from '@/lib/checkout/order-view';
export async function POST(request:NextRequest){
 if(!orderRecoveryEnabled())return notFound();
 const read=await readBoundedJson(request,512);if('response'in read)return read.response;
 const p=read.body as {code?:unknown}|null;const session=request.cookies.get(ORDER_SESSION_COOKIE)?.value;
 if(!p||Object.keys(p).length!==1||!isOrderCode(p.code)||!isOrderToken(session))return json({error:'not_found'},404);
 const ip=revocationClientIp(request);if(!ip)return json({error:'unavailable'},503);
 try{const r=await createServiceClient().rpc('consultar_pedido_recuperado',{p_code:p.code,p_session:session,p_ip:ip});
  if(r.error)return json({error:'unavailable'},503);const view=parseOrderLookup(r.data as Parameters<typeof parseOrderLookup>[0]);
  return view?json(view):json({error:'not_found'},404);
 }catch{return json({error:'unavailable'},503);}
}
export const {GET,PUT,PATCH,DELETE}=onlyPost;export const HEAD=notFound;
