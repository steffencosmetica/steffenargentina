-- Zonas y tarifas de envío: estructura, reglas, RLS, asignación de provincias y cotización.
-- Se ejecuta con `npm run db:test`; todo corre en una transacción que se descarta al final.

begin;
create extension if not exists pgtap with schema extensions;

select plan(56);

-- ---------------------------------------------------------------------------
-- Provincias
-- ---------------------------------------------------------------------------

select is((select count(*) from public.provinces), 24::bigint, 'hay 24 jurisdicciones');
select is((select name from public.provinces where code = 'AR-C'), 'Ciudad Autónoma de Buenos Aires', 'AR-C es CABA');
select is((select name from public.provinces where code = 'AR-B'), 'Buenos Aires', 'AR-B es Buenos Aires');
select ok((select bool_and(code ~ '^AR-[A-Z]$') from public.provinces), 'todos los códigos son ISO 3166-2:AR');

-- ---------------------------------------------------------------------------
-- Datos de prueba (como postgres)
-- ---------------------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local');
insert into public.admin_users (user_id) values ('00000000-0000-0000-0000-0000000000a1');

insert into public.shipping_zones (id, name, price_ars, free_from_ars, sort_order) values
  ('50000000-0000-0000-0000-000000000001', 'AMBA', 5000, 60000, 10),
  ('50000000-0000-0000-0000-000000000002', 'Interior', 9000.50, null, 20);
insert into public.shipping_zone_provinces (province_code, zone_id) values
  ('AR-C', '50000000-0000-0000-0000-000000000001'),
  ('AR-B', '50000000-0000-0000-0000-000000000001'),
  ('AR-X', '50000000-0000-0000-0000-000000000002');

-- ---------------------------------------------------------------------------
-- Reglas
-- ---------------------------------------------------------------------------

select throws_ok($$ insert into public.shipping_zones (name, price_ars) values ('Negativa', -1) $$, '23514', null, 'tarifa negativa rechazada');
select throws_ok($$ insert into public.shipping_zones (name, price_ars, free_from_ars) values ('Gratis cero', 100, 0) $$, '23514', null, 'envío gratis desde 0 rechazado');
select throws_ok($$ insert into public.shipping_zones (name, price_ars, free_from_ars) values ('Gratis neg', 100, -5) $$, '23514', null, 'envío gratis negativo rechazado');
select throws_ok($$ insert into public.shipping_zones (name, price_ars) values ('   ', 100) $$, '23514', null, 'nombre vacío rechazado');
select throws_ok($$ insert into public.shipping_zones (name, price_ars) values ('AMBA', 100) $$, '23505', null, 'nombre de zona duplicado rechazado');
select lives_ok($$ insert into public.shipping_zones (name, price_ars) values ('Sin costo', 0) $$, 'tarifa 0 permitida');
select is((select price_ars from public.shipping_zones where name = 'Interior'), 9000.50::numeric(12, 2), 'el importe conserva los centavos');
select throws_ok($$ insert into public.shipping_zone_provinces values ('AR-C', '50000000-0000-0000-0000-000000000002') $$, '23505', null,
  'una provincia no puede estar en dos zonas');
select throws_ok($$ insert into public.shipping_zone_provinces values ('AR-ZZ', '50000000-0000-0000-0000-000000000002') $$, '23503', null,
  'provincia inexistente rechazada');
select throws_ok($$ delete from public.shipping_zones where id = '50000000-0000-0000-0000-000000000002' $$, '23503', null,
  'no se puede borrar una zona con provincias');

-- ---------------------------------------------------------------------------
-- Cotización
-- ---------------------------------------------------------------------------

