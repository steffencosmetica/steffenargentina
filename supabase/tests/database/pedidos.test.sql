-- Pedidos, reservas de stock, vencimientos, pagos simulados, estados, antiabuso y seguridad (Fase 4B.3).
-- Se ejecuta con `npm run db:test`; todo corre en una transacción que se descarta al final.
-- Las pruebas con conexiones simultáneas reales están en supabase/tests/concurrency/.

begin;
create extension if not exists pgtap with schema extensions;

select plan(252);

-- ---------------------------------------------------------------------------
-- Estructura y permisos declarados
-- ---------------------------------------------------------------------------

select has_table('public', 'store_settings', 'existe store_settings');
select has_table('public', 'orders', 'existe orders');
select has_table('public', 'order_items', 'existe order_items');
select has_table('public', 'order_events', 'existe order_events');
select has_table('public', 'checkout_attempts', 'existe checkout_attempts');
select ok(
  (select bool_and(relrowsecurity) from pg_class
    where oid in ('public.store_settings'::regclass, 'public.orders'::regclass, 'public.order_items'::regclass,
                  'public.order_events'::regclass, 'public.checkout_attempts'::regclass)),
  'RLS habilitado en todas las tablas nuevas'
);
select results_eq(
  $$ select checkout_enabled, reservation_minutes, max_units_per_product, max_units_per_order,
            max_pending_orders_per_email, max_orders_per_ip_hour, max_attempts_per_ip_hour from public.store_settings $$,
  $$ values (false, 30, 5, 20, 2, 5, 30) $$,
  'configuración inicial: checkout deshabilitado y límites por defecto'
);
select is((select count(*) from public.store_settings), 1::bigint, 'store_settings tiene una sola fila');
select throws_ok($$ insert into public.store_settings (id) values (false) $$, '23514', null, 'no se puede agregar otra fila de configuración');
select ok(
  not exists (select 1 from information_schema.columns
               where table_schema = 'public' and table_name in ('checkout_attempts', 'orders', 'order_events')
                 and data_type in ('inet', 'cidr')),
  'ninguna tabla guarda direcciones IP'
);
select ok(
  (select bool_and(prosecdef and proconfig @> array['search_path=""'])
     from pg_proc
    where oid in ('public.crear_pedido(text, jsonb, jsonb, jsonb, numeric, inet)'::regprocedure,
                  'public.liberar_reservas_vencidas(integer)'::regprocedure,
                  'public.purgar_intentos_checkout(integer)'::regprocedure,
                  'public.admin_cancelar_pedido(uuid)'::regprocedure,
                  'public.admin_actualizar_preparacion(uuid, text, text, text)'::regprocedure,
                  'public.admin_actualizar_notas(uuid, text)'::regprocedure,
                  'public.admin_resolver_faltante(uuid)'::regprocedure,
                  'public.admin_marcar_resuelto(uuid)'::regprocedure,
                  'public.admin_actualizar_limites(integer, integer, integer, integer, integer, integer)'::regprocedure,
                  'public.configuracion_checkout()'::regprocedure,
                  'public.consultar_pedido(text, text)'::regprocedure)),
  'todas las funciones públicas de pedidos: security definer con search_path vacío'
);
select ok(
  (select bool_and(proconfig @> array['search_path=""']) from pg_proc where pronamespace = 'private'::regnamespace),
  'todas las funciones internas tienen search_path vacío'
);
select ok(
  not has_schema_privilege('anon', 'private', 'usage') and not has_schema_privilege('authenticated', 'private', 'usage')
  and not has_schema_privilege('service_role', 'private', 'usage'),
  'nadie de la API tiene acceso al esquema private'
);
select ok(
  not exists (select 1 from pg_proc p where p.pronamespace = 'private'::regnamespace
                and (has_function_privilege('anon', p.oid, 'execute') or has_function_privilege('authenticated', p.oid, 'execute')
                     or has_function_privilege('service_role', p.oid, 'execute'))),
  'ninguna función interna (aplicar_pago incluida) es ejecutable desde la API'
);
select ok(not has_function_privilege('anon', 'public.crear_pedido(text, jsonb, jsonb, jsonb, numeric, inet)', 'execute'), 'anon no puede llamar a crear_pedido (la IP la pone el servidor)');
select ok(not has_function_privilege('authenticated', 'public.crear_pedido(text, jsonb, jsonb, jsonb, numeric, inet)', 'execute'), 'authenticated no puede llamar a crear_pedido');
select ok(has_function_privilege('service_role', 'public.crear_pedido(text, jsonb, jsonb, jsonb, numeric, inet)', 'execute'), 'service_role (servidor) puede crear pedidos');
select ok(not has_function_privilege('anon', 'public.liberar_reservas_vencidas(integer)', 'execute')
          and not has_function_privilege('authenticated', 'public.liberar_reservas_vencidas(integer)', 'execute'),
  'ni anon ni authenticated pueden ejecutar la liberación');
select ok(not has_function_privilege('anon', 'public.consultar_pedido(text, text)', 'execute')
          and not has_function_privilege('authenticated', 'public.consultar_pedido(text, text)', 'execute')
          and has_function_privilege('service_role', 'public.consultar_pedido(text, text)', 'execute'),
  'la consulta por token es solo del servidor: el token no viaja del navegador a la API');
select ok(not has_function_privilege('anon', 'public.admin_cancelar_pedido(uuid)', 'execute')
          and not has_function_privilege('anon', 'public.admin_actualizar_limites(integer, integer, integer, integer, integer, integer)', 'execute'),
  'anon no puede ejecutar operaciones del panel');
select ok(
  not exists (select 1 from unnest(array['public.orders', 'public.order_items', 'public.order_events', 'public.checkout_attempts', 'public.store_settings']) t,
                            unnest(array['anon', 'authenticated', 'service_role']) r,
                            unnest(array['insert', 'update', 'delete', 'truncate']) priv
               where has_table_privilege(r, t, priv)),
  'ningún rol de la API puede escribir pedidos, artículos, eventos, intentos ni configuración'
);

-- ---------------------------------------------------------------------------
-- Datos de prueba
-- ---------------------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email) values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'user@test.local');
insert into public.admin_users (user_id) values ('00000000-0000-0000-0000-0000000000a1');

insert into public.categories (id, name, slug, is_active) values
  ('10000000-0000-0000-0000-000000000001', 'Activa', 'activa', true),
  ('10000000-0000-0000-0000-000000000002', 'Inactiva', 'inactiva', false);
insert into public.products (id, sku, name, slug, category_id, price_ars, stock, is_active) values
  ('20000000-0000-0000-0000-000000000001', 'P-1', 'Producto 1', 'p1', '10000000-0000-0000-0000-000000000001', 1000, 100, true),
  ('20000000-0000-0000-0000-000000000002', 'P-2', 'Producto 2', 'p2', '10000000-0000-0000-0000-000000000001', 2500.50, 5, true),
  ('20000000-0000-0000-0000-000000000003', 'P-3', 'Producto 3 inactivo', 'p3', '10000000-0000-0000-0000-000000000001', 100, 10, false),
  ('20000000-0000-0000-0000-000000000004', 'P-4', 'Producto 4 cat inactiva', 'p4', '10000000-0000-0000-0000-000000000002', 100, 10, true),
  ('20000000-0000-0000-0000-000000000005', 'P-5', 'Producto 5', 'p5', '10000000-0000-0000-0000-000000000001', 30000, 10, true),
  ('20000000-0000-0000-0000-000000000006', 'P-6', 'Producto 6 última unidad', 'p6', '10000000-0000-0000-0000-000000000001', 500, 1, true);

insert into public.shipping_zones (id, name, price_ars, free_from_ars) values
  ('50000000-0000-0000-0000-000000000001', 'AMBA', 5000, 60000);
insert into public.shipping_zone_provinces (province_code, zone_id) values
  ('AR-C', '50000000-0000-0000-0000-000000000001'), ('AR-B', '50000000-0000-0000-0000-000000000001');

-- clave de idempotencia de prueba (38 caracteres)
create function pg_temp.k(n integer) returns text language sql as $$ select 'clave-prueba-' || lpad(n::text, 4, '0') || '-' || repeat('a', 20) $$;
create function pg_temp.it(n integer, q integer) returns jsonb language sql as $$
  select jsonb_build_object('product_id', ('20000000-0000-0000-0000-00000000000' || n)::uuid, 'quantity', q) $$;
create function pg_temp.pedir(p_key text, p_email text, p_items jsonb, p_total numeric, p_ip text default '198.51.100.1',
                              p_province text default 'AR-C', p_name text default 'Comprador Test')
returns jsonb language sql as $$
  select public.crear_pedido(p_key,
    jsonb_build_object('name', p_name, 'email', p_email, 'phone', '+54 11 5555-0000'),
    jsonb_build_object('street', 'Av. Siempre Viva', 'number', '742', 'city', 'Ciudad', 'postal_code', 'C1000AAA', 'province_code', p_province),
    p_items, p_total, p_ip::inet) $$;
