begin;
create extension if not exists pgtap with schema extensions;
select plan(21);

insert into public.categories (id, name, slug) values ('ac000000-0000-4000-8000-000000000001', 'Pago test', 'pago-test');
insert into public.products (id, sku, name, slug, category_id, price_ars, stock) values
 ('ac000000-0000-4000-8000-000000000002', 'PAGO-TEST', 'Producto histórico', 'producto-pago-test',
  'ac000000-0000-4000-8000-000000000001', 2000.10, 20);
insert into public.shipping_zones (id, name, price_ars) values ('ac000000-0000-4000-8000-000000000003', 'Pago test', 1500.21);
insert into public.shipping_zone_provinces (zone_id, province_code) values ('ac000000-0000-4000-8000-000000000003', 'AR-C');
update public.store_settings set checkout_enabled = true;

create function pg_temp.crear(n integer) returns jsonb language sql as $$
  select public.crear_pedido('pago-test-' || n || repeat('a', 30),
    jsonb_build_object('name','Comprador Test','email','pago-' || n || '@test.local','phone','+54 11 5555-0000'),
    '{"street":"Av. Siempre Viva","number":"742","city":"Ciudad","postal_code":"C1000AAA","province_code":"AR-C"}',
    '[{"product_id":"ac000000-0000-4000-8000-000000000002","quantity":2}]', 5500.41, '198.51.100.22')
$$;
create temp table test_orders as select n, pg_temp.crear(n) as result from generate_series(1, 4) n;
create function pg_temp.iniciar(p_n integer) returns jsonb language sql as $$
  select public.iniciar_intento_pago(result->>'code', result->>'token', '198.51.100.23') from test_orders where n = p_n
$$;

select is((select count(*) from test_orders where result->>'status' = 'created'), 4::bigint, 'usa pedidos del checkout existente');
select is(public.iniciar_intento_pago((select result->>'code' from test_orders where n = 1), repeat('x',43), '198.51.100.23')->>'status', 'not_found', 'token incorrecto');
select is(public.iniciar_intento_pago('STF-0000-2345', repeat('x',43), '198.51.100.23')->>'status', 'not_found', 'código inexistente indistinguible');
select ok(not exists (select 1 from private.payment_attempts), 'ningún intento sin autorización');
create temp table test_claim as select pg_temp.iniciar(1) as result;
select is((select result->>'status' from test_claim), 'creating', 'intento persistido');
select is((select result->>'total' from test_claim), '5500.41', 'importe histórico exacto');
select is((select result#>>'{items,0,unitPrice}' from test_claim), '2000.10', 'precio histórico exacto');
select is(pg_temp.iniciar(1)->>'status', 'busy', 'concesión exclusiva');
select throws_ok($$ update private.payment_attempts set status = 'invalid' $$, '23514', null, 'estado inválido rechazado');
select throws_ok($$ insert into private.payment_attempts select gen_random_uuid(), order_id, gen_random_uuid(),
  environment, seller_reference, external_reference || 'X', total_ars, checkout_expires_at,
  expiration_seconds, status, null, lease, lease_until, null, created_at, updated_at from private.payment_attempts $$,
  '23505', null, 'un intento por pedido');
select is((select stock from public.products where sku = 'PAGO-TEST'), 12, 'el intento no vuelve a reservar');
select ok(not has_function_privilege('anon','public.iniciar_intento_pago(text,text,inet)','execute')
  and not has_function_privilege('authenticated','public.iniciar_intento_pago(text,text,inet)','execute')
  and has_function_privilege('service_role','public.iniciar_intento_pago(text,text,inet)','execute'), 'inicio solo servidor');
select ok(not has_function_privilege('authenticated','public.finalizar_intento_pago(uuid,uuid,text,text)','execute')
  and not has_table_privilege('service_role','private.payment_attempts','select'), 'sin acceso directo incluso con service_role');

create temp table test_remote as select public.simular_order_pago((result->>'key')::uuid, (result->>'lease')::uuid,
  result->>'reference', result->>'total') as id from test_claim;
select ok((select id is not null from test_remote), 'proveedor simulado crea order');
select ok(not public.finalizar_intento_pago((select (result->>'id')::uuid from test_claim), gen_random_uuid(),
  (select id from test_remote), null), 'una concesión incorrecta no guarda la order');
select ok(public.finalizar_intento_pago((result->>'id')::uuid, (result->>'lease')::uuid, (select id from test_remote), null),
  'registra vínculo') from test_claim;
select is(pg_temp.iniciar(1)->>'provider_order_id', (select id from test_remote), 'reutiliza la misma order');

select private.liberar_reserva((select (result->>'order_id')::uuid from test_orders where n = 2), 'cancelled', 'system', null);
select private.aplicar_pago((select (result->>'order_id')::uuid from test_orders where n = 3), 'fixture-5b', 'approved', 5500.41);
alter table public.orders disable trigger orders_validar_cambios;
update public.orders set reservation_expires_at = now() - interval '1 second'
  where id = (select (result->>'order_id')::uuid from test_orders where n = 4);
alter table public.orders enable trigger orders_validar_cambios;
select is(pg_temp.iniciar(2)->>'status', 'unavailable', 'cancelado');
select is(pg_temp.iniciar(3)->>'status', 'unavailable', 'ya pagado');
select is(pg_temp.iniciar(4)->>'status', 'unavailable', 'reserva vencida sin liberar todavía');
update public.store_settings set checkout_enabled = false;
select is(pg_temp.iniciar(1)->>'status', 'unavailable', 'apagado transaccional incluso con order abierta');
select * from finish();
rollback;