select results_eq(
  $$ select has_coverage, zone_name, rate_ars, free_from_ars, is_free, cost_ars from public.cotizar_envio('AR-B', 10000) $$,
  $$ values (true, 'AMBA'::text, 5000.00::numeric(12,2), 60000.00::numeric(12,2), false, 5000.00::numeric(12,2)) $$,
  'tarifa normal debajo del umbral'
);
select is((select cost_ars from public.cotizar_envio('AR-B', 59999.99)), 5000.00::numeric(12, 2), 'un centavo debajo del umbral se cobra');
select results_eq(
  $$ select is_free, cost_ars from public.cotizar_envio('AR-B', 60000) $$,
  $$ values (true, 0.00::numeric(12,2)) $$,
  'subtotal exactamente igual al umbral: envío gratis'
);
select is((select cost_ars from public.cotizar_envio('AR-C', 150000)), 0.00::numeric(12, 2), 'subtotal mayor al umbral: envío gratis');
select results_eq(
  $$ select is_free, cost_ars from public.cotizar_envio('AR-X', 999999) $$,
  $$ values (false, 9000.50::numeric(12,2)) $$,
  'zona sin envío gratis cobra siempre la tarifa, con centavos'
);
select results_eq(
  $$ select has_coverage, zone_id, cost_ars from public.cotizar_envio('AR-V', 1000) $$,
  $$ values (false, null::uuid, null::numeric(12,2)) $$,
  'provincia sin zona: sin cobertura'
);
update public.shipping_zones set is_active = false where id = '50000000-0000-0000-0000-000000000002';
select is((select has_coverage from public.cotizar_envio('AR-X', 1000)), false, 'zona inactiva: sin cobertura');
update public.shipping_zones set is_active = true where id = '50000000-0000-0000-0000-000000000002';
select is((select has_coverage from public.cotizar_envio('AR-X', 1000)), true, 'al reactivar la zona vuelve la cobertura');
select throws_ok($$ select * from public.cotizar_envio('XX', 1000) $$, '22023', null, 'provincia inválida rechazada');
select throws_ok($$ select * from public.cotizar_envio(null, 1000) $$, '22023', null, 'provincia nula rechazada');
select throws_ok($$ select * from public.cotizar_envio('AR-B', -1) $$, '22023', null, 'subtotal negativo rechazado');
select throws_ok($$ select * from public.cotizar_envio('AR-B', 10.005) $$, '22023', null, 'subtotal con más de 2 decimales rechazado');
select throws_ok($$ select * from public.cotizar_envio('AR-B', null) $$, '22023', null, 'subtotal nulo rechazado');
select is(
  (select count(*) from public.provincias_cobertura() where has_coverage),
  3::bigint,
  'provincias_cobertura: 3 con cobertura (CABA, Buenos Aires, Córdoba)'
);

-- ---------------------------------------------------------------------------
-- Permisos de funciones
-- ---------------------------------------------------------------------------

select ok(has_function_privilege('anon', 'public.cotizar_envio(text, numeric)', 'execute'), 'anon puede cotizar');
select ok(has_function_privilege('anon', 'public.provincias_cobertura()', 'execute'), 'anon puede ver la cobertura');
select ok(not has_function_privilege('anon', 'public.admin_set_zone_provinces(uuid, text[], boolean)', 'execute'), 'anon no puede asignar provincias');
select ok(not has_function_privilege('anon', 'public.admin_save_zone(uuid, text, numeric, numeric, boolean, text[], boolean)', 'execute'), 'anon no puede guardar zonas');
select ok(
  (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.cotizar_envio(text, numeric)'::regprocedure),
  'cotizar_envio: security definer con search_path vacío'
);
select ok(
  (select not prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.admin_set_zone_provinces(uuid, text[], boolean)'::regprocedure),
  'admin_set_zone_provinces: security invoker (RLS aplica) con search_path vacío'
);

-- ---------------------------------------------------------------------------
-- Visitante
-- ---------------------------------------------------------------------------

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select count(*) from public.provinces), 24::bigint, 'anon lee las provincias');
select throws_ok($$ select * from public.shipping_zones $$, '42501', null, 'anon no lee zonas');
select throws_ok($$ select * from public.shipping_zone_provinces $$, '42501', null, 'anon no lee la asignación de provincias');
select throws_ok($$ insert into public.shipping_zones (name, price_ars) values ('x', 1) $$, '42501', null, 'anon no crea zonas');
select is((select cost_ars from public.cotizar_envio('AR-B', 10000)), 5000.00::numeric(12, 2), 'anon cotiza');