create function pg_temp.stock(n integer) returns integer language sql as $$
  select stock from public.products where id = ('20000000-0000-0000-0000-00000000000' || n)::uuid $$;
create function pg_temp.pedido(p_code text) returns public.orders language sql as $$ select * from public.orders where code = p_code $$;
-- simula el paso del tiempo: adelanta el vencimiento (las pruebas no pueden mover now())
create function pg_temp.vencer(p_code text) returns void language plpgsql as $$
begin
  alter table public.orders disable trigger orders_validar_cambios;
  update public.orders set reservation_expires_at = now() - interval '1 minute' where code = p_code;
  alter table public.orders enable trigger orders_validar_cambios;
end $$;
create function pg_temp.guardar(p_name text, p_res jsonb) returns jsonb language sql as $$
  select set_config('test.' || p_name, p_res::text, true)::jsonb $$;
create function pg_temp.r(p_name text) returns jsonb language sql as $$ select current_setting('test.' || p_name)::jsonb $$;

-- ---------------------------------------------------------------------------
-- Checkout deshabilitado y bloqueo de checkout_enabled
-- ---------------------------------------------------------------------------

select is(pg_temp.pedir(pg_temp.k(1), 'a@test.com', jsonb_build_array(pg_temp.it(1, 1)), 6000) ->> 'error', 'checkout_disabled',
  'checkout deshabilitado: el pedido se rechaza');
select is(pg_temp.stock(1), 100, 'checkout deshabilitado: el stock no cambió');
select is((select count(*) from public.orders), 0::bigint, 'checkout deshabilitado: no se creó ningún pedido');
select is((select error_code from public.checkout_attempts order by id desc limit 1), 'checkout_disabled', 'el intento rechazado quedó registrado');

set local role service_role;
select throws_ok($$ update public.store_settings set checkout_enabled = true $$, '42501', null, 'service_role no puede habilitar el checkout');
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select throws_ok($$ update public.store_settings set checkout_enabled = true $$, '42501', null, 'un administrador no puede habilitar el checkout');
select lives_ok($$ select public.admin_actualizar_limites(30, 5, 20, 2, 5, 30) $$, 'un administrador puede editar los límites');
select is((select checkout_enabled from public.store_settings), false, 'editar los límites no habilita el checkout');
select throws_ok($$ select public.admin_actualizar_limites(30, 10, 5, 2, 5, 30) $$, '23514', null, 'límites incoherentes rechazados (por producto > por pedido)');
select throws_ok($$ select public.admin_actualizar_limites(2, 5, 20, 2, 5, 30) $$, '23514', null, 'reserva de menos de 5 minutos rechazada');
reset role;

-- habilitado solo dentro de esta prueba (postgres = migración / SQL Editor)
update public.store_settings set checkout_enabled = true;

-- ---------------------------------------------------------------------------
-- Pedido con varios productos
-- ---------------------------------------------------------------------------
-- P1 ×2 = 2000 + P2 ×3 = 7501,50 → subtotal 9501,50 + envío 5000 = 14501,50

set local role service_role;
select pg_temp.guardar('b', public.crear_pedido(pg_temp.k(2),
  '{"name":"  Ana   Pérez ","email":"Ana@Test.COM","phone":"+54 11 5555-0000","document":"30.123.456"}',
  '{"street":"Av. Corrientes","number":"1234","unit":"3 B","city":"CABA","postal_code":"c1043aaa","province_code":"AR-C"}',
  jsonb_build_array(pg_temp.it(2, 3), pg_temp.it(1, 2)), 14501.50, '198.51.100.10'));
reset role;

