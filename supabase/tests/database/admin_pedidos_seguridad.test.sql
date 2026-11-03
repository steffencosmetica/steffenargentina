-- Auditoría con los roles efectivos de la API. Todo se revierte al finalizar.
begin;
select no_plan();
\ir ../fixtures/admin-pedidos.inc
insert into auth.users(id,email) values
  ('bb600000-0000-4000-8000-000000000099','admin-auditoria@steffen.test'),
  ('bb600000-0000-4000-8000-000000000098','cliente-auditoria@steffen.test');
insert into public.admin_users(user_id) values ('bb600000-0000-4000-8000-000000000099');

select ok(bool_and(relrowsecurity), 'RLS sigue habilitado en pedidos, artículos y eventos')
from pg_class where oid in ('public.orders'::regclass,'public.order_items'::regclass,'public.order_events'::regclass);
select is(count(*)::int,3,'las tres políticas de lectura exigen is_admin')
from pg_policies where schemaname='public' and tablename in ('orders','order_items','order_events')
and cmd='SELECT' and qual like '%is_admin()%';
select ok(bool_and(prosecdef and proconfig @> array['search_path=""']), 'RPC nuevas: definer y search_path vacío')
from pg_proc where oid in ('public.admin_listar_pedidos(jsonb,integer)'::regprocedure,
 'public.admin_operar_pedido(uuid,integer,text,text,text,text,timestamptz)'::regprocedure);
select ok(not exists(select 1 from pg_proc p cross join lateral aclexplode(p.proacl) a
 where p.oid in ('public.admin_listar_pedidos(jsonb,integer)'::regprocedure,
 'public.admin_operar_pedido(uuid,integer,text,text,text,text,timestamptz)'::regprocedure)
 and a.grantee=0 and a.privilege_type='EXECUTE'), 'PUBLIC no tiene EXECUTE');
select ok(not has_function_privilege(r,f,'execute'), r || ' no ejecuta ' || f)
from unnest(array['anon','service_role']) r cross join unnest(array[
 'public.admin_listar_pedidos(jsonb,integer)',
 'public.admin_operar_pedido(uuid,integer,text,text,text,text,timestamptz)']) f;
select ok(has_function_privilege('authenticated',f,'execute'), 'authenticated puede invocar, sujeto a is_admin: ' || f)
from unnest(array['public.admin_listar_pedidos(jsonb,integer)',
 'public.admin_operar_pedido(uuid,integer,text,text,text,text,timestamptz)']) f;
select ok(not has_schema_privilege(r,'private','usage') and not has_function_privilege(r,'private.orders_incrementar_version()','execute'),
 r || ' sin acceso al trigger privado') from unnest(array['anon','authenticated','service_role']) r;
select ok(not has_table_privilege(r,t,priv),r || ' sin ' || priv || ' sobre ' || t)
from unnest(array['anon','authenticated','service_role']) r
cross join unnest(array['public.orders','public.order_items','public.order_events']) t
cross join unnest(array['insert','update','delete','truncate']) priv;

select set_config('request.jwt.claim.sub','bb600000-0000-4000-8000-000000000098',true);
set local role authenticated;
select is((select count(*) from public.orders),0::bigint,'cliente autenticado: cero pedidos por RLS');
select is((select count(*) from public.order_items),0::bigint,'cliente autenticado: cero artículos por RLS');
select is((select count(*) from public.order_events),0::bigint,'cliente autenticado: cero eventos por RLS');
select throws_ok($$select access_token_hash from public.orders$$,'42501',null,'cliente sin columnas secretas');
select throws_ok($$update public.orders set admin_notes='intrusión'$$,'42501',null,'cliente sin UPDATE');
select throws_ok($$select public.admin_listar_pedidos('{}',1)$$,'42501',null,'is_admin bloquea listado RPC para cliente');
select throws_ok(format('select public.admin_operar_pedido(%L,0,%L)', 'bb600000-0000-4000-8000-000000000026', op),
 '42501',null,'is_admin bloquea operación ' || op)
from unnest(array['notes','cancel','resolve_stock','pending','preparing','shipped','delivered']) op;
select throws_ok($$select public.admin_actualizar_notas('bb600000-0000-4000-8000-000000000026','intrusión')$$,'42501',null,'RPC anterior de notas exige admin');
select throws_ok($$select public.admin_cancelar_pedido('bb600000-0000-4000-8000-000000000002')$$,'42501',null,'RPC anterior de cancelación exige admin');
select throws_ok($$select public.admin_actualizar_preparacion('bb600000-0000-4000-8000-000000000026','preparing')$$,'42501',null,'RPC anterior de preparación exige admin');
select throws_ok($$select public.admin_resolver_faltante('bb600000-0000-4000-8000-000000000026')$$,'42501',null,'RPC anterior de faltantes exige admin');
select throws_ok($$select public.admin_marcar_resuelto('bb600000-0000-4000-8000-000000000026')$$,'42501',null,'RPC anterior de resolución exige admin');
reset role;
select is((select admin_version from public.orders where id='bb600000-0000-4000-8000-000000000026'),0,'rechazos no cambian la versión');
select is((select count(*) from public.order_events where actor='admin'),0::bigint,'rechazos no insertan eventos');

select set_config('request.jwt.claim.sub','bb600000-0000-4000-8000-000000000099',true);
set local role authenticated;
select lives_ok($$select public.admin_actualizar_notas('bb600000-0000-4000-8000-000000000026','Contrato anterior')$$,'compatibilidad: RPC anterior de notas');
select is((select admin_version from public.orders where id='bb600000-0000-4000-8000-000000000026'),1,'RPC anterior incrementa la versión');
select throws_ok($$select public.admin_operar_pedido('bb600000-0000-4000-8000-000000000026',0,'notes','Viejo')$$,'SR004',null,'RPC anterior invalida formularios abiertos');
select lives_ok($$select public.admin_actualizar_preparacion('bb600000-0000-4000-8000-000000000026','preparing')$$,'compatibilidad: RPC anterior de preparación');
select is((select admin_version from public.orders where id='bb600000-0000-4000-8000-000000000026'),2,'preparación anterior incrementa versión');
select throws_ok($$select public.admin_operar_pedido('bb600000-0000-4000-8000-000000000026',2,'delivered')$$,'SR002',null,'se mantiene prohibido saltar despacho');
select is((select admin_version from public.orders where id='bb600000-0000-4000-8000-000000000026'),2,'operación inválida revierte incremento de versión');
select lives_ok($$select public.admin_cancelar_pedido('bb600000-0000-4000-8000-000000000002')$$,'compatibilidad: RPC anterior de cancelación');
select throws_ok($$select public.admin_cancelar_pedido('bb600000-0000-4000-8000-000000000002')$$,'55000',null,'cancelación anterior no se repite');
reset role;
select is((select stock from public.products where id='bb600000-0000-4000-8000-000000000002'),75,'compatibilidad: stock liberado una sola vez');
select is((select stock_state from public.orders where id='bb600000-0000-4000-8000-000000000002'),'released','cancelación conserva transición reserved a released');

set local role anon;
select throws_ok($$select id from public.orders$$,'42501',null,'anon sin SELECT de pedidos');
select throws_ok($$select public.admin_listar_pedidos('{}',1)$$,'42501',null,'anon sin EXECUTE listado');
select throws_ok($$select public.admin_operar_pedido('bb600000-0000-4000-8000-000000000026',2,'notes','intrusión')$$,'42501',null,'anon sin EXECUTE operación');
reset role;
select * from finish();
rollback;
