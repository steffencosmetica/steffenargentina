-- Pruebas del esquema del catálogo: restricciones, triggers y políticas RLS.
-- Se ejecutan con `npm run db:test` (supabase test db) contra la base local; todo corre en una
-- transacción que se descarta al final, así que no deja datos.

begin;
create extension if not exists pgtap with schema extensions;

select plan(59);

-- ---------------------------------------------------------------------------
-- Datos de prueba (como postgres, sin RLS)
-- ---------------------------------------------------------------------------

insert into auth.users (id, instance_id, aud, role, email)
values
  ('00000000-0000-0000-0000-0000000000a1', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'admin@test.local'),
  ('00000000-0000-0000-0000-0000000000b2', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'cliente@test.local');

insert into public.admin_users (user_id, note) values ('00000000-0000-0000-0000-0000000000a1', 'prueba');

insert into public.categories (id, name, slug, sort_order, is_active) values
  ('10000000-0000-0000-0000-000000000001', 'Categoría activa', 'categoria-activa', 1, true),
  ('10000000-0000-0000-0000-000000000002', 'Categoría inactiva', 'categoria-inactiva', 2, false);

insert into public.products (id, sku, name, slug, category_id, price_ars, stock, is_active) values
  ('20000000-0000-0000-0000-000000000001', 'TEST-1', 'Producto visible', 'producto-visible', '10000000-0000-0000-0000-000000000001', '0.29', 5, true),
  ('20000000-0000-0000-0000-000000000002', 'TEST-2', 'Producto inactivo', 'producto-inactivo', '10000000-0000-0000-0000-000000000001', '100.00', 5, false),
  ('20000000-0000-0000-0000-000000000003', 'TEST-3', 'Producto de categoría inactiva', 'producto-cat-inactiva', '10000000-0000-0000-0000-000000000002', '100.00', 5, true);

insert into public.product_images (id, product_id, storage_path, is_primary, sort_order) values
  ('30000000-0000-0000-0000-000000000001', '20000000-0000-0000-0000-000000000001', 'productos/test-1/a.webp', true, 0),
  ('30000000-0000-0000-0000-000000000002', '20000000-0000-0000-0000-000000000001', 'productos/test-1/b.webp', false, 1),
  ('30000000-0000-0000-0000-000000000003', '20000000-0000-0000-0000-000000000002', 'productos/test-2/a.webp', true, 0);

-- ---------------------------------------------------------------------------
-- Estructura
-- ---------------------------------------------------------------------------

select has_table('public', 'categories', 'existe categories');
select has_table('public', 'products', 'existe products');
select has_table('public', 'product_images', 'existe product_images');
select has_table('public', 'admin_users', 'existe admin_users');
select col_type_is('public', 'products', 'price_ars', 'numeric(12,2)', 'el precio es decimal exacto');
select fk_ok('public', 'products', 'category_id', 'public', 'categories', 'id');
select fk_ok('public', 'product_images', 'product_id', 'public', 'products', 'id');
select ok(
  (select bool_and(relrowsecurity) from pg_class
    where oid in ('public.categories'::regclass, 'public.products'::regclass,
                  'public.product_images'::regclass, 'public.admin_users'::regclass)),
  'RLS activado en todas las tablas del catálogo'
);
select is((select public from storage.buckets where id = 'catalogo'), true, 'el bucket catalogo existe y es público');

-- ---------------------------------------------------------------------------
-- Reglas de negocio (restricciones)
-- ---------------------------------------------------------------------------

select throws_ok(
  $$ insert into public.products (sku, name, slug, category_id, price_ars, stock)
     values ('NEG-1', 'x', 'neg-1', '10000000-0000-0000-0000-000000000001', -0.01, 1) $$,
  '23514', null, 'precio negativo rechazado');
select throws_ok(
  $$ insert into public.products (sku, name, slug, category_id, price_ars, stock)
     values ('NEG-2', 'x', 'neg-2', '10000000-0000-0000-0000-000000000001', 10, -1) $$,
  '23514', null, 'stock negativo rechazado');
select throws_ok(
  $$ update public.products set stock = stock - 6 where id = '20000000-0000-0000-0000-000000000001' $$,
  '23514', null, 'descontar más stock del disponible es rechazado');
select throws_ok(
  $$ insert into public.products (sku, name, slug, category_id, price_ars, stock)
     values ('NEG-3', 'x', 'neg-3', '10000000-0000-0000-0000-000000000001', 10, '1.5') $$,
  '22P02', null, 'stock fraccionario (como llega desde la API) rechazado');