select is(pg_temp.r('b') ->> 'status', 'created', 'service_role crea un pedido con dos productos');
select ok(pg_temp.r('b') ->> 'code' ~ ('^STF-' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYMM') || '-[2-9A-HJ-NP-Z]{4}$'),
  'código STF-AAMM-XXXX con el año y mes actuales');
select ok(pg_temp.r('b') ->> 'token' ~ '^[A-Za-z0-9_-]{43}$', 'token de consulta de 256 bits en base64url');
select results_eq(
  $$ select (pg_temp.r('b') ->> 'subtotal_ars')::numeric, (pg_temp.r('b') ->> 'shipping_ars')::numeric, (pg_temp.r('b') ->> 'total_ars')::numeric $$,
  $$ values (9501.50::numeric, 5000::numeric, 14501.50::numeric) $$,
  'importes calculados por la base'
);
select is(pg_temp.stock(1), 98, 'se reservaron 2 unidades de P1');
select is(pg_temp.stock(2), 2, 'se reservaron 3 unidades de P2');
select results_eq(
  $$ select sku, name, unit_price_ars, quantity, line_total_ars from public.order_items
      where order_id = (pg_temp.r('b') ->> 'order_id')::uuid order by sku $$,
  $$ values ('P-1'::text, 'Producto 1'::text, 1000.00::numeric(12,2), 2, 2000.00::numeric(12,2)),
            ('P-2'::text, 'Producto 2'::text, 2500.50::numeric(12,2), 3, 7501.50::numeric(12,2)) $$,
  'artículos con SKU, nombre y precio históricos'
);
select results_eq(
  $$ select buyer_name, buyer_email, buyer_document, ship_postal_code, ship_unit, shipping_zone_name, shipping_rate_ars, shipping_free_from_ars,
            payment_status, fulfillment_status, resolution_status, stock_state
       from pg_temp.pedido(pg_temp.r('b') ->> 'code') $$,
  $$ values ('Ana Pérez'::text, 'ana@test.com'::text, '30123456'::text, 'C1043AAA'::text, '3 B'::text, 'AMBA'::text,
             5000.00::numeric(12,2), 60000.00::numeric(12,2), 'pending'::text, 'pending'::text, 'none'::text, 'reserved'::text) $$,
  'datos normalizados, zona y tarifa históricas, estados iniciales'
);
select is((pg_temp.pedido(pg_temp.r('b') ->> 'code')).reservation_expires_at, now() + interval '30 minutes', 'la reserva vence a los 30 minutos');
select is((pg_temp.pedido(pg_temp.r('b') ->> 'code')).access_token_hash, sha256(convert_to(pg_temp.r('b') ->> 'token', 'UTF8')),
  'la base guarda solo el hash del token');
select ok(
  not exists (select 1 from public.orders o where position(convert_to(pg_temp.r('b') ->> 'token', 'UTF8') in o.access_token_hash) > 0)
  and not exists (select 1 from public.orders o, lateral (select to_jsonb(o) j) x where x.j::text like '%' || (pg_temp.r('b') ->> 'token') || '%'),
  'el token no aparece en claro en ninguna columna'
);
select results_eq(
  $$ select event_type, actor from public.order_events where order_id = (pg_temp.r('b') ->> 'order_id')::uuid $$,
  $$ values ('created'::text, 'checkout'::text) $$,
  'evento de creación registrado'
);
select results_eq(
  $$ select outcome, order_id from public.checkout_attempts order by id desc limit 1 $$,
  $$ values ('created'::text, (pg_temp.r('b') ->> 'order_id')::uuid) $$,
  'intento exitoso registrado'
);

-- ---------------------------------------------------------------------------
-- Idempotencia
-- ---------------------------------------------------------------------------

select pg_temp.guardar('b2', public.crear_pedido(pg_temp.k(2),
  '{"name":"Ana Pérez","email":"ana@test.com","phone":"+54 11 5555-0000","document":"30123456"}',
  '{"street":"Av. Corrientes","number":"1234","unit":"3 B","city":"CABA","postal_code":"C1043AAA","province_code":"AR-C"}',
  jsonb_build_array(pg_temp.it(1, 2), pg_temp.it(2, 3)), 14501.50, '198.51.100.10'));
select results_eq(
  $$ select pg_temp.r('b2') ->> 'status', pg_temp.r('b2') ->> 'code', pg_temp.r('b2') ->> 'token' $$,
  $$ select 'replayed'::text, pg_temp.r('b') ->> 'code', pg_temp.r('b') ->> 'token' $$,
  'reintento con la misma clave (mismo contenido, otro orden y formato): mismo pedido y mismo token'
);
select is(pg_temp.stock(1) + pg_temp.stock(2), 100, 'el reintento no volvió a descontar stock');
select is((select count(*) from public.orders), 1::bigint, 'el reintento no creó otro pedido');
select is(
  pg_temp.pedir(pg_temp.k(2), 'ana@test.com', jsonb_build_array(pg_temp.it(1, 1), pg_temp.it(2, 3)), 13501.50, '198.51.100.10') ->> 'error',
  'idempotency_conflict', 'misma clave con otra cantidad: rechazada'
);
select is(
  public.crear_pedido(pg_temp.k(2),
    '{"name":"Otra Persona","email":"ana@test.com","phone":"+54 11 5555-0000","document":"30123456"}',
    '{"street":"Av. Corrientes","number":"1234","unit":"3 B","city":"CABA","postal_code":"C1043AAA","province_code":"AR-C"}',
    jsonb_build_array(pg_temp.it(1, 2), pg_temp.it(2, 3)), 14501.50, '198.51.100.10') ->> 'error',
  'idempotency_conflict', 'misma clave con otro comprador: rechazada (no devuelve el pedido anterior)'
);
select is((select count(*) from public.orders), 1::bigint, 'los conflictos no crearon pedidos');
select is(pg_temp.pedir('corta', 'x@test.com', jsonb_build_array(pg_temp.it(1, 1)), 6000, '198.51.100.99') -> 'detail',
  '{"fields": ["idempotency_key"]}'::jsonb, 'clave de idempotencia demasiado corta: rechazada');
select is((select error_code from public.checkout_attempts where ip_hash = private.hash_ip('198.51.100.99')), 'invalid_input',
  'la clave mal formada también cuenta como intento (no se puede eludir el límite con errores)');
select throws_ok($$ select public.crear_pedido(pg_temp.k(3), '{}', '{}', '[]', 1, null) $$, '22023', null, 'falta la IP del cliente: error de integración');

-- ---------------------------------------------------------------------------
-- Productos, stock, precios y envío
-- ---------------------------------------------------------------------------

select is(pg_temp.pedir(pg_temp.k(10), 'c1@test.com', jsonb_build_array(pg_temp.it(3, 1)), 5100, '198.51.100.11') ->> 'error',
  'product_unavailable', 'producto inactivo: rechazado');
select is(pg_temp.pedir(pg_temp.k(11), 'c1@test.com', jsonb_build_array(pg_temp.it(4, 1)), 5100, '198.51.100.11') ->> 'error',
  'product_unavailable', 'producto de una categoría inactiva: rechazado');
select is(pg_temp.pedir(pg_temp.k(12), 'c1@test.com', '[{"product_id":"20000000-0000-0000-0000-0000000000ff","quantity":1}]', 5100, '198.51.100.11') ->> 'error',
  'product_unavailable', 'producto inexistente: rechazado');
select pg_temp.guardar('sin_stock', pg_temp.pedir(pg_temp.k(13), 'c1@test.com', jsonb_build_array(pg_temp.it(1, 1), pg_temp.it(6, 2)), 7000, '198.51.100.11'));
select is(pg_temp.r('sin_stock') ->> 'error', 'insufficient_stock', 'stock insuficiente: rechazado');
select is(pg_temp.r('sin_stock') -> 'detail', '{"product_ids": ["20000000-0000-0000-0000-000000000006"]}'::jsonb,
  'el rechazo indica el producto pero no el stock exacto');
select is(pg_temp.stock(1), 98, 'stock insuficiente en una línea: tampoco se descontó la otra');

update public.products set price_ars = 1200 where id = '20000000-0000-0000-0000-000000000001';
select pg_temp.guardar('precio', pg_temp.pedir(pg_temp.k(14), 'c1@test.com', jsonb_build_array(pg_temp.it(1, 1)), 6000, '198.51.100.11'));
select is(pg_temp.r('precio') ->> 'error', 'total_mismatch', 'precio cambiado antes de confirmar: rechazado');
select is(pg_temp.r('precio') -> 'detail', '{"subtotal_ars": 1200.00, "shipping_ars": 5000.00, "total_ars": 6200.00}'::jsonb,
  'el rechazo devuelve el total vigente calculado por la base');
select is(pg_temp.stock(1), 98, 'precio cambiado: no se reservó stock');
update public.products set price_ars = 1000 where id = '20000000-0000-0000-0000-000000000001';
select is(pg_temp.pedir(pg_temp.k(15), 'c1@test.com', jsonb_build_array(pg_temp.it(1, 1)), 1, '198.51.100.11') ->> 'error',
  'total_mismatch', 'un total más bajo enviado por el navegador no se acepta');

select is(pg_temp.pedir(pg_temp.k(16), 'c1@test.com', jsonb_build_array(pg_temp.it(1, 1)), 6000, '198.51.100.11', 'AR-V') ->> 'error',
  'no_shipping_coverage', 'provincia sin cobertura: rechazado');

-- P5 ×2 = 60000 = umbral exacto de envío gratis
select pg_temp.guardar('gratis', pg_temp.pedir(pg_temp.k(17), 'c2@test.com', jsonb_build_array(pg_temp.it(5, 2)), 60000, '198.51.100.12'));
select results_eq(
  $$ select pg_temp.r('gratis') ->> 'status', (pg_temp.r('gratis') ->> 'shipping_ars')::numeric, (pg_temp.r('gratis') ->> 'total_ars')::numeric $$,
  $$ values ('created'::text, 0::numeric, 60000::numeric) $$,
  'subtotal exactamente en el umbral: envío gratis'
);

-- ---------------------------------------------------------------------------
-- Validación de datos y límites de cantidades
-- ---------------------------------------------------------------------------

select is(
  public.crear_pedido(pg_temp.k(20), '{"name":"A","email":"no-es-email","phone":"12"}',
    '{"street":"X","number":"","city":"C","postal_code":"ABC","province_code":"AR-ZZ"}',
    jsonb_build_array(pg_temp.it(1, 1)), 6000, '198.51.100.13') -> 'detail' -> 'fields',
  '["buyer.name", "buyer.email", "buyer.phone", "shipping.street", "shipping.number", "shipping.city", "shipping.postal_code", "shipping.province_code"]'::jsonb,
  'datos inválidos: se informan todos los campos'
);
select is(
  public.crear_pedido(pg_temp.k(21), '{"name":"Ana","email":"a@test.com","phone":"1155550000","price":1}',
    '{"street":"Calle","number":"1","city":"Ciudad","postal_code":"1000","province_code":"AR-C"}',
    jsonb_build_array(pg_temp.it(1, 1)), 6000, '198.51.100.13') -> 'detail' -> 'fields',
  '["buyer"]'::jsonb, 'claves desconocidas rechazadas (no se aceptan precios del navegador)'
);
select is(pg_temp.pedir(pg_temp.k(22), 'c3@test.com', '[{"product_id":"20000000-0000-0000-0000-000000000001","quantity":1,"price":1}]', 6000, '198.51.100.13') ->> 'error',
  'invalid_input', 'un artículo con precio enviado por el navegador se rechaza');
select is(pg_temp.pedir(pg_temp.k(23), 'c3@test.com', jsonb_build_array(pg_temp.it(1, 1), pg_temp.it(1, 2)), 8000, '198.51.100.13') -> 'detail',
  '{"fields": ["items.duplicate"]}'::jsonb, 'producto repetido en el pedido: rechazado');
select is(pg_temp.pedir(pg_temp.k(24), 'c3@test.com', jsonb_build_array(pg_temp.it(1, 0)), 5000, '198.51.100.13') ->> 'error',
  'invalid_input', 'cantidad cero: rechazada');
select is(pg_temp.pedir(pg_temp.k(25), 'c3@test.com', '[]', 5000, '198.51.100.13') ->> 'error', 'invalid_input', 'pedido sin artículos: rechazado');
select is(pg_temp.pedir(pg_temp.k(26), 'c3@test.com', jsonb_build_array(pg_temp.it(1, 6)), 11000, '198.51.100.13') ->> 'error',
  'quantity_limit', 'más de 5 unidades de un producto: rechazado');
update public.store_settings set max_units_per_product = 3, max_units_per_order = 5;
select is(pg_temp.pedir(pg_temp.k(27), 'c3@test.com', jsonb_build_array(pg_temp.it(1, 3), pg_temp.it(2, 3)), 15501.50, '198.51.100.13') -> 'detail',
  '{"max_units_per_order": 5}'::jsonb, 'más unidades que el máximo por pedido: rechazado');
update public.store_settings set max_units_per_product = 5, max_units_per_order = 20;
select is(pg_temp.stock(1), 98, 'ningún rechazo de validación tocó el stock');

-- ---------------------------------------------------------------------------
-- Antiabuso
-- ---------------------------------------------------------------------------

select is(pg_temp.pedir(pg_temp.k(30), 'repite@test.com', jsonb_build_array(pg_temp.it(1, 1)), 6000, '198.51.100.20') ->> 'status', 'created', 'primer pedido pendiente del email');
select is(pg_temp.pedir(pg_temp.k(31), 'repite@test.com', jsonb_build_array(pg_temp.it(1, 1)), 6000, '198.51.100.21') ->> 'status', 'created', 'segundo pedido pendiente del email');
select is(pg_temp.pedir(pg_temp.k(32), 'REPITE@test.com', jsonb_build_array(pg_temp.it(1, 1)), 6000, '198.51.100.22') ->> 'error',
  'too_many_pending_orders', 'tercer pedido pendiente del mismo email (sin distinguir mayúsculas): rechazado');

select is(
  (select count(*) from generate_series(40, 44) n
    where pg_temp.pedir(pg_temp.k(n), 'ip' || n || '@test.com', jsonb_build_array(pg_temp.it(1, 1)), 6000, '203.0.113.50') ->> 'status' = 'created'),
  5::bigint, 'cinco pedidos desde la misma IP en una hora'
);
select is(pg_temp.pedir(pg_temp.k(45), 'ip45@test.com', jsonb_build_array(pg_temp.it(1, 1)), 6000, '203.0.113.50') ->> 'error',
  'too_many_orders', 'sexto pedido desde la misma IP en la hora: rechazado');
select is(pg_temp.pedir(pg_temp.k(46), 'ip46@test.com', jsonb_build_array(pg_temp.it(1, 1)), 6000, '203.0.113.51') ->> 'status',
  'created', 'otra IP no está afectada');

update public.store_settings set max_orders_per_ip_hour = 1, max_attempts_per_ip_hour = 3;
select pg_temp.pedir(pg_temp.k(50 + n), 'x@test.com', '[]', 1, '203.0.113.60') from generate_series(0, 2) n;
select is(pg_temp.pedir(pg_temp.k(53), 'ok53@test.com', jsonb_build_array(pg_temp.it(1, 1)), 6000, '203.0.113.60') ->> 'error',
  'too_many_attempts', 'demasiados intentos (aunque fallidos) desde la misma IP: rechazado aun con datos válidos');
update public.store_settings set max_orders_per_ip_hour = 5, max_attempts_per_ip_hour = 30;

select ok(private.hash_ip('2001:db8:1:2::1') = private.hash_ip('2001:db8:1:2:ffff::9'), 'IPv6: la misma /64 cuenta como un solo cliente');
select ok(private.hash_ip('2001:db8:1:2::1') <> private.hash_ip('2001:db8:1:3::1'), 'IPv6: otra /64 es otro cliente');
select ok(private.hash_ip('198.51.100.1') <> sha256(convert_to('198.51.100.1', 'UTF8')), 'el hash de IP usa una clave secreta (no es un sha256 reversible por diccionario)');

-- ---------------------------------------------------------------------------
-- Vencimiento de reservas
-- ---------------------------------------------------------------------------

select pg_temp.guardar('venc', pg_temp.pedir(pg_temp.k(60), 'venc@test.com', jsonb_build_array(pg_temp.it(2, 1)), 7500.50, '198.51.100.30'));
select is(pg_temp.stock(2), 1, 'reserva: P2 bajó a 1');
select is(public.liberar_reservas_vencidas(), 0, 'antes del vencimiento no se libera nada');
select pg_temp.vencer(pg_temp.r('venc') ->> 'code');
select is(public.liberar_reservas_vencidas(), 1, 'vencida: se libera una reserva');
select is(pg_temp.stock(2), 2, 'las unidades volvieron al stock');
select results_eq(
  $$ select payment_status, stock_state, stock_released_at is not null from pg_temp.pedido(pg_temp.r('venc') ->> 'code') $$,
  $$ values ('expired'::text, 'released'::text, true) $$,
  'pedido vencido: pago expired, stock released'
);
select is(public.liberar_reservas_vencidas(), 0, 'segunda ejecución: no libera nada');
select is(private.liberar_reserva((pg_temp.r('venc') ->> 'order_id')::uuid, 'expired', 'system'), false, 'liberar directamente otra vez: no hace nada');
select is(pg_temp.stock(2), 2, 'el stock se devolvió exactamente una vez');
select is((select count(*) from public.order_events where order_id = (pg_temp.r('venc') ->> 'order_id')::uuid and event_type = 'reservation_expired'),
  1::bigint, 'un solo evento de vencimiento');
select throws_ok($$ select public.liberar_reservas_vencidas(0) $$, '22023', null, 'límite inválido rechazado');

-- cancelación de un pedido ya vencido (pero aún no liberado) y vencimiento después
select pg_temp.guardar('canc', pg_temp.pedir(pg_temp.k(61), 'canc@test.com', jsonb_build_array(pg_temp.it(2, 2)), 10001, '198.51.100.31'));
select pg_temp.vencer(pg_temp.r('canc') ->> 'code');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select lives_ok(format('select public.admin_cancelar_pedido(%L)', pg_temp.r('canc') ->> 'order_id'), 'el administrador cancela el pedido');
select throws_ok(format('select public.admin_cancelar_pedido(%L)', pg_temp.r('canc') ->> 'order_id'), '55000', null, 'cancelar dos veces: rechazado');
reset role;
select is(public.liberar_reservas_vencidas(), 0, 'el vencimiento posterior no vuelve a liberar');
select is(pg_temp.stock(2), 2, 'cancelación + vencimiento: el stock volvió una sola vez');
select results_eq(
  $$ select payment_status, stock_state, cancelled_at is not null from pg_temp.pedido(pg_temp.r('canc') ->> 'code') $$,
  $$ values ('cancelled'::text, 'released'::text, true) $$,
  'pedido cancelado'
);

-- ---------------------------------------------------------------------------
-- Pagos (simulados con la función interna, sin Mercado Pago)
-- ---------------------------------------------------------------------------

select pg_temp.guardar('pago', pg_temp.pedir(pg_temp.k(70), 'pago@test.com', jsonb_build_array(pg_temp.it(1, 1)), 6000, '198.51.100.40'));
select is(pg_temp.stock(1), 89, 'P1 antes del pago');
select is(private.aplicar_pago((pg_temp.r('pago') ->> 'order_id')::uuid, 'mp-rech-1', 'rejected', 6000), 'rejected_recorded', 'pago rechazado: se registra');
select is((pg_temp.pedido(pg_temp.r('pago') ->> 'code')).payment_status, 'pending', 'un pago rechazado no cambia el pedido');
select is(private.aplicar_pago((pg_temp.r('pago') ->> 'order_id')::uuid, 'mp-1', 'approved', 6000), 'approved', 'pago aprobado antes del vencimiento');
select results_eq(
  $$ select payment_status, stock_state, paid_at is not null from pg_temp.pedido(pg_temp.r('pago') ->> 'code') $$,
  $$ values ('approved'::text, 'consumed'::text, true) $$,
  'pago aprobado: la reserva pasa a consumida'
);
select is(pg_temp.stock(1), 89, 'el pago no volvió a descontar stock');
select is(private.aplicar_pago((pg_temp.r('pago') ->> 'order_id')::uuid, 'mp-1', 'approved', 6000), 'already_applied', 'notificación repetida del mismo pago: sin efecto');
select is(public.liberar_reservas_vencidas(), 0, 'un pedido pagado no se libera');
select is(private.aplicar_pago((pg_temp.r('pago') ->> 'order_id')::uuid, 'mp-2', 'approved', 6000), 'duplicate', 'segundo pago aprobado: duplicado');
select results_eq(
  $$ select payment_status, stock_state, resolution_status, resolution_reason from pg_temp.pedido(pg_temp.r('pago') ->> 'code') $$,
  $$ values ('approved'::text, 'consumed'::text, 'pending'::text, 'duplicate_payment'::text) $$,
  'pago duplicado: queda pendiente de resolución, sin tocar el stock'
);
select is(pg_temp.stock(1), 89, 'el pago duplicado no descontó stock');

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select throws_ok(format('select public.admin_actualizar_preparacion(%L, %L)', pg_temp.r('pago') ->> 'order_id', 'preparing'), '55000', null,
  'con resolución pendiente no se puede preparar');
select throws_ok(format('select public.admin_cancelar_pedido(%L)', pg_temp.r('pago') ->> 'order_id'), '55000', null, 'un pedido pagado no se cancela desde el panel');
select lives_ok(format('select public.admin_marcar_resuelto(%L)', pg_temp.r('pago') ->> 'order_id'), 'el administrador marca resuelto el duplicado');
select lives_ok(format('select public.admin_actualizar_preparacion(%L, %L)', pg_temp.r('pago') ->> 'order_id', 'preparing'), 'pedido pagado: pasa a preparación');
select throws_ok(format('select public.admin_actualizar_preparacion(%L, %L)', pg_temp.r('pago') ->> 'order_id', 'shipped'), '22023', null,
  'despachar sin transporte: rechazado');
select lives_ok(format('select public.admin_actualizar_preparacion(%L, %L, %L, %L)', pg_temp.r('pago') ->> 'order_id', 'shipped', 'Correo Argentino', 'CA123'),
  'despacho con transporte y seguimiento');
select lives_ok(format('select public.admin_actualizar_preparacion(%L, %L)', pg_temp.r('pago') ->> 'order_id', 'delivered'), 'entregado');
select throws_ok(format('select public.admin_actualizar_preparacion(%L, %L)', pg_temp.r('pago') ->> 'order_id', 'preparing'), 'SR002', null,
  'entregado → preparación: transición no permitida');
select lives_ok(format('select public.admin_actualizar_notas(%L, %L)', pg_temp.r('pago') ->> 'order_id', 'Cliente pidió factura A'), 'notas internas');
reset role;
select is(
  (select array_agg(event_type order by id) from public.order_events where order_id = (pg_temp.r('pago') ->> 'order_id')::uuid),
  array['created', 'payment_rejected', 'payment_approved', 'payment_duplicate', 'resolution_resolved',
        'fulfillment_changed', 'fulfillment_changed', 'fulfillment_changed', 'notes_updated'],
  'historial completo de eventos del pedido'
);

-- pago aprobado después del vencimiento, con stock disponible
select pg_temp.guardar('tarde', pg_temp.pedir(pg_temp.k(71), 'tarde@test.com', jsonb_build_array(pg_temp.it(1, 2)), 7000, '198.51.100.41'));
select pg_temp.vencer(pg_temp.r('tarde') ->> 'code');
select is(public.liberar_reservas_vencidas(), 1, 'pedido tardío: reserva liberada');
select is(pg_temp.stock(1), 89, 'P1 recuperó las 2 unidades');
select is(private.aplicar_pago((pg_temp.r('tarde') ->> 'order_id')::uuid, 'mp-3', 'approved', 7000), 'approved_late', 'pago después del vencimiento con stock: aprobado');
select results_eq(
  $$ select payment_status, stock_state, resolution_status from pg_temp.pedido(pg_temp.r('tarde') ->> 'code') $$,
  $$ values ('approved'::text, 'consumed'::text, 'none'::text) $$,
  'pago tardío con stock: se vuelve a reservar y consumir'
);
select is(pg_temp.stock(1), 87, 'pago tardío: se descontaron de nuevo las 2 unidades');

-- pago aprobado después del vencimiento, sin stock (alguien compró la última unidad)
select pg_temp.guardar('falta', pg_temp.pedir(pg_temp.k(72), 'falta@test.com', jsonb_build_array(pg_temp.it(6, 1)), 5500, '198.51.100.42'));
select pg_temp.vencer(pg_temp.r('falta') ->> 'code');
select is(public.liberar_reservas_vencidas(), 1, 'reserva de la última unidad liberada');
select is(pg_temp.pedir(pg_temp.k(73), 'otro@test.com', jsonb_build_array(pg_temp.it(6, 1)), 5500, '198.51.100.43') ->> 'status', 'created',
  'otro comprador se lleva la última unidad');
select is(private.aplicar_pago((pg_temp.r('falta') ->> 'order_id')::uuid, 'mp-4', 'approved', 5500), 'approved_shortage', 'pago tardío sin stock');
select results_eq(
  $$ select payment_status, stock_state, resolution_status, resolution_reason from pg_temp.pedido(pg_temp.r('falta') ->> 'code') $$,
  $$ values ('approved'::text, 'shortage'::text, 'pending'::text, 'stock_shortage'::text) $$,
  'pago sin stock: pendiente de resolución'
);
select is(pg_temp.stock(6), 0, 'el stock no quedó negativo');
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select throws_ok(format('select public.admin_actualizar_preparacion(%L, %L)', pg_temp.r('falta') ->> 'order_id', 'preparing'), '55000', null,
  'pedido sin stock: no puede pasar a preparación');
select throws_ok(format('select public.admin_marcar_resuelto(%L)', pg_temp.r('falta') ->> 'order_id'), '55000', null,
  'un faltante no se puede marcar resuelto sin stock');
select throws_ok(format('select public.admin_resolver_faltante(%L)', pg_temp.r('falta') ->> 'order_id'), '55000', null,
  'resolver el faltante sin unidades: rechazado');
reset role;
select throws_ok(format('update public.orders set fulfillment_status = %L where id = %L', 'preparing', pg_temp.r('falta') ->> 'order_id'), 'SR002', null,
  'ni siquiera postgres puede preparar un pedido con faltante');
update public.products set stock = 1 where id = '20000000-0000-0000-0000-000000000006';
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select lives_ok(format('select public.admin_resolver_faltante(%L)', pg_temp.r('falta') ->> 'order_id'), 'con stock repuesto, el faltante se resuelve');
reset role;
select results_eq(
  $$ select stock_state, resolution_status, pg_temp.stock(6) from pg_temp.pedido(pg_temp.r('falta') ->> 'code') $$,
  $$ values ('consumed'::text, 'resolved'::text, 0) $$,
  'faltante resuelto: unidades consumidas'
);

-- importe distinto al total
select pg_temp.guardar('monto', pg_temp.pedir(pg_temp.k(74), 'monto@test.com', jsonb_build_array(pg_temp.it(1, 1)), 6000, '198.51.100.44'));
select is(private.aplicar_pago((pg_temp.r('monto') ->> 'order_id')::uuid, 'mp-5', 'approved', 100), 'amount_mismatch', 'pago por un importe distinto: no se aprueba');
select results_eq(
  $$ select payment_status, stock_state, resolution_reason from pg_temp.pedido(pg_temp.r('monto') ->> 'code') $$,
  $$ values ('pending'::text, 'reserved'::text, 'amount_mismatch'::text) $$,
  'importe distinto: pedido sin pagar y pendiente de revisión'
);

-- ---------------------------------------------------------------------------
-- Transiciones e inmutabilidad (aun para postgres)
-- ---------------------------------------------------------------------------

select throws_ok(format('update public.orders set total_ars = 1, subtotal_ars = 1, shipping_ars = 0 where id = %L', pg_temp.r('pago') ->> 'order_id'), 'SR002', null,
  'los importes de un pedido no se pueden modificar');
select throws_ok(format('update public.orders set payment_status = %L, stock_state = %L, paid_at = null where id = %L', 'pending', 'reserved', pg_temp.r('pago') ->> 'order_id'),
  'SR002', null, 'aprobado → pendiente: transición no permitida');
select throws_ok(format('update public.orders set payment_status = %L, stock_state = %L, paid_at = now() where id = %L', 'approved', 'released', pg_temp.r('venc') ->> 'order_id'),
  '23514', null, 'aprobado con el stock liberado: estado incoherente rechazado por los CHECK');
select throws_ok(format('update public.orders set stock_state = %L, stock_released_at = null where id = %L', 'reserved', pg_temp.r('venc') ->> 'order_id'),
  'SR002', null, 'liberado → reservado: no permitido (evita devolver el stock dos veces)');
select throws_ok($$ update public.order_items set quantity = 1 $$, 'SR002', null, 'los artículos son de solo inserción');
select throws_ok($$ update public.order_events set event_type = 'created' $$, 'SR002', null, 'los eventos son de solo inserción');
select throws_ok(format('delete from public.products where id = %L', '20000000-0000-0000-0000-000000000001'), '23503', null,
  'un producto con pedidos no se puede borrar');

-- ---------------------------------------------------------------------------
-- Fallo a mitad de la transacción: sin modificaciones parciales
-- ---------------------------------------------------------------------------
-- La falla se inyecta al insertar los artículos, después de descontar el stock y crear el pedido.

create function public.tmp_falla_inyectada() returns trigger language plpgsql as $$
begin
  raise exception 'falla_simulada' using errcode = current_setting('test.falla_errcode');
end $$;
create trigger tmp_falla after insert on public.order_items for each statement execute function public.tmp_falla_inyectada();

select set_config('test.orders_antes', (select count(*) from public.orders)::text, true);
select set_config('test.falla_errcode', 'SR001', true);
select is(pg_temp.pedir(pg_temp.k(80), 'falla@test.com', jsonb_build_array(pg_temp.it(2, 1)), 7500.50, '198.51.100.50') ->> 'error', 'falla_simulada',
  'falla de negocio a mitad de la transacción: rechazo');
select results_eq(
  $$ select pg_temp.stock(2), (select count(*) from public.orders) $$,
  $$ select 2, current_setting('test.orders_antes')::bigint $$,
  'el stock y los pedidos quedaron como antes'
);
select set_config('test.falla_errcode', '22012', true);
select is(pg_temp.pedir(pg_temp.k(81), 'falla@test.com', jsonb_build_array(pg_temp.it(2, 1)), 7500.50, '198.51.100.50'),
  '{"status": "rejected", "error": "internal_error", "detail": {"sqlstate": "22012"}}'::jsonb,
  'falla inesperada a mitad de la transacción: rechazo genérico, sin el mensaje interno');
select is((select count(*) from public.checkout_attempts where ip_hash = private.hash_ip('198.51.100.50') and error_code = 'internal_error'), 1::bigint,
  'la falla inesperada quedó registrada como intento');
select results_eq(
  $$ select pg_temp.stock(2), (select count(*) from public.orders), (select count(*) from public.order_items where product_id = '20000000-0000-0000-0000-000000000002') $$,
  $$ select 2, current_setting('test.orders_antes')::bigint, 3::bigint $$,
  'sin stock descontado, sin pedido y sin artículos sueltos'
);
drop trigger tmp_falla on public.order_items;
drop function public.tmp_falla_inyectada();

-- ---------------------------------------------------------------------------
-- Consulta privada por token
-- ---------------------------------------------------------------------------

select is((public.consultar_pedido(pg_temp.r('b') ->> 'code', pg_temp.r('b') ->> 'token')) ->> 'total_ars', '14501.50', 'consulta con código y token correctos');
select ok(
  not (public.consultar_pedido(pg_temp.r('b') ->> 'code', pg_temp.r('b') ->> 'token') ?| array['buyer_name', 'buyer_email', 'buyer_phone', 'buyer_document', 'ship_street', 'admin_notes'])
  and (public.consultar_pedido(pg_temp.r('b') ->> 'code', pg_temp.r('b') ->> 'token'))::text !~ '(ana@test\.com|Pérez|Corrientes|5555|30123456)',
  'la consulta no expone datos personales'
);
select is(public.consultar_pedido(pg_temp.r('b') ->> 'code', pg_temp.r('gratis') ->> 'token'), null, 'token de otro pedido: sin resultado');
select is(public.consultar_pedido(pg_temp.r('b') ->> 'code', 'x'), null, 'token mal formado: sin resultado');

-- ---------------------------------------------------------------------------
-- Visitante
-- ---------------------------------------------------------------------------

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select throws_ok($$ select * from public.orders $$, '42501', null, 'anon no lista pedidos');
select throws_ok($$ select * from public.order_items $$, '42501', null, 'anon no lee artículos de pedidos');
select throws_ok($$ select * from public.order_events $$, '42501', null, 'anon no lee eventos');
select throws_ok($$ select * from public.store_settings $$, '42501', null, 'anon no lee la configuración interna');
select throws_ok(format('update public.orders set payment_status = %L', 'approved'), '42501', null, 'anon no cambia estados');
select throws_ok(format('update public.products set stock = 999 where id = %L', '20000000-0000-0000-0000-000000000001'), '42501', null, 'anon no modifica stock');
select throws_ok($$ select pg_temp.pedir(pg_temp.k(90), 'anon@test.com', jsonb_build_array(pg_temp.it(1, 1)), 6000) $$, '42501', null,
  'anon no puede llamar a crear_pedido directamente');
select throws_ok($$ select public.liberar_reservas_vencidas() $$, '42501', null, 'anon no puede ejecutar la liberación');
select throws_ok(format('select public.admin_cancelar_pedido(%L)', pg_temp.r('monto') ->> 'order_id'), '42501', null, 'anon no puede cancelar pedidos');
select throws_ok(format('select public.consultar_pedido(%L, %L)', pg_temp.r('gratis') ->> 'code', pg_temp.r('gratis') ->> 'token'), '42501', null,
  'anon no consulta pedidos por la API, ni siquiera con el token correcto');
select results_eq($$ select checkout_enabled, max_units_per_product from public.configuracion_checkout() $$, $$ values (true, 5) $$,
  'anon lee la configuración pública del checkout');
reset role;

-- ---------------------------------------------------------------------------
-- Usuario autenticado sin rol administrativo
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
select is((select count(*) from public.orders), 0::bigint, 'no admin: no ve pedidos (RLS)');
select is((select count(*) from public.order_events), 0::bigint, 'no admin: no ve eventos');
select is((select count(*) from public.store_settings), 0::bigint, 'no admin: no ve la configuración');
select throws_ok(format('update public.orders set payment_status = %L', 'approved'), '42501', null, 'no admin: no cambia estados');
select throws_ok(format('select public.admin_cancelar_pedido(%L)', pg_temp.r('monto') ->> 'order_id'), '42501', null, 'no admin: no cancela pedidos');
select throws_ok(format('select public.admin_actualizar_preparacion(%L, %L)', pg_temp.r('tarde') ->> 'order_id', 'preparing'), '42501', null, 'no admin: no prepara pedidos');
select throws_ok($$ select public.admin_actualizar_limites(30, 5, 20, 2, 5, 30) $$, '42501', null, 'no admin: no edita límites');
reset role;

-- ---------------------------------------------------------------------------
-- Administrador: lee, pero no escribe directo ni marca pagos
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select ok((select count(*) from public.orders) > 0, 'admin lista pedidos');
select throws_ok($$ select access_token_hash from public.orders $$, '42501', null, 'admin no lee el hash del token');
select throws_ok(format('update public.orders set payment_status = %L, stock_state = %L, paid_at = now() where id = %L', 'approved', 'consumed', pg_temp.r('monto') ->> 'order_id'),
  '42501', null, 'admin no puede marcar un pedido como pagado');
select throws_ok(format('update public.orders set total_ars = 1 where id = %L', pg_temp.r('monto') ->> 'order_id'), '42501', null, 'admin no edita importes');
select throws_ok($$ insert into public.order_events (order_id, event_type, actor) select id, 'payment_approved', 'payment' from public.orders limit 1 $$,
  '42501', null, 'admin no inserta eventos de pago');
reset role;

-- ---------------------------------------------------------------------------
-- service_role: solo crea pedidos con la función; no lee ni escribe las tablas
-- ---------------------------------------------------------------------------

set local role service_role;
select throws_ok($$ select * from public.orders $$, '42501', null, 'service_role no lee pedidos directamente');
select throws_ok(format('update public.orders set payment_status = %L', 'approved'), '42501', null, 'service_role no cambia estados');
reset role;

select ok(
  not exists (select 1 from public.order_events where data::text ~* '(@|pérez|comprador|siempre viva|5555)'),
  'los eventos no guardan datos personales'
);
select is(public.purgar_intentos_checkout(7), 0, 'purga: no borra intentos recientes');

-- ===========================================================================
-- Revisión 4B.3
-- ===========================================================================

insert into public.products (id, sku, name, slug, category_id, price_ars, stock) values
  ('20000000-0000-0000-0000-000000000007', 'P-7', 'Producto 7', 'p7', '10000000-0000-0000-0000-000000000001', 100, 20),
  ('20000000-0000-0000-0000-000000000008', 'P-8', 'Producto 8', 'p8', '10000000-0000-0000-0000-000000000001', 100, 1),
  ('20000000-0000-0000-0000-000000000009', 'P-9', 'Producto 9', 'p9', '10000000-0000-0000-0000-000000000001', 100, 1),
  ('20000000-0000-0000-0000-000000000010', 'P-10', 'Producto 10', 'p10', '10000000-0000-0000-0000-000000000001', 100, 1000);
create function pg_temp.admin() returns void language sql as $$
  select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true) $$;
