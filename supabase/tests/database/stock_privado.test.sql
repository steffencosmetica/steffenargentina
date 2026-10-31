-- Solo los administradores consultan el stock exacto: anon y los usuarios logueados ven la disponibilidad;
-- los administradores leen el stock con admin_product_stock() y lo editan como siempre.
-- Se ejecuta con `npm run db:test`; todo corre en una transacción que se descarta al final.

begin;
create extension if not exists pgtap with schema extensions;

select plan(30);

-- ---------------------------------------------------------------------------
-- Permisos por columna
-- ---------------------------------------------------------------------------

select ok(not has_table_privilege('anon', 'public.products', 'select'), 'anon no tiene SELECT sobre toda la tabla');
select ok(not has_column_privilege('anon', 'public.products', 'stock', 'select'), 'anon no puede leer stock');
select ok(has_column_privilege('anon', 'public.products', 'availability', 'select'), 'anon puede leer availability');
select ok(not has_column_privilege('anon', 'public.products', 'created_at', 'select'), 'anon no lee columnas que el catálogo no necesita');
select is(
  (select array_agg(a.attname::text order by a.attname::text)
     from pg_attribute a
    where a.attrelid = 'public.products'::regclass and a.attnum > 0 and not a.attisdropped
      and has_column_privilege('anon', a.attrelid, a.attnum, 'select')),
  array['availability', 'benefits', 'category_id', 'description', 'id', 'is_active', 'is_featured', 'name',
        'package_height_mm', 'package_length_mm', 'package_width_mm', 'presentation', 'price_ars', 'short_description',
        'sku', 'slug', 'sort_order', 'updated_at', 'usage_instructions', 'weight_grams'],
  'anon lee exactamente las columnas del catálogo (lista permitida)'
);
select ok(not has_column_privilege('anon', 'public.products', 'stock', 'update'), 'anon no puede modificar stock');
select ok(not has_column_privilege('anon', 'public.products', 'price_ars', 'update'), 'anon no puede modificar precios');
select ok(not has_column_privilege('authenticated', 'public.products', 'stock', 'select'), 'authenticated no puede leer stock con SELECT (ni siquiera un admin)');
select ok(has_column_privilege('authenticated', 'public.products', 'created_at', 'select'), 'authenticated lee el resto de las columnas (el panel)');
select ok(not has_function_privilege('anon', 'public.admin_product_stock(uuid[])', 'execute'), 'anon no puede ejecutar admin_product_stock');
select ok(
  (select prosecdef and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.admin_product_stock(uuid[])'::regprocedure),
  'admin_product_stock es security definer con search_path vacío'
);
select ok(has_column_privilege('authenticated', 'public.products', 'stock', 'update'), 'authenticated (admin por RLS) edita stock');
select ok(
  (select bool_or(conname = 'products_stock_check') from pg_constraint where conrelid = 'public.products'::regclass),
  'se conserva la regla stock >= 0'
);

-- ---------------------------------------------------------------------------
-- Disponibilidad calculada por la base
-- ---------------------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email)
values ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local');
insert into public.admin_users (user_id) values ('00000000-0000-0000-0000-0000000000a1');
insert into public.categories (id, name, slug, is_active) values
  ('10000000-0000-0000-0000-000000000001', 'Activa', 'activa', true),
  ('10000000-0000-0000-0000-000000000002', 'Inactiva', 'inactiva', false);
insert into public.products (id, sku, name, slug, category_id, price_ars, stock, is_active) values
  ('20000000-0000-0000-0000-000000000001', 'S-0', 'S0', 's0', '10000000-0000-0000-0000-000000000001', 100, 0, true),
  ('20000000-0000-0000-0000-000000000002', 'S-1', 'S1', 's1', '10000000-0000-0000-0000-000000000001', 100, 1, true),
  ('20000000-0000-0000-0000-000000000003', 'S-3', 'S3', 's3', '10000000-0000-0000-0000-000000000001', 100, 3, true),
  ('20000000-0000-0000-0000-000000000004', 'S-4', 'S4', 's4', '10000000-0000-0000-0000-000000000001', 100, 4, true),
  ('20000000-0000-0000-0000-000000000005', 'S-IN', 'Inactivo', 'inactivo', '10000000-0000-0000-0000-000000000001', 100, 9, false),
  ('20000000-0000-0000-0000-000000000006', 'S-CI', 'Cat inactiva', 'cat-inactiva', '10000000-0000-0000-0000-000000000002', 100, 9, true);

select results_eq(
  $$ select sku, availability from public.products where sku in ('S-0', 'S-1', 'S-3', 'S-4') order by sku $$,
  $$ values ('S-0', 'sin-stock'), ('S-1', 'ultimas'), ('S-3', 'ultimas'), ('S-4', 'disponible') $$,
  'availability: 0 sin stock, 1 a 3 últimas unidades, más de 3 disponible'
);
update public.products set stock = 10 where sku = 'S-0';
select is((select availability from public.products where sku = 'S-0'), 'disponible', 'availability se recalcula al cambiar el stock');
select throws_ok($$ update public.products set availability = 'disponible' where sku = 'S-1' $$, '428C9', null,
  'availability no se puede escribir a mano');

-- ---------------------------------------------------------------------------
-- Visitante
-- ---------------------------------------------------------------------------

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select results_eq(
  $$ select sku, availability from public.products order by sku $$,
  $$ values ('S-0', 'disponible'), ('S-1', 'ultimas'), ('S-3', 'ultimas'), ('S-4', 'disponible') $$,
  'anon ve solo productos activos de categorías activas, con su disponibilidad'
);
select throws_ok($$ select stock from public.products $$, '42501', null, 'anon: select explícito de stock rechazado');
select throws_ok($$ select * from public.products $$, '42501', null, 'anon: select * rechazado');
select throws_ok($$ select sku from public.products where stock > 3 $$, '42501', null, 'anon: filtrar por stock rechazado');
select throws_ok($$ select sku from public.products order by stock $$, '42501', null, 'anon: ordenar por stock rechazado');
select throws_ok($$ select i.id from public.product_images i join public.products p on p.id = i.product_id where p.stock > 0 $$,
  '42501', null, 'anon: stock a través de un join rechazado');
select throws_ok($$ update public.products set stock = 0 $$, '42501', null, 'anon no puede modificar stock');

-- ---------------------------------------------------------------------------
-- Administrador
-- ---------------------------------------------------------------------------

reset role;
set local role authenticated;

-- usuario logueado que no es administrador
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);
select throws_ok($$ select stock from public.products $$, '42501', null, 'no admin: select de stock rechazado');
select throws_ok($$ select sku from public.products where stock > 3 $$, '42501', null, 'no admin: filtrar por stock rechazado');
select throws_ok($$ select * from public.admin_product_stock() $$, '42501', null, 'no admin: admin_product_stock rechazada');

-- administrador
select set_config('request.jwt.claims', '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);
select throws_ok($$ select stock from public.products $$, '42501', null, 'admin: tampoco lee stock con SELECT (usa la función)');
select is((select stock from public.admin_product_stock(array['20000000-0000-0000-0000-000000000005'::uuid])), 9,
  'el admin lee el stock exacto con admin_product_stock (también de inactivos)');
select lives_ok($$ update public.products set stock = 2 where sku = 'S-4' $$, 'el admin edita el stock');
select is((select availability from public.products where sku = 'S-4'), 'ultimas', 'la disponibilidad acompaña el cambio del admin');

reset role;
select * from finish();
rollback;
