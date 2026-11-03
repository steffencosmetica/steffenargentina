-- Auditoría de solo lectura; ejecutar únicamente contra el stack local durante la revisión.
-- No selecciona filas de compradores ni secretos.
select p.oid::regprocedure::text as function_name,
       pg_get_userbyid(p.proowner) as owner,
       p.prosecdef as security_definer,
       p.proconfig as settings,
       has_function_privilege('anon',p.oid,'execute') as anon_execute,
       has_function_privilege('authenticated',p.oid,'execute') as authenticated_execute,
       has_function_privilege('service_role',p.oid,'execute') as service_role_execute,
       exists(select 1 from aclexplode(coalesce(p.proacl,acldefault('f',p.proowner))) a
              where a.grantee=0 and a.privilege_type='EXECUTE') as public_execute
from pg_proc p
where p.oid in (
  'public.admin_listar_pedidos(jsonb,integer)'::regprocedure,
  'public.admin_operar_pedido(uuid,integer,text,text,text,text,timestamptz)'::regprocedure,
  'private.orders_incrementar_version()'::regprocedure,
  'public.admin_cancelar_pedido(uuid)'::regprocedure,
  'public.admin_actualizar_preparacion(uuid,text,text,text)'::regprocedure,
  'public.admin_actualizar_notas(uuid,text)'::regprocedure,
  'public.admin_resolver_faltante(uuid)'::regprocedure,
  'public.admin_marcar_resuelto(uuid)'::regprocedure
) order by function_name;

select c.relname as table_name, c.relrowsecurity as rls_enabled,
       has_table_privilege('anon',c.oid,'update') as anon_update,
       has_table_privilege('authenticated',c.oid,'update') as authenticated_update,
       has_table_privilege('service_role',c.oid,'update') as service_role_update
from pg_class c where c.oid in ('public.orders'::regclass,'public.order_items'::regclass,'public.order_events'::regclass)
order by table_name;

select tablename,policyname,roles,cmd,qual,with_check from pg_policies
where schemaname='public' and tablename in ('orders','order_items','order_events') order by tablename;

select tgname, tgenabled, pg_get_triggerdef(oid) as definition
from pg_trigger where tgrelid='public.orders'::regclass and not tgisinternal order by tgname;