create function pg_temp.version(n integer) returns bigint language sql as $$
  select stock_version from public.products where id = ('20000000-0000-0000-0000-00000000000' || n)::uuid $$;

-- ---------------------------------------------------------------------------
-- 1. Concurrencia entre el administrador y las reservas (control optimista)
-- ---------------------------------------------------------------------------

select is(pg_temp.version(7), 0::bigint, 'un producto nuevo empieza en la versión 0');
set local role authenticated;
select pg_temp.admin();
select results_eq($$ select stock, stock_version from public.admin_product_stock(array['20000000-0000-0000-0000-000000000007'::uuid]) $$,
  $$ values (20, 0::bigint) $$, '1. el admin abre el producto: stock 20, versión 0');
reset role;
select is(pg_temp.pedir(pg_temp.k(100), 'v7@test.com', jsonb_build_array(pg_temp.it(7, 3)), 5300, '198.51.100.70') ->> 'status', 'created',
  '2. un comprador reserva 3 unidades');
select is(pg_temp.stock(7), 17, 'stock disponible 17');
select is(pg_temp.version(7), 1::bigint, 'la reserva incrementó la versión');
set local role authenticated;
select pg_temp.admin();
select throws_ok(format('update public.products set stock = 20, stock_version = 1 where id = %L', '20000000-0000-0000-0000-000000000007'),
  'SR003', 'stock_conflict', '3-4. edición rápida con el stock leído antes de la reserva: conflicto detectado');