-- ---------------------------------------------------------------------------
-- Usuario logueado que no es administrador
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
select is((select count(*) from public.shipping_zones), 0::bigint, 'no admin: no ve zonas (RLS)');
select throws_ok($$ insert into public.shipping_zones (name, price_ars) values ('x', 1) $$, '42501', null, 'no admin: no crea zonas');
update public.shipping_zones set price_ars = 1;
select throws_ok($$ select * from public.admin_set_zone_provinces('50000000-0000-0000-0000-000000000001', array['AR-C']) $$,
  '42501', null, 'no admin: no asigna provincias');

-- ---------------------------------------------------------------------------
-- Administrador
-- ---------------------------------------------------------------------------

select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select is((select price_ars from public.shipping_zones where name = 'AMBA'), 5000.00::numeric(12, 2), 'el update de un no admin no cambió nada');
select results_eq(
  $$ select added, removed, moved from public.admin_set_zone_provinces('50000000-0000-0000-0000-000000000001', array['AR-C', 'AR-S', 'AR-S']) $$,
  $$ values (array['AR-S'], array['AR-B'], array[]::text[]) $$,
  'admin reemplaza las provincias de la zona (agrega, quita, sin duplicados)'
);
-- conservación frente a errores: mover sin confirmar falla y no cambia nada
select throws_ok($$ select * from public.admin_set_zone_provinces('50000000-0000-0000-0000-000000000002', array['AR-X', 'AR-C']) $$,
  '23505', null, 'mover una provincia de otra zona sin confirmar falla');
select results_eq(
  $$ select province_code, zone_id from public.shipping_zone_provinces order by province_code $$,
  $$ values ('AR-C', '50000000-0000-0000-0000-000000000001'::uuid), ('AR-S', '50000000-0000-0000-0000-000000000001'::uuid),
            ('AR-X', '50000000-0000-0000-0000-000000000002'::uuid) $$,
  'tras el error la asignación quedó intacta'
);
select throws_ok($$ select * from public.admin_set_zone_provinces('50000000-0000-0000-0000-000000000001', array['AR-C', 'AR-QQ']) $$,
  '22023', null, 'provincia inválida en la asignación rechazada');
select results_eq(
  $$ select moved from public.admin_set_zone_provinces('50000000-0000-0000-0000-000000000002', array['AR-X', 'AR-C'], true) $$,
  $$ values (array['AR-C']) $$,
  'con confirmación, la provincia se mueve de zona'
);
-- alta atómica: si la asignación falla, la zona tampoco se crea
select throws_ok($$ select * from public.admin_save_zone(null, 'Patagonia', 12000, null, true, array['AR-Q', 'AR-C']) $$,
  '23505', null, 'alta con una provincia de otra zona sin confirmar falla');
select is((select count(*) from public.shipping_zones where name = 'Patagonia'), 0::bigint, 'y la zona no quedó creada a medias');
select results_eq(
  $$ select added from public.admin_save_zone(null, 'Patagonia', 12000, 200000, true, array['AR-Q', 'AR-R']) $$,
  $$ values (array['AR-Q', 'AR-R']) $$,
  'alta de zona con provincias en una sola operación'
);
select is((select sort_order from public.shipping_zones where name = 'Patagonia'), 30, 'la zona nueva va al final del orden');
select throws_ok($$ select * from public.admin_save_zone((select id from public.shipping_zones where name = 'Patagonia'), 'Patagonia', -1, null, true, array['AR-Q']) $$,
  '23514', null, 'edición con tarifa negativa rechazada');
select is((select price_ars from public.shipping_zones where name = 'Patagonia'), 12000.00::numeric(12,2), 'y la zona conserva su tarifa');
select lives_ok($$ select * from public.admin_set_zone_provinces('50000000-0000-0000-0000-000000000002', array[]::text[]) $$,
  'admin quita todas las provincias de una zona');
select lives_ok($$ delete from public.shipping_zones where id = '50000000-0000-0000-0000-000000000002' $$,
  'una zona sin provincias se puede borrar');

reset role;
select * from finish();
rollback;
