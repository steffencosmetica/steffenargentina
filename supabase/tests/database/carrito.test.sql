-- Cotización del carrito (Fase 4B.4): permisos, validación, estados, límites y privacidad del stock.
-- Se ejecuta con `npm run db:test`; todo corre en una transacción que se descarta al final.

begin;
create extension if not exists pgtap with schema extensions;

select plan(49);

-- ---------------------------------------------------------------------------
-- Declaración y permisos
-- ---------------------------------------------------------------------------

select ok(
  (select prosecdef and provolatile = 's' and proconfig @> array['search_path=""'] from pg_proc where oid = 'public.cotizar_carrito(jsonb)'::regprocedure),
  'cotizar_carrito: security definer, stable (solo lectura) y search_path vacío'
);
select ok(has_function_privilege('anon', 'public.cotizar_carrito(jsonb)', 'execute'), 'anon puede cotizar (no hace falta service_role)');
select ok(has_function_privilege('authenticated', 'public.cotizar_carrito(jsonb)', 'execute'), 'authenticated puede cotizar');
select ok(not has_function_privilege('public', 'public.cotizar_carrito(jsonb)', 'execute'), 'sin EXECUTE para PUBLIC');

-- ---------------------------------------------------------------------------
-- Datos
-- ---------------------------------------------------------------------------

insert into public.categories (id, name, slug, is_active) values
  ('10000000-0000-0000-0000-000000000001', 'Activa', 'activa', true),
  ('10000000-0000-0000-0000-000000000002', 'Inactiva', 'inactiva', false);
insert into public.products (id, sku, name, slug, category_id, price_ars, stock, is_active) values
  ('20000000-0000-0000-0000-000000000001', 'P-1', 'Mucho stock', 'p1', '10000000-0000-0000-0000-000000000001', 12550, 100, true),
  ('20000000-0000-0000-0000-000000000002', 'P-2', 'Pocas unidades', 'p2', '10000000-0000-0000-0000-000000000001', 9000.50, 2, true),
  ('20000000-0000-0000-0000-000000000003', 'P-3', 'Sin stock', 'p3', '10000000-0000-0000-0000-000000000001', 500, 0, true),
  ('20000000-0000-0000-0000-000000000004', 'P-4', 'Inactivo', 'p4', '10000000-0000-0000-0000-000000000001', 500, 10, false),
  ('20000000-0000-0000-0000-000000000005', 'P-5', 'Categoría inactiva', 'p5', '10000000-0000-0000-0000-000000000002', 500, 10, true);
insert into public.product_images (product_id, storage_path, is_primary, sort_order) values
  ('20000000-0000-0000-0000-000000000001', 'productos/p1/b.webp', false, 1),
  ('20000000-0000-0000-0000-000000000001', 'productos/p1/a.webp', true, 2);

create function pg_temp.q(p jsonb) returns jsonb language sql as $$ select public.cotizar_carrito(p) $$;
create function pg_temp.it(n integer, q integer) returns jsonb language sql as $$
  select jsonb_build_object('product_id', ('20000000-0000-0000-0000-00000000000' || n)::uuid, 'quantity', q) $$;
create function pg_temp.linea(r jsonb, n integer) returns jsonb language sql as $$
  select l from jsonb_array_elements(r -> 'items') l where l ->> 'product_id' = '20000000-0000-0000-0000-00000000000' || n $$;

-- ---------------------------------------------------------------------------
-- Cotización como visitante
-- ---------------------------------------------------------------------------

set local role anon;
select set_config('request.jwt.claims', '{"role":"anon"}', true);
select set_config('test.r', pg_temp.q(jsonb_build_array(pg_temp.it(1, 2), pg_temp.it(2, 1), pg_temp.it(3, 1), pg_temp.it(4, 1), pg_temp.it(5, 1)))::text, true);
create function pg_temp.r() returns jsonb language sql as $$ select current_setting('test.r')::jsonb $$;