select throws_ok(format('update public.products set name = %L, price_ars = 150, is_featured = true, stock = 20, stock_version = 1 where id = %L',
                        'Producto 7 editado', '20000000-0000-0000-0000-000000000007'),
  'SR003', 'stock_conflict', 'formulario completo con el stock desactualizado: conflicto detectado');
select throws_ok(format('update public.products set stock = 20 where id = %L', '20000000-0000-0000-0000-000000000007'),
  'SR003', 'stock_conflict', 'cambiar el stock sin indicar la versión: rechazado (ninguna vía lo saltea)');
select throws_ok(format('update public.products set stock = stock + 5 where id = %L', '20000000-0000-0000-0000-000000000007'),
  '42501', null, 'un incremento relativo ni siquiera se puede escribir (el admin no lee stock por SELECT)');
select lives_ok(format('update public.products set stock_version = 999 where id = %L', '20000000-0000-0000-0000-000000000007'),
  'adelantar la versión sin cambiar el stock no falla…');
reset role;
select results_eq(
  $$ select stock, stock_version, name, price_ars, is_featured from public.products where id = '20000000-0000-0000-0000-000000000007' $$,
  $$ values (17, 1::bigint, 'Producto 7'::text, 100.00::numeric(12,2), false) $$,
  '5. …pero no hace nada: el stock sigue en 17 y el resto del formulario rechazado tampoco se guardó'
);
set local role authenticated;
select pg_temp.admin();
select lives_ok(format('update public.products set stock = 25, stock_version = 2 where id = %L', '20000000-0000-0000-0000-000000000007'),
  'tras recargar (versión 1), el admin guarda con versión 2');
