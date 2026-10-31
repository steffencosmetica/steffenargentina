-- Campos benefits y presentation de products: compatibilidad, persistencia y permisos.
-- Se ejecuta con `npm run db:test`; todo corre en una transacción que se descarta al final.

begin;
create extension if not exists pgtap with schema extensions;

select plan(12);

select has_column('public', 'products', 'benefits', 'existe products.benefits');
select has_column('public', 'products', 'presentation', 'existe products.presentation');
select col_type_is('public', 'products', 'benefits', 'text', 'benefits es texto');
select col_is_null('public', 'products', 'presentation', 'presentation es opcional');

insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local');
insert into public.admin_users (user_id) values ('00000000-0000-0000-0000-0000000000a1');
insert into public.categories (id, name, slug) values ('10000000-0000-0000-0000-000000000001', 'Cat', 'cat');

-- un producto cargado como antes de la migración (sin los campos nuevos)
insert into public.products (id, sku, name, slug, category_id, price_ars) values
  ('20000000-0000-0000-0000-000000000001', 'P-1', 'P1', 'p1', '10000000-0000-0000-0000-000000000001', 100);
select is((select benefits from public.products where id = '20000000-0000-0000-0000-000000000001'), null,
  'los productos existentes quedan sin beneficios');

-- visitante: lee los campos nuevos de lo activo, pero no puede escribirlos
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select is((select count(*) from public.products where id = '20000000-0000-0000-0000-000000000001' and presentation is null), 1::bigint,
  'anon lee la presentación de un producto activo');
select throws_ok($$ update public.products set benefits = 'x' $$, '42501', null, 'anon no puede escribir benefits');

-- usuario logueado que no es administrador: RLS filtra la actualización
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
update public.products set presentation = 'hackeado' where id = '20000000-0000-0000-0000-000000000001';
select is((select presentation from public.products where id = '20000000-0000-0000-0000-000000000001'), null,
  'un usuario sin rol de administrador no modifica la presentación');

-- administrador
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select lives_ok($$ update public.products set benefits = 'Brillo y suavidad.', presentation = 'Botella de 1000 cc.'
                   where id = '20000000-0000-0000-0000-000000000001' $$,
  'el administrador guarda beneficios y presentación');
select is((select benefits from public.products where id = '20000000-0000-0000-0000-000000000001'), 'Brillo y suavidad.',
  'los beneficios persisten');
select is((select presentation from public.products where id = '20000000-0000-0000-0000-000000000001'), 'Botella de 1000 cc.',
  'la presentación persiste');

reset role;
select policies_are('public', 'products', array[
  'products: lectura pública de activos',
  'products: alta solo admin',
  'products: edición solo admin',
  'products: baja solo admin'
], 'las políticas de products no cambiaron');

select * from finish();
rollback;