select throws_ok(
  $$ insert into public.products (sku, name, slug, category_id, price_ars, stock)
     values ('BIG-1', 'x', 'big-1', '10000000-0000-0000-0000-000000000001', 10000000000, 1) $$,
  '22003', null, 'precio fuera de rango rechazado');
select throws_ok(
  $$ insert into public.products (sku, name, slug, category_id, price_ars, stock, weight_grams)
     values ('W-1', 'x', 'w-1', '10000000-0000-0000-0000-000000000001', 10, 1, 0) $$,
  '23514', null, 'peso cero rechazado');
select throws_ok(
  $$ insert into public.products (sku, name, slug, category_id, price_ars, stock, package_width_mm)
     values ('D-1', 'x', 'd-1', '10000000-0000-0000-0000-000000000001', 10, 1, -5) $$,
  '23514', null, 'medida negativa rechazada');
select throws_ok(
  $$ insert into public.products (sku, name, slug, category_id, price_ars, stock)
     values ('test-1', 'x', 'otro-slug', '10000000-0000-0000-0000-000000000001', 10, 1) $$,
  '23505', null, 'SKU duplicado (sin distinguir mayúsculas) rechazado');
select throws_ok(
  $$ insert into public.products (sku, name, slug, category_id, price_ars, stock)
     values (' S-1', 'x', 's-1', '10000000-0000-0000-0000-000000000001', 10, 1) $$,
  '23514', null, 'SKU con espacios rechazado');
select throws_ok(
  $$ insert into public.products (sku, name, slug, category_id, price_ars, stock)
     values ('S-2', 'x', 'producto-visible', '10000000-0000-0000-0000-000000000001', 10, 1) $$,
  '23505', null, 'slug de producto duplicado rechazado');
select throws_ok(
  $$ insert into public.products (sku, name, slug, category_id, price_ars, stock)
     values ('S-3', 'x', 'Con Mayus', '10000000-0000-0000-0000-000000000001', 10, 1) $$,
  '23514', null, 'slug con formato inválido rechazado');
select throws_ok(
  $$ insert into public.products (sku, name, slug, price_ars, stock) values ('S-4', 'x', 's-4', 10, 1) $$,
  '23502', null, 'producto sin categoría rechazado');
select throws_ok(
  $$ delete from public.categories where id = '10000000-0000-0000-0000-000000000001' $$,
  '23503', null, 'no se puede borrar una categoría con productos');
select throws_ok(
  $$ insert into public.categories (name, slug) values ('Duplicada', 'categoria-activa') $$,
  '23505', null, 'slug de categoría duplicado rechazado');
select throws_ok(
  $$ insert into public.product_images (product_id, storage_path, is_primary)
     values ('20000000-0000-0000-0000-000000000001', 'productos/test-1/c.webp', true) $$,
  '23505', null, 'solo una imagen principal por producto');
select throws_ok(
  $$ insert into public.product_images (product_id, storage_path)
     values ('20000000-0000-0000-0000-000000000001', '../../secreto.webp') $$,
  '23514', null, 'ruta de imagen con ".." rechazada');

select is(
  (select sum(price_ars) * 100 from public.products where id = '20000000-0000-0000-0000-000000000001'),
  29::numeric, 'el precio 0.29 se guarda exacto (29 centavos)');

-- updated_at se actualiza solo
update public.products set updated_at = '2020-01-01', created_at = '2020-01-01' where id = '20000000-0000-0000-0000-000000000002';
update public.products set stock = 7 where id = '20000000-0000-0000-0000-000000000002';
select ok(
  (select updated_at > '2020-01-01' from public.products where id = '20000000-0000-0000-0000-000000000002'),
  'el trigger actualiza updated_at');

-- ---------------------------------------------------------------------------
-- Visitante anónimo
-- ---------------------------------------------------------------------------

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);

select is(public.is_admin(), false, 'anon: no es administrador');
select results_eq($$ select slug from public.categories $$, $$ values ('categoria-activa') $$,
  'anon: solo ve categorías activas');
select results_eq($$ select slug from public.products $$, $$ values ('producto-visible') $$,
  'anon: solo ve productos activos de categorías activas');
select results_eq($$ select storage_path from public.product_images order by sort_order $$,
  $$ values ('productos/test-1/a.webp'), ('productos/test-1/b.webp') $$,
  'anon: solo ve imágenes de productos visibles');