select lives_ok(format('update public.products set stock = 25, stock_version = 2 where id = %L', '20000000-0000-0000-0000-000000000007'),
  'reenviar el mismo valor (doble envío) no es un cambio de stock: no pisa nada');
select throws_ok(format('update public.products set stock = 30, stock_version = 2 where id = %L', '20000000-0000-0000-0000-000000000007'),
  'SR003', 'stock_conflict', 'otra pestaña con la versión ya usada y otro valor: conflicto');
select lives_ok(format('update public.products set name = %L where id = %L', 'Producto 7', '20000000-0000-0000-0000-000000000007'),
  'editar otros campos sin tocar el stock no requiere versión');
reset role;
select results_eq($$ select pg_temp.stock(7), pg_temp.version(7) $$, $$ values (25, 2::bigint) $$, 'stock 25, versión 2');
set local role service_role;
select throws_ok(format('update public.products set stock = 1 where id = %L', '20000000-0000-0000-0000-000000000007'),
  'SR003', 'stock_conflict', 'service_role tampoco cambia el stock sin la versión');
reset role;
select lives_ok(format('update public.products set stock = 25 where id = %L', '20000000-0000-0000-0000-000000000007'),
  'postgres (SQL Editor) puede corregirlo a mano…');
select is(pg_temp.version(7), 2::bigint, '…sin cambio real de valor la versión no avanza');
select lives_ok(format('update public.products set stock = 24 where id = %L', '20000000-0000-0000-0000-000000000007'),
  'una corrección manual real…');