select is(pg_temp.r() -> 'limits', '{"max_units_per_product": 5, "max_units_per_order": 20}'::jsonb, 'límites públicos de store_settings');
select is(pg_temp.r() -> 'checkout_enabled', 'false'::jsonb, 'informa que el checkout está deshabilitado');
select results_eq(
  $$ select l ->> 'status', l ->> 'price_ars', l ->> 'line_total_ars', (l ->> 'max_quantity')::integer, l ->> 'image_path' from pg_temp.linea(pg_temp.r(), 1) l $$,
  $$ values ('ok'::text, '12550.00'::text, '25100.00'::text, 5, 'productos/p1/a.webp'::text) $$,
  'precio vigente, total de línea exacto, imagen principal'
);
select is(pg_temp.linea(pg_temp.r(), 1) ->> 'max_quantity', '5', 'con 100 unidades el máximo comprable es el límite por producto (no el stock)');
select is(pg_temp.linea(pg_temp.r(), 2) ->> 'status', 'ok', 'producto con pocas unidades y cantidad válida');
select is(pg_temp.linea(pg_temp.r(), 3) ->> 'status', 'out_of_stock', 'sin stock');
select is(pg_temp.linea(pg_temp.r(), 3) ->> 'line_total_ars', null, 'sin stock: no suma al subtotal');
select is(pg_temp.linea(pg_temp.r(), 4) ->> 'status', 'unavailable', 'producto desactivado: no disponible');
select is(pg_temp.linea(pg_temp.r(), 4) ->> 'price_ars', null, 'producto desactivado: sin precio');
select is(pg_temp.linea(pg_temp.r(), 5) ->> 'status', 'unavailable', 'categoría desactivada: no disponible');
select ok(
  (select bool_and(l ->> k is null)
     from (values (pg_temp.linea(pg_temp.r(), 4)), (pg_temp.linea(pg_temp.r(), 5))) v(l),
          unnest(array['name', 'slug', 'sku', 'price_ars', 'image_path', 'availability', 'line_total_ars']) k),
  'producto o categoría inactivos: sin nombre ni otros datos comerciales'
);
select is(pg_temp.linea(pg_temp.r(), 4) ->> 'max_quantity', '0', 'producto inactivo: max_quantity 0 (no revela stock)');
select is(
  pg_temp.linea(pg_temp.r(), 4) - 'product_id'::text,
  (pg_temp.q(jsonb_build_array(pg_temp.it(9, 1))) -> 'items' -> 0) - 'product_id'::text,
  'un producto inactivo es indistinguible de uno inexistente'
);
select ok(pg_temp.r()::text !~ 'Inactivo|Categoría inactiva|P-4|P-5|"p4"|"p5"', 'los nombres, SKU y slugs ocultos no aparecen en la respuesta');
select is(pg_temp.r() ->> 'subtotal_ars', '34100.50', 'subtotal exacto solo de lo comprable (25100 + 9000,50)');
select is((pg_temp.r() ->> 'units')::integer, 3, 'unidades comprables');
select is(pg_temp.r() -> 'can_checkout', 'false'::jsonb, 'con artículos no disponibles no se puede finalizar');
select ok(jsonb_typeof(pg_temp.r() -> 'subtotal_ars') = 'string' and jsonb_typeof(pg_temp.linea(pg_temp.r(), 1) -> 'price_ars') = 'string',
  'importes como texto exacto (sin float)');

-- privacidad del stock
select ok(
  not exists (select 1 from jsonb_array_elements(pg_temp.r() -> 'items') l, jsonb_object_keys(l) k where k in ('stock', 'is_active', 'category_id')),
  'ninguna línea expone stock ni datos administrativos'
);
select ok(pg_temp.r()::text !~ '"100"|: 100[,}]', 'el stock exacto (100) no aparece en la respuesta');
select ok(
  (select bool_and((l ->> 'max_quantity')::integer <= 5) from jsonb_array_elements(pg_temp.r() -> 'items') l),
  'max_quantity siempre acotado por el límite por producto'
);

-- excesos
select is(pg_temp.linea(pg_temp.q(jsonb_build_array(pg_temp.it(2, 3))), 2) ->> 'status', 'exceeds_stock', 'más unidades que las disponibles');
select is(pg_temp.linea(pg_temp.q(jsonb_build_array(pg_temp.it(2, 3))), 2) ->> 'max_quantity', '2', 'informa el máximo comprable (dentro del límite comercial)');
select is(pg_temp.linea(pg_temp.q(jsonb_build_array(pg_temp.it(1, 6))), 1) ->> 'status', 'exceeds_limit', 'más que el máximo por producto');
select is(
  pg_temp.q(jsonb_build_array(pg_temp.it(1, 5), pg_temp.it(2, 2))) -> 'can_checkout', 'true'::jsonb,
  'todo disponible y dentro de los límites: se puede finalizar'
);
select is(pg_temp.q('[]'::jsonb) -> 'can_checkout', 'false'::jsonb, 'carrito vacío: no se puede finalizar');
select is(pg_temp.q('[]'::jsonb) ->> 'subtotal_ars', '0.00', 'carrito vacío: subtotal 0');
select is(
  pg_temp.q(jsonb_build_array(pg_temp.it(9, 1))) -> 'items' -> 0 ->> 'status', 'unavailable',
  'producto inexistente: no disponible'
);