select throws_ok($$ select * from public.admin_users $$, '42501', null, 'anon: no puede leer administradores');
select throws_ok($$ insert into public.categories (name, slug) values ('x', 'anon-cat') $$,
  '42501', null, 'anon: no puede crear categorías');
select throws_ok($$ update public.products set price_ars = 1 $$,
  '42501', null, 'anon: no puede cambiar precios');
select throws_ok($$ update public.products set stock = 999 $$,
  '42501', null, 'anon: no puede cambiar stock');
select throws_ok($$ delete from public.products $$,
  '42501', null, 'anon: no puede borrar productos');
select throws_ok($$ insert into public.admin_users (user_id) values ('00000000-0000-0000-0000-0000000000b2') $$,
  '42501', null, 'anon: no puede darse rol de administrador');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('catalogo', 'anon.png') $$,
  '42501', null, 'anon: no puede subir imágenes');

reset role;

-- ---------------------------------------------------------------------------
-- Usuario logueado sin rol de administrador
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000b2","role":"authenticated"}', true);

select is(public.is_admin(), false, 'cliente: no es administrador');
select results_eq($$ select slug from public.products $$, $$ values ('producto-visible') $$,
  'cliente: ve lo mismo que un visitante');
select is_empty($$ select * from public.admin_users $$, 'cliente: no ve la lista de administradores');
select throws_ok($$ insert into public.categories (name, slug) values ('x', 'cliente-cat') $$,
  '42501', null, 'cliente: no puede crear categorías');
select throws_ok($$ insert into public.admin_users (user_id) values ('00000000-0000-0000-0000-0000000000b2') $$,
  '42501', null, 'cliente: no puede darse rol de administrador');
select is_empty($$ update public.products set price_ars = 1 returning id $$,
  'cliente: el cambio de precio no afecta ninguna fila');
select is_empty($$ update public.products set stock = 999 returning id $$,
  'cliente: el cambio de stock no afecta ninguna fila');
select is_empty($$ delete from public.products returning id $$,
  'cliente: el borrado no afecta ninguna fila');
select throws_ok($$ select public.set_primary_product_image('30000000-0000-0000-0000-000000000002') $$,
  '42501', null, 'cliente: no puede cambiar la imagen principal');
select throws_ok($$ insert into storage.objects (bucket_id, name) values ('catalogo', 'cliente.png') $$,
  '42501', null, 'cliente: no puede subir imágenes');

reset role;

select is((select price_ars from public.products where id = '20000000-0000-0000-0000-000000000001'), 0.29::numeric,
  'el precio sigue intacto después de los intentos sin permiso');
select is((select stock from public.products where id = '20000000-0000-0000-0000-000000000001'), 5,
  'el stock sigue intacto después de los intentos sin permiso');

-- ---------------------------------------------------------------------------
-- Administrador
-- ---------------------------------------------------------------------------

set local role authenticated;
select set_config('request.jwt.claims',
  '{"sub":"00000000-0000-0000-0000-0000000000a1","role":"authenticated"}', true);

select is(public.is_admin(), true, 'admin: es administrador');
select is((select count(*) from public.products), 3::bigint, 'admin: ve también productos inactivos');
select is((select count(*) from public.categories), 2::bigint, 'admin: ve también categorías inactivas');
select lives_ok($$ insert into public.categories (name, slug) values ('Nueva', 'nueva') $$,
  'admin: puede crear categorías');
select lives_ok($$ update public.products set price_ars = '15999.90', stock = 3 where sku = 'TEST-1' $$,
  'admin: puede cambiar precio y stock');
select throws_ok($$ update public.products set stock = -1 where sku = 'TEST-1' $$,
  '23514', null, 'admin: tampoco puede dejar stock negativo');
select lives_ok($$ select public.set_primary_product_image('30000000-0000-0000-0000-000000000002') $$,
  'admin: puede cambiar la imagen principal');
select results_eq(
  $$ select id::text from public.product_images where product_id = '20000000-0000-0000-0000-000000000001' and is_primary $$,
  $$ values ('30000000-0000-0000-0000-000000000002') $$,
  'admin: queda una sola imagen principal, la nueva');
select lives_ok($$ insert into storage.objects (bucket_id, name) values ('catalogo', 'productos/test/admin.png') $$,
  'admin: puede subir imágenes al bucket');

reset role;

select * from finish();
rollback;
