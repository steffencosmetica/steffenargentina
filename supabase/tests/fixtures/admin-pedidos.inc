-- Datos ficticios. Solo para PostgreSQL local; el llamador controla la transacción.
insert into public.categories(id,name,slug) values ('bb600000-0000-4000-8000-000000000001','Prueba pedidos','prueba-pedidos');
insert into public.products(id,category_id,sku,name,slug,price_ars,stock)
values ('bb600000-0000-4000-8000-000000000002','bb600000-0000-4000-8000-000000000001','FICTICIO-46','Producto actual','producto-ficticio-46',999,74);
insert into public.orders(id,code,access_token_hash,token_key_version,idempotency_key_hash,request_fingerprint,
 buyer_name,buyer_email,buyer_phone,ship_street,ship_number,ship_unit,ship_city,ship_postal_code,ship_province_code,ship_notes,
 shipping_zone_name,shipping_rate_ars,subtotal_ars,shipping_ars,total_ars,reservation_expires_at,payment_status,stock_state,paid_at,created_at)
select ('bb600000-0000-4000-8000-' || lpad(i::text,12,'0'))::uuid,
 'STF-2611-AA' || substr('23456789ABCDEFGHJKLMNPQRSTUVWXYZ', i,1) || '2',
 extensions.digest('token-ficticio-'||i,'sha256'),1,extensions.digest('key-ficticia-'||i,'sha256'),extensions.digest('contenido-'||i,'sha256'),
 'Comprador Ficticio '||i,'ficticio'||i||'@steffen.test','2235550000','Calle de Prueba','123','2 B','Localidad Ficticia','7600','AR-B','Timbre de prueba',
 'Zona histórica ficticia',250,1000,250,1250,now()+interval '1 hour',
 case when i=26 then 'approved' else 'pending' end,case when i=26 then 'consumed' else 'reserved' end,
 case when i=26 then now()-interval '1 hour' else null end,now()-i*interval '1 minute'
from generate_series(1,26) i;
insert into public.order_items(order_id,product_id,sku,name,unit_price_ars,quantity,line_total_ars)
select id,'bb600000-0000-4000-8000-000000000002','SKU-HISTORICO','Producto histórico',1000,1,1000 from public.orders where id::text like 'bb600000-%';
insert into public.order_events(order_id,event_type,actor) select id,'created','checkout' from public.orders where id::text like 'bb600000-%';