-- validación estricta
select throws_ok($$ select pg_temp.q('{}'::jsonb) $$, '22023', null, 'no es un arreglo');
select throws_ok($$ select pg_temp.q('[{"product_id":"x","quantity":1}]'::jsonb) $$, '22023', null, 'id no uuid');
select throws_ok($$ select pg_temp.q(jsonb_build_array(pg_temp.it(1, 0))) $$, '22023', null, 'cantidad cero');
select throws_ok($$ select pg_temp.q(jsonb_build_array(pg_temp.it(1, 1) || '{"price_ars":1}')) $$, '22023', null, 'claves extra (precio del navegador) rechazadas');
select throws_ok($$ select pg_temp.q(jsonb_build_array(pg_temp.it(1, 1), pg_temp.it(1, 2))) $$, '22023', null, 'producto repetido');
select throws_ok(
  $$ select pg_temp.q((select jsonb_agg(jsonb_build_object('product_id', gen_random_uuid(), 'quantity', 1)) from generate_series(1, 51))) $$,
  '22023', null, 'más de 50 artículos');
reset role;

-- límites configurados por el administrador
update public.store_settings set max_units_per_product = 3, max_units_per_order = 4;
select is(pg_temp.q(jsonb_build_array(pg_temp.it(1, 4))) -> 'items' -> 0 ->> 'max_quantity', '3', 'el límite por producto sale de store_settings');
select is(pg_temp.q(jsonb_build_array(pg_temp.it(1, 3), pg_temp.it(2, 2))) -> 'exceeds_order_limit', 'true'::jsonb, 'el límite por carrito sale de store_settings');

-- solo lectura: no reserva ni crea nada
select results_eq(
  $$ select (select stock from public.products where id = '20000000-0000-0000-0000-000000000001'), (select count(*) from public.orders), (select count(*) from public.checkout_attempts) $$,
  $$ values (100, 0::bigint, 0::bigint) $$,
  'cotizar no reserva stock ni crea pedidos ni intentos'
);

-- configuración obligatoria: sin fila o con límites inválidos no se cotiza (nunca se cae en el stock exacto).
-- Los CHECK y NOT NULL de store_settings ya lo impiden; se quitan dentro de esta transacción (rollback)
-- para probar la defensa propia de la función.
alter table public.store_settings
  drop constraint store_settings_units_product_check,
  drop constraint store_settings_units_order_check,
  alter column max_units_per_product drop not null,
  alter column max_units_per_order drop not null;

update public.store_settings set max_units_per_product = null;
select throws_ok($$ select pg_temp.q(jsonb_build_array(pg_temp.it(1, 1))) $$, '55000', null, 'max_units_per_product nulo: rechaza (least() ignoraría el NULL)');
update public.store_settings set max_units_per_product = 0;
select throws_ok($$ select pg_temp.q(jsonb_build_array(pg_temp.it(1, 1))) $$, '55000', null, 'max_units_per_product cero: rechaza');
update public.store_settings set max_units_per_product = -1;
select throws_ok($$ select pg_temp.q('[]'::jsonb) $$, '55000', null, 'max_units_per_product negativo: rechaza (aun con el carrito vacío)');
update public.store_settings set max_units_per_product = 5, max_units_per_order = null;
select throws_ok($$ select pg_temp.q(jsonb_build_array(pg_temp.it(1, 1))) $$, '55000', null, 'max_units_per_order nulo: rechaza');
update public.store_settings set max_units_per_order = 0;
select throws_ok($$ select pg_temp.q(jsonb_build_array(pg_temp.it(1, 1))) $$, '55000', null, 'max_units_per_order cero: rechaza');
update public.store_settings set max_units_per_order = 20;
select lives_ok($$ select pg_temp.q(jsonb_build_array(pg_temp.it(1, 1))) $$, 'con límites válidos vuelve a cotizar');

delete from public.store_settings;
set local role anon;
select throws_ok($$ select pg_temp.q(jsonb_build_array(pg_temp.it(1, 1))) $$, '55000', null, 'sin la fila de store_settings: rechaza sin devolver datos (anon)');
select throws_ok($$ select pg_temp.q('[]'::jsonb) $$, '55000', null, 'sin la fila de store_settings: rechaza incluso con el carrito vacío');
reset role;

select * from finish();
rollback;
