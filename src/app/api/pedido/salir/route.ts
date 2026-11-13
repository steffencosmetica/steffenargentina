import {NextRequest} from 'next/server';
import {json,notFound,onlyPost} from '@/lib/http/json-api';
import {readBoundedJson} from '@/lib/legal/api';
import {createServiceClient} from '@/lib/supabase/admin';
import {orderRecoveryEnabled,ORDER_SESSION_COOKIE} from '@/lib/orders/recovery-server';
import {isOrderToken} from '@/lib/checkout/order-view';
export async function POST(request:NextRequest){
 if(!orderRecoveryEnabled())return notFound();
 const read=await readBoundedJson(request,128);if('response'in read)return read.response;
 if(!read.body||typeof read.body!=='object'||Array.isArray(read.body)||Object.keys(read.body).length)return json({error:'invalid_request'},422);
 const session=request.cookies.get(ORDER_SESSION_COOKIE)?.value;
 if(isOrderToken(session)){
  try{const r=await createServiceClient().rpc('revocar_acceso_pedido',{p_session:session});
   if(r.error)return json({error:'unavailable'},503);
  }catch{return json({error:'unavailable'},503);}
 }
 const response=json({ok:true});response.cookies.set(ORDER_SESSION_COOKIE,'',{
  httpOnly:true,sameSite:'strict',secure:request.nextUrl.protocol==='https:',path:'/api/pedido',maxAge:0});return response;
}
export const {GET,PUT,PATCH,DELETE}=onlyPost;export const HEAD=notFound;