select is(pg_temp.version(7), 3::bigint, '…avanza la versión, así un panel abierto detecta el cambio');
select throws_ok($$ update public.products set stock = -1 where id = '20000000-0000-0000-0000-000000000007' $$, '23514', null,
  'la regla stock >= 0 se mantiene');

-- ---------------------------------------------------------------------------
-- 3. Intentos: los errores también cuentan (no se puede eludir el límite provocando fallas)
-- ---------------------------------------------------------------------------

update public.store_settings set max_attempts_per_ip_hour = 5, max_orders_per_ip_hour = 5;
select is(
  (select count(*) from generate_series(1, 3) n
    where pg_temp.pedir('mala-' || n, 'x@test.com', jsonb_build_array(pg_temp.it(1, 1)), 6000, '198.51.100.80') ->> 'error' = 'invalid_input'),
  3::bigint, 'tres claves mal formadas: rechazadas');
select is(pg_temp.pedir(pg_temp.k(111), 'x@test.com', '"no es un arreglo"', 6000, '198.51.100.80') ->> 'error', 'invalid_input', 'artículos con otro tipo: rechazado');
select is(pg_temp.pedir(pg_temp.k(112), 'x@test.com', jsonb_build_array(pg_temp.it(1, 1)), 99999999999, '198.51.100.80') ->> 'error', 'invalid_input',
  'total fuera de rango: rechazado');
select set_config('test.p1_antes', pg_temp.stock(1)::text, true);
select is(pg_temp.pedir(pg_temp.k(113), 'ok113@test.com', jsonb_build_array(pg_temp.it(1, 1)), 6000, '198.51.100.80') ->> 'error',
  'too_many_attempts', 'sexto intento con datos válidos: rechazado por los 5 intentos fallidos previos');
select results_eq(
  $$ select count(*), count(*) filter (where error_code = 'too_many_attempts') from public.checkout_attempts where ip_hash = private.hash_ip('198.51.100.80') $$,
  $$ values (6::bigint, 1::bigint) $$, 'los seis intentos quedaron registrados');
select is(pg_temp.stock(1), current_setting('test.p1_antes')::integer, 'el intento bloqueado no tocó el stock');
update public.store_settings set max_attempts_per_ip_hour = 30, max_orders_per_ip_hour = 5;

-- ---------------------------------------------------------------------------
-- 2. Vencimientos sin pg_cron: liberación oportunista, fallas y acumulación
-- ---------------------------------------------------------------------------

select pg_temp.guardar('op', pg_temp.pedir(pg_temp.k(120), 'op1@test.com', jsonb_build_array(pg_temp.it(8, 1)), 5100, '198.51.100.81'));
select is(pg_temp.stock(8), 0, 'la última unidad de P8 quedó reservada');
select pg_temp.vencer(pg_temp.r('op') ->> 'code');
-- sin ejecutar liberar_reservas_vencidas (pg_cron detenido)
select is(pg_temp.pedir(pg_temp.k(121), 'op2@test.com', jsonb_build_array(pg_temp.it(8, 1)), 5100, '198.51.100.82') ->> 'status', 'created',
  'liberación oportunista: otro comprador obtiene la unidad de una reserva vencida aunque pg_cron no corrió');
select results_eq(
  $$ select payment_status, stock_state, pg_temp.stock(8) from pg_temp.pedido(pg_temp.r('op') ->> 'code') $$,
  $$ values ('expired'::text, 'released'::text, 0) $$, 'la reserva vencida se liberó una vez y la unidad pasó al pedido nuevo');
select is((select data ->> 'via' from public.order_events where order_id = (pg_temp.r('op') ->> 'order_id')::uuid and event_type = 'reservation_expired'),
  'checkout', 'el evento indica que la liberó una compra');

-- falla al liberar un pedido en medio de la tarea
select pg_temp.guardar('f1', pg_temp.pedir(pg_temp.k(130), 'f1@test.com', jsonb_build_array(pg_temp.it(1, 1)), 6000, '198.51.100.83'));
select pg_temp.guardar('f2', pg_temp.pedir(pg_temp.k(131), 'f2@test.com', jsonb_build_array(pg_temp.it(1, 1)), 6000, '198.51.100.84'));
select pg_temp.guardar('f3', pg_temp.pedir(pg_temp.k(132), 'f3@test.com', jsonb_build_array(pg_temp.it(1, 1)), 6000, '198.51.100.85'));
select pg_temp.vencer(pg_temp.r('f' || n) ->> 'code') from generate_series(1, 3) n;
select set_config('test.p1_antes', pg_temp.stock(1)::text, true);
create function public.tmp_falla_liberacion() returns trigger language plpgsql as $$
begin
  if new.event_type = 'reservation_expired' and new.order_id = (current_setting('test.f2')::jsonb ->> 'order_id')::uuid then
    raise exception 'falla simulada al liberar';
  end if;
  return new;
end $$;
create trigger tmp_falla_liberacion before insert on public.order_events for each row execute function public.tmp_falla_liberacion();
select is(public.liberar_reservas_vencidas(), 2, 'un pedido falla a mitad de la tarea: los otros dos se liberan igual');
select results_eq(
  $$ select (pg_temp.pedido(pg_temp.r('f' || n) ->> 'code')).stock_state from generate_series(1, 3) n $$,
  $$ values ('released'::text), ('reserved'::text), ('released'::text) $$,
  'el pedido que falló queda reservado y vencido, sin cambios parciales');
select is(pg_temp.stock(1), current_setting('test.p1_antes')::integer + 2, 'solo volvieron las unidades de los dos liberados');
drop trigger tmp_falla_liberacion on public.order_events;
drop function public.tmp_falla_liberacion();
select is(public.liberar_reservas_vencidas(), 1, 'la ejecución siguiente libera el pedido que había fallado');
select is(pg_temp.stock(1), current_setting('test.p1_antes')::integer + 3, 'y su stock vuelve una sola vez');

-- reservas acumuladas (pg_cron detenido varias horas)
select is(
  (select count(*) from generate_series(1, 250) n
    where public.crear_pedido('acumulada-' || lpad(n::text, 4, '0') || '-' || repeat('b', 20),
            jsonb_build_object('name', 'Acumulado', 'email', 'acum' || n || '@test.com', 'phone', '1155550000'),
            '{"street":"Calle","number":"1","city":"Ciudad","postal_code":"1000","province_code":"AR-C"}',
            '[{"product_id":"20000000-0000-0000-0000-000000000010","quantity":2}]', 5200,
            ('10.1.' || (n / 200) || '.' || (n % 200))::inet) ->> 'status' = 'created'),
  250::bigint, '250 pedidos reservados');
select is((select stock from public.products where sku = 'P-10'), 500, 'P-10: 500 unidades reservadas');
alter table public.orders disable trigger orders_validar_cambios;
update public.orders set reservation_expires_at = now() - interval '3 hours' where buyer_email like 'acum%';
alter table public.orders enable trigger orders_validar_cambios;
select results_eq(
  $$ select public.liberar_reservas_vencidas(100) from generate_series(1, 4) $$,
  $$ values (100), (100), (50), (0) $$,
  'acumuladas: cada ejecución avanza por lotes hasta vaciar la cola');
