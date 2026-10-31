-- Permisos de ejecución de las funciones del catálogo (mínimo privilegio).
-- Se ejecuta con `npm run db:test`; todo corre en una transacción que se descarta al final.

begin;
create extension if not exists pgtap with schema extensions;

select plan(14);

-- ---------------------------------------------------------------------------
-- Permisos declarados
-- ---------------------------------------------------------------------------

select ok(has_function_privilege('anon', 'public.is_admin()', 'execute'),
  'anon puede ejecutar is_admin (la usan las políticas de lectura pública)');
select ok(has_function_privilege('authenticated', 'public.is_admin()', 'execute'),
  'authenticated puede ejecutar is_admin');
select ok(not has_function_privilege('anon', 'public.set_primary_product_image(uuid)', 'execute'),
  'anon no puede ejecutar set_primary_product_image');
select ok(has_function_privilege('authenticated', 'public.set_primary_product_image(uuid)', 'execute'),
  'authenticated puede ejecutar set_primary_product_image (RLS decide si es admin)');
select ok(not has_function_privilege('anon', 'public.set_updated_at()', 'execute'),
  'anon no puede ejecutar set_updated_at');
select ok(not has_function_privilege('authenticated', 'public.set_updated_at()', 'execute'),
  'authenticated no puede ejecutar set_updated_at');

-- ---------------------------------------------------------------------------
-- Comportamiento con los permisos nuevos
-- ---------------------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local');
insert into public.admin_users (user_id) values ('00000000-0000-0000-0000-0000000000a1');
insert into public.categories (id, name, slug) values ('10000000-0000-0000-0000-000000000001', 'Cat', 'cat');
insert into public.products (id, sku, name, slug, category_id, price_ars) values
  ('20000000-0000-0000-0000-000000000001', 'P-1', 'P1', 'p1', '10000000-0000-0000-0000-000000000001', 100);
insert into public.product_images (id, product_id, storage_path) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'productos/p1/a.webp');

-- visitante
set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select is((select count(*) from public.products where id = '20000000-0000-0000-0000-000000000001'), 1::bigint,
  'anon sigue leyendo el catálogo (las políticas pueden evaluar is_admin)');
select is((select count(*) from public.product_images where id = '30000000-0000-0000-0000-000000000001'), 1::bigint,
  'anon sigue leyendo las imágenes');
select throws_ok($$ select public.set_primary_product_image('30000000-0000-0000-0000-000000000001') $$,
  '42501', 'permission denied for function set_primary_product_image',
  'anon no puede llamar a set_primary_product_image');
select throws_ok($$ select public.set_updated_at() $$,
  '42501', 'permission denied for function set_updated_at',
  'anon no puede llamar a set_updated_at');

-- administrador
reset role;
set local role authenticated;
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

select throws_ok($$ select public.set_updated_at() $$,
  '42501', 'permission denied for function set_updated_at',
  'authenticated no puede llamar a set_updated_at directamente');
select lives_ok($$ update public.products set price_ars = 200 where id = '20000000-0000-0000-0000-000000000001' $$,
  'admin actualiza un producto: el trigger set_updated_at se dispara sin EXECUTE');
select lives_ok($$ select public.set_primary_product_image('30000000-0000-0000-0000-000000000001') $$,
  'admin marca la imagen principal');
select is((select is_primary from public.product_images where id = '30000000-0000-0000-0000-000000000001'), true,
  'la imagen quedó como principal');

reset role;

select * from finish();
rollback;
