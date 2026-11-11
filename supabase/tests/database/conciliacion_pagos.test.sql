begin;
create extension if not exists pgtap with schema extensions;
select plan(12);

select ok((select relrowsecurity from pg_class where oid='private.payment_jobs'::regclass), 'RLS de trabajos');
select ok(not has_table_privilege('service_role','private.payment_jobs','select'), 'sin lectura directa incluso con service_role');
select ok(not has_function_privilege('anon','public.recibir_notificacion_pago(text,text,text,text)','execute')
  and not has_function_privilege('authenticated','public.resolver_trabajo_pago(uuid,uuid,jsonb,text,text,boolean)','execute')
  and has_function_privilege('service_role','public.tomar_trabajos_pago()','execute'), 'RPC restringidas');
select ok(public.recibir_notificacion_pago('req1','1234','ORDMOCK'||repeat('a',32),'order.processed'), 'evento persistido');
select ok(public.recibir_notificacion_pago('req1','1234','ORDMOCK'||repeat('a',32),'order.processed'), 'replay con confirmación idempotente');
select ok(not public.recibir_notificacion_pago('req1','5678','ORDMOCK'||repeat('b',32),'order.created'), 'conflicto de identidad no se reconoce como recibido');
select is((select count(*) from private.payment_jobs), 1::bigint, 'una sola fila durable');
create temp table payment_claim as select public.tomar_trabajos_pago() as j;
select is((select j->>'provider' from payment_claim),'ORDMOCK'||repeat('a',32),'identificador de consulta');
select is(public.resolver_trabajo_pago((j->>'id')::uuid,gen_random_uuid(),null,null,'provider_unavailable',true),'stale','concesión incorrecta') from payment_claim;
select is(public.resolver_trabajo_pago((j->>'id')::uuid,(j->>'lease')::uuid,null,null,'provider_unavailable',true),'provider_unavailable','error temporal') from payment_claim;
select ok((select state='queued' and next_at>clock_timestamp() from private.payment_jobs),'backoff durable');
update private.payment_jobs set attempts=9,next_at=clock_timestamp();
update payment_claim set j=public.tomar_trabajos_pago();
do $$ begin perform public.resolver_trabajo_pago((j->>'id')::uuid,(j->>'lease')::uuid,null,null,'provider_unavailable',true) from payment_claim; end $$;
select is(public.estado_trabajos_pago()->>'dead','1','alerta observable al agotar intentos');
select * from finish();
rollback;