select is((select stock from public.products where sku = 'P-10'), 1000, 'todas las unidades volvieron, una sola vez');
select is((select count(*) from public.order_events e join public.orders o on o.id = e.order_id
            where o.buyer_email like 'acum%' and e.event_type = 'reservation_expired'), 250::bigint, 'un evento de vencimiento por pedido');

-- ---------------------------------------------------------------------------
-- 5. Pago recibido sobre un pedido cancelado
-- ---------------------------------------------------------------------------

select pg_temp.guardar('cx', pg_temp.pedir(pg_temp.k(140), 'cx@test.com', jsonb_build_array(pg_temp.it(1, 1)), 6000, '198.51.100.86'));
select pg_temp.guardar('cy', pg_temp.pedir(pg_temp.k(141), 'cy@test.com', jsonb_build_array(pg_temp.it(9, 1)), 5100, '198.51.100.87'));
set local role authenticated;
select pg_temp.admin();
select lives_ok(format('select public.admin_cancelar_pedido(%L)', pg_temp.r('cx') ->> 'order_id'), 'el admin cancela un pedido sin pagar');
select lives_ok(format('select public.admin_cancelar_pedido(%L)', pg_temp.r('cy') ->> 'order_id'), 'el admin cancela otro (última unidad de P9)');
reset role;
select is(private.aplicar_pago((pg_temp.r('cx') ->> 'order_id')::uuid, 'mp-cx', 'approved', 6000), 'approved_late',
  'pago sobre un pedido cancelado, con stock: se vuelve a reservar y consumir');
select results_eq(
  $$ select payment_status, stock_state, cancelled_at is not null, resolution_status from pg_temp.pedido(pg_temp.r('cx') ->> 'code') $$,
  $$ values ('approved'::text, 'consumed'::text, true, 'none'::text) $$,
  'aprobado y consumido (queda registrado que había sido cancelado)');
select is(pg_temp.pedir(pg_temp.k(142), 'cz@test.com', jsonb_build_array(pg_temp.it(9, 1)), 5100, '198.51.100.88') ->> 'status', 'created',
  'otro comprador se lleva la unidad liberada por la cancelación');
select is(private.aplicar_pago((pg_temp.r('cy') ->> 'order_id')::uuid, 'mp-cy', 'approved', 5100), 'approved_shortage',
  'pago sobre un pedido cancelado, sin stock: faltante');
select results_eq(
  $$ select payment_status, stock_state, resolution_reason, pg_temp.stock(9) from pg_temp.pedido(pg_temp.r('cy') ->> 'code') $$,
  $$ values ('approved'::text, 'shortage'::text, 'stock_shortage'::text, 0) $$,
  'pagado sin stock, pendiente de resolución, stock en 0');
set local role authenticated;
select pg_temp.admin();
select throws_ok(format('select public.admin_actualizar_preparacion(%L, %L, %L)', pg_temp.r('cy') ->> 'order_id', 'shipped', 'Correo'), '55000', null,
  'un pedido pagado sin stock no se despacha');
reset role;
select throws_ok(format('update public.orders set fulfillment_status = %L, dispatched_at = now() where id = %L', 'shipped', pg_temp.r('cy') ->> 'order_id'),
  'SR002', null, 'ni por SQL directo');

-- ---------------------------------------------------------------------------
-- 4. Tokens, claves e idempotencia
-- ---------------------------------------------------------------------------

select ok(
  (select count(distinct value) from private.app_secrets) = (select count(*) from private.app_secrets)
  and (select count(*) from private.app_secrets where active) = 2,
  'una clave distinta por finalidad (ip_hash, order_token), una activa por finalidad');
select ok((select bool_and(octet_length(value) = 32) from private.app_secrets), 'claves de 256 bits generadas por la base');
select is(
  (select count(*) from public.orders o, lateral (select to_jsonb(o)::text j) x where x.j like '%' || pg_temp.k(2) || '%'), 0::bigint,
  'la clave de idempotencia no se guarda en claro');
select ok(
  not (pg_temp.pedir(pg_temp.k(2), 'otro@test.com', jsonb_build_array(pg_temp.it(1, 1)), 6000, '198.51.100.10') ?| array['code', 'token', 'order_id', 'total_ars']),
  'misma clave con otro contenido: el rechazo no revela código, token ni datos del pedido existente');
-- rotación de la clave del token
update private.app_secrets set active = false where name = 'order_token';
insert into private.app_secrets (name, version, value) values ('order_token', 2, extensions.gen_random_bytes(32));
select is(
  public.crear_pedido(pg_temp.k(2),
    '{"name":"Ana Pérez","email":"ana@test.com","phone":"+54 11 5555-0000","document":"30123456"}',
    '{"street":"Av. Corrientes","number":"1234","unit":"3 B","city":"CABA","postal_code":"C1043AAA","province_code":"AR-C"}',
    jsonb_build_array(pg_temp.it(1, 2), pg_temp.it(2, 3)), 14501.50, '198.51.100.10') ->> 'token',
  pg_temp.r('b') ->> 'token',
  'tras rotar la clave, un reintento de un pedido anterior devuelve el mismo token (usa la versión con que se emitió)');
select pg_temp.guardar('rot', pg_temp.pedir(pg_temp.k(150), 'rot@test.com', jsonb_build_array(pg_temp.it(1, 1)), 6000, '198.51.100.89'));
select is((pg_temp.pedido(pg_temp.r('rot') ->> 'code')).token_key_version, 2::smallint, 'los pedidos nuevos usan la clave nueva');
select is(public.consultar_pedido(pg_temp.r('rot') ->> 'code', pg_temp.r('rot') ->> 'token') ->> 'code', pg_temp.r('rot') ->> 'code',
  'la consulta funciona con tokens de la clave nueva…');
select is(public.consultar_pedido(pg_temp.r('b') ->> 'code', pg_temp.r('b') ->> 'token') ->> 'code', pg_temp.r('b') ->> 'code',
  '…y con los de la anterior (se verifica contra el hash guardado)');
select is(public.consultar_pedido(pg_temp.r('rot') ->> 'code', pg_temp.r('b') ->> 'token'), null, 'un token válido no abre otro pedido');

-- ---------------------------------------------------------------------------
-- Cierre 4B.3: secretos faltantes y versión de stock en todas las operaciones
-- ---------------------------------------------------------------------------

select set_config('test.p1_c', pg_temp.stock(1)::text, true);
update private.app_secrets set active = false where name = 'order_token';
select is(pg_temp.pedir(pg_temp.k(160), 'sinclave@test.com', jsonb_build_array(pg_temp.it(1, 1)), 6000, '198.51.100.90'),
  '{"status": "rejected", "error": "internal_error", "detail": {"sqlstate": "55000"}}'::jsonb,
  'sin clave de token activa: rechazo controlado, sin pedido');
select is(pg_temp.stock(1), current_setting('test.p1_c')::integer, 'sin clave de token: el stock no cambió');
update private.app_secrets set active = true where name = 'order_token' and version = 2;
update private.app_secrets set active = false where name = 'ip_hash';
select throws_ok($$ select pg_temp.pedir(pg_temp.k(161), 'sinip@test.com', jsonb_build_array(pg_temp.it(1, 1)), 6000, '198.51.100.91') $$,
  '55000', 'Falta la clave activa ip_hash', 'sin clave de IP: error controlado antes de cualquier trabajo');
update private.app_secrets set active = true where name = 'ip_hash';
select is(pg_temp.stock(1), current_setting('test.p1_c')::integer, 'sin clave de IP: el stock no cambió');

select set_config('test.v1', pg_temp.version(1)::text, true);
select pg_temp.guardar('sv', pg_temp.pedir(pg_temp.k(170), 'sv@test.com', jsonb_build_array(pg_temp.it(1, 1)), 6000, '198.51.100.92'));
select is(pg_temp.version(1), current_setting('test.v1')::bigint + 1, 'versión de stock: +1 con la reserva');
select pg_temp.vencer(pg_temp.r('sv') ->> 'code');
select is(public.liberar_reservas_vencidas(), 1, 'reserva vencida liberada');
select is(pg_temp.version(1), current_setting('test.v1')::bigint + 2, 'versión de stock: +1 con el vencimiento');
select is(private.aplicar_pago((pg_temp.r('sv') ->> 'order_id')::uuid, 'mp-sv', 'approved', 6000), 'approved_late', 'pago tardío');
select is(pg_temp.version(1), current_setting('test.v1')::bigint + 3, 'versión de stock: +1 con la nueva reserva del pago tardío');
select pg_temp.guardar('sw', pg_temp.pedir(pg_temp.k(171), 'sw@test.com', jsonb_build_array(pg_temp.it(1, 1)), 6000, '198.51.100.93'));
set local role authenticated;
select pg_temp.admin();
select lives_ok(format('select public.admin_cancelar_pedido(%L)', pg_temp.r('sw') ->> 'order_id'), 'el admin cancela');
reset role;
select is(pg_temp.version(1), current_setting('test.v1')::bigint + 5, 'versión de stock: +1 con la reserva y +1 con la cancelación del panel');

select * from finish();
rollback;
