begin;
select no_plan();

insert into auth.users(id,email) values ('bc710000-0000-4000-8000-000000000001','comms-admin@steffen.test');
insert into public.admin_users(user_id) values ('bc710000-0000-4000-8000-000000000001');
create temp table claimed(id uuid, lease_id uuid, kind text, recipient text, attempt integer, payload jsonb) on commit drop;
create temp table vars(name text primary key, value text) on commit drop;
grant all on claimed, vars to service_role, authenticated;

-- ---------------------------------------------------------------------------
-- Permisos y estructura
-- ---------------------------------------------------------------------------
select ok(bool_and(relrowsecurity), 'RLS en todas las tablas nuevas') from pg_class where oid in
  ('public.revocation_messages'::regclass, 'public.revocation_message_attempts'::regclass, 'public.revocation_message_events'::regclass,
   'private.revocation_access_tokens'::regclass, 'private.revocation_rate_events'::regclass, 'private.mail_workers'::regclass);
select ok(not has_table_privilege(r, t, p), r || ' sin ' || p || ' en ' || t)
  from unnest(array['anon','authenticated','service_role']) r
  cross join unnest(array['public.revocation_messages','public.revocation_message_attempts','public.revocation_message_events']) t
  cross join unnest(array['insert','update','delete','truncate']) p;
select ok(not has_table_privilege(r, t, 'select'), r || ' no lee ' || t)
  from unnest(array['anon','authenticated','service_role']) r
  cross join unnest(array['private.revocation_access_tokens','private.revocation_rate_events','private.mail_workers']) t;
select ok(not has_column_privilege('authenticated', 'public.revocation_messages', c, 'select'), 'columna de arrendamiento oculta: ' || c)
  from unnest(array['lease_id','locked_until','provider_message_id']) c;
select ok(not has_function_privilege(r, f, 'execute'), r || ' no ejecuta ' || f)
  from unnest(array['anon','authenticated']) r
  cross join unnest(array['public.comunicaciones_reclamar(text,integer,integer)','public.comunicaciones_resultado(uuid,uuid,text,text,text,text)',
    'public.estado_comunicaciones()','public.solicitar_recuperacion_arrepentimiento(text,inet)','public.canjear_constancia_arrepentimiento(text,inet)']) f;
select ok(has_function_privilege('service_role', f, 'execute'), 'servidor ejecuta ' || f)
  from unnest(array['public.comunicaciones_reclamar(text,integer,integer)','public.comunicaciones_resultado(uuid,uuid,text,text,text,text)',
    'public.estado_comunicaciones()','public.solicitar_recuperacion_arrepentimiento(text,inet)','public.canjear_constancia_arrepentimiento(text,inet)']) f;
select ok(not has_function_privilege(r, f, 'execute'), r || ' no ejecuta función administrativa ' || f)
  from unnest(array['anon','service_role']) r
  cross join unnest(array['public.admin_intervenir_comunicacion(uuid,integer,text,text)','public.admin_estado_comunicaciones()']) f;
select ok(bool_and(prosecdef and proconfig @> array['search_path=""']), 'funciones definer con ruta vacía')
  from pg_proc where pronamespace = 'public'::regnamespace and proname in ('comunicaciones_reclamar','comunicaciones_resultado','estado_comunicaciones',
    'admin_estado_comunicaciones','solicitar_recuperacion_arrepentimiento','canjear_constancia_arrepentimiento','admin_intervenir_comunicacion','registrar_arrepentimiento');
select ok(bool_and(prosrc !~* '(orders|order_items|payment|refund|stock|products)'), 'el módulo no toca pedidos, pagos, reembolsos ni stock')
  from pg_proc where proname in ('comunicaciones_reclamar','comunicaciones_resultado','admin_intervenir_comunicacion','solicitar_recuperacion_arrepentimiento',
    'canjear_constancia_arrepentimiento','fallar_comunicacion','encolar_alerta_comunicacion');
select ok(not exists(select 1 from information_schema.columns where table_schema='private' and table_name='revocation_access_tokens' and column_name ~ '^token$'),
  'el token se guarda solo como hash');

-- ---------------------------------------------------------------------------
-- Encolado duradero y único
-- ---------------------------------------------------------------------------
set local role service_role;
select lives_ok($$select public.registrar_arrepentimiento('COMMS-1','Persona@Example.test','bc710000-0000-4000-8000-000000000010','192.0.2.80')$$, 'registra solicitud');
select lives_ok($$select public.registrar_arrepentimiento('COMMS-1','Persona@Example.test','bc710000-0000-4000-8000-000000000010','192.0.2.80')$$, 'reintento idempotente');
reset role;
select is((select count(*)::int from public.revocation_messages m join public.revocation_requests r on r.id = m.request_id where r.purchase_reference = 'COMMS-1'), 1,
  'una sola constancia encolada pese al reintento');
select ok((select m.status = 'pendiente' and m.recipient = 'persona@example.test' and m.attempts = 0 from public.revocation_messages m join public.revocation_requests r on r.id = m.request_id where r.purchase_reference = 'COMMS-1'),
  'constancia pendiente al email normalizado');
select is((select count(*)::int from public.revocation_message_events e join public.revocation_messages m on m.id = e.message_id where e.action = 'encolado'), 1, 'evento de encolado');
select throws_ok($$insert into public.revocation_messages(request_id, kind, recipient) select request_id, 'constancia', 'x@y.zz' from public.revocation_messages limit 1$$,
  '23505', null, 'la base impide una segunda constancia para la misma solicitud');

-- ---------------------------------------------------------------------------
-- Reclamo, arrendamiento, fallo temporal y aceptación
-- ---------------------------------------------------------------------------
set local role service_role;
insert into claimed select * from public.comunicaciones_reclamar('pgtap-1', 10, 60);
select is((select count(*)::int from claimed), 1, 'reclama la constancia');
select ok((select payload->>'code' ~ '^ARR-[A-F0-9]{32}$' and payload ? 'received_at' and not payload ? 'purchase_reference' from claimed), 'payload mínimo: código y fecha');
select is((select count(*)::int from public.comunicaciones_reclamar('pgtap-2', 10, 60)), 0, 'otro ejecutor no la reclama mientras dura el arrendamiento');
select is(public.comunicaciones_resultado((select id from claimed), gen_random_uuid(), 'aceptado'), 'sin_cambios', 'arrendamiento ajeno no cambia nada');
select is(public.comunicaciones_resultado((select id from claimed), (select lease_id from claimed), 'error_temporal', 'smtp_421', '421 para persona@example.test'), 'reintento', 'fallo temporal programa reintento');
select is(public.comunicaciones_resultado((select id from claimed), (select lease_id from claimed), 'aceptado'), 'sin_cambios', 'resultado repetido es idempotente');
select throws_ok($$select public.comunicaciones_resultado(gen_random_uuid(), gen_random_uuid(), 'entregado')$$, '22023', null, 'no existe el resultado «entregado»');
reset role;
select ok((select status = 'pendiente' and attempts = 1 and next_attempt_at > clock_timestamp() + interval '50 seconds' and last_error_code = 'smtp_421'
                  and last_error !~ '@' and lease_id is null from public.revocation_messages where id = (select id from claimed)), 'pendiente con espera, error sin email');
select ok((select outcome = 'error_temporal' and error_detail !~ '@' and finished_at is not null from public.revocation_message_attempts where message_id = (select id from claimed) and attempt = 1),
  'intento registrado sin datos personales');
update public.revocation_messages set next_attempt_at = clock_timestamp() - interval '1 second' where id = (select id from claimed);
delete from claimed;
set local role service_role;
insert into claimed select * from public.comunicaciones_reclamar('pgtap-1', 10, 60);
select is((select attempt from claimed), 2, 'segundo intento sobre la MISMA comunicación');
select is(public.comunicaciones_resultado((select id from claimed), (select lease_id from claimed), 'aceptado', null, null, '<arr-x@steffenargentina.com.ar>'), 'aceptado', 'aceptado por el servidor');
reset role;
select ok((select status = 'aceptado' and accepted_at is not null and last_error_code is null from public.revocation_messages where id = (select id from claimed)), 'estado aceptado (no «entregado»)');
select is((select count(*)::int from public.revocation_messages where kind = 'constancia'), 1, 'los reintentos no duplicaron mensajes');
select is((select count(distinct code)::int from public.revocation_requests), 1, 'ni códigos');

-- ---------------------------------------------------------------------------
-- Fallo del ejecutor: arrendamiento vencido se recupera
-- ---------------------------------------------------------------------------
set local role service_role;
select lives_ok($$select public.registrar_arrepentimiento('COMMS-2','otra@example.test','bc710000-0000-4000-8000-000000000011','192.0.2.81')$$, 'segunda solicitud');
delete from claimed;
insert into claimed select * from public.comunicaciones_reclamar('pgtap-muere', 10, 30);
reset role;
insert into vars values ('m2', (select id::text from claimed));
update public.revocation_messages set locked_until = clock_timestamp() - interval '1 second' where id = (select value::uuid from vars where name = 'm2');
set local role service_role;
delete from claimed;
insert into claimed select * from public.comunicaciones_reclamar('pgtap-nuevo', 10, 60);
select ok((select attempt = 2 and id = (select value::uuid from vars where name = 'm2') from claimed), 'otro ejecutor recupera la comunicación del proceso caído');
reset role;
select is((select outcome from public.revocation_message_attempts where message_id = (select value::uuid from vars where name = 'm2') and attempt = 1), 'interrumpido', 'intento interrumpido registrado');
select ok(exists(select 1 from private.mail_workers where worker = 'pgtap-nuevo'), 'latido del ejecutor registrado');

-- ---------------------------------------------------------------------------
-- Fallo definitivo y alerta (una sola)
-- ---------------------------------------------------------------------------
set local role service_role;
select is(public.comunicaciones_resultado((select id from claimed), (select lease_id from claimed), 'error_permanente', 'smtp_550', '550 otra@example.test no existe'), 'fallido', 'fallo permanente');
reset role;
select is((select status from public.revocation_messages where id = (select value::uuid from vars where name = 'm2')), 'fallido', 'comunicación fallida');
select is((select count(*)::int from public.revocation_messages where kind = 'alerta' and related_message_id = (select value::uuid from vars where name = 'm2')), 1, 'alerta encolada');
select is((select recipient from public.revocation_messages where kind = 'alerta'), 'info@steffenargentina.com.ar', 'alerta al contacto institucional');
select lives_ok($$select private.encolar_alerta_comunicacion((select value::uuid from vars where name = 'm2'))$$, 'encolar de nuevo no falla');
select is((select count(*)::int from public.revocation_messages where kind = 'alerta'), 1, 'sin alertas duplicadas mientras haya una activa');
set local role service_role;
delete from claimed;
insert into claimed select * from public.comunicaciones_reclamar('pgtap-1', 10, 60);
select ok((select kind = 'alerta' and payload->>'error_code' = 'smtp_550' and payload::text !~ '@' from claimed), 'payload de alerta sin datos personales');
select is(public.comunicaciones_resultado((select id from claimed), (select lease_id from claimed), 'error_permanente', 'smtp_550'), 'fallido', 'la alerta también puede fallar');
reset role;
select is((select count(*)::int from public.revocation_messages where kind = 'alerta'), 1, 'no hay alertas sobre alertas');

-- Agotar intentos de un fallo temporal también termina en fallido.
set local role service_role;
select lives_ok($$select public.registrar_arrepentimiento('COMMS-3','tres@example.test','bc710000-0000-4000-8000-000000000012','192.0.2.82')$$, 'tercera solicitud');
reset role;
update public.revocation_messages m set max_attempts = 1 from public.revocation_requests r where r.id = m.request_id and r.purchase_reference = 'COMMS-3';
set local role service_role;
delete from claimed;
insert into claimed select * from public.comunicaciones_reclamar('pgtap-1', 10, 60);
select is(public.comunicaciones_resultado((select id from claimed where kind = 'constancia'), (select lease_id from claimed where kind = 'constancia'), 'error_temporal', 'red_etimedout'), 'fallido',
  'intentos agotados por caída del servicio');
reset role;

-- ---------------------------------------------------------------------------
-- Recuperación privada
-- ---------------------------------------------------------------------------
set local role service_role;
select is(public.solicitar_recuperacion_arrepentimiento('nadie@example.test','192.0.2.90'), '{"ok": true}'::jsonb, 'email sin solicitudes: misma respuesta');
select is(public.solicitar_recuperacion_arrepentimiento('PERSONA@example.test','192.0.2.90'), '{"ok": true}'::jsonb, 'email con solicitudes: misma respuesta');
select is(public.solicitar_recuperacion_arrepentimiento('persona@example.test','192.0.2.90'), '{"ok": true}'::jsonb, 'segundo pedido: misma respuesta');
select throws_ok($$select public.solicitar_recuperacion_arrepentimiento('mal','192.0.2.90')$$, '22023', null, 'email inválido');
reset role;
select is((select count(*)::int from public.revocation_messages where kind = 'recuperacion' and recipient = 'nadie@example.test'), 0, 'no se escribe a direcciones sin solicitudes');
select is((select count(*)::int from public.revocation_messages where kind = 'recuperacion' and recipient = 'persona@example.test'), 1, 'un solo email pendiente por dirección');
set local role service_role;
select is(public.solicitar_recuperacion_arrepentimiento('x' || g || '@example.test','192.0.2.90'), case when g <= 2 then '{"ok": true}'::jsonb else '{"limited": true}'::jsonb end,
  'límite por IP (' || g || ')') from generate_series(1, 3) g;
select is(public.solicitar_recuperacion_arrepentimiento('persona@example.test','192.0.2.91'), '{"ok": true}'::jsonb, 'otra IP no está limitada');
delete from claimed;
insert into claimed select * from public.comunicaciones_reclamar('pgtap-1', 10, 60);
select ok((select payload->>'token' ~ '^[A-Za-z0-9_-]{43}$' from claimed where kind = 'recuperacion'), 'token de 32 bytes en base64url');
insert into vars values ('t1', (select payload->>'token' from claimed where kind = 'recuperacion'));
reset role;
select ok((select t.token_hash = extensions.digest((select value from vars where name = 't1'), 'sha256') and t.expires_at <= clock_timestamp() + interval '30 minutes'
            from private.revocation_access_tokens t), 'se guarda solo el hash; vence en 30 minutos');
set local role service_role;
select is(public.comunicaciones_resultado((select id from claimed where kind = 'recuperacion'), (select lease_id from claimed where kind = 'recuperacion'), 'aceptado'), 'aceptado', 'enlace aceptado');
select is(public.canjear_constancia_arrepentimiento((select value from vars where name = 't1'), '192.0.2.92')->'items'->0->>'code',
  public.registrar_arrepentimiento('COMMS-1','persona@example.test','bc710000-0000-4000-8000-000000000010','192.0.2.80')->>'code',
  'el canje muestra la constancia original (mismo código)');
select is(public.canjear_constancia_arrepentimiento((select value from vars where name = 't1'), '192.0.2.92'), '{"invalid": true}'::jsonb, 'un solo uso');
select is(public.canjear_constancia_arrepentimiento('A' || repeat('b', 42), '192.0.2.92'), '{"invalid": true}'::jsonb, 'token inexistente');
select is(public.canjear_constancia_arrepentimiento('corto', '192.0.2.92'), '{"invalid": true}'::jsonb, 'formato inválido');
reset role;
select ok(not exists(select 1 from pg_proc where proname = 'canjear_constancia_arrepentimiento' and prosrc ~ '(purchase_reference|contact_email''|ip_hash,)'), 'el canje no devuelve referencia ni contacto');

-- Vencimiento y revocación de tokens.
update public.revocation_messages set created_at = clock_timestamp() - interval '2 hours' where kind = 'recuperacion';
set local role service_role;
select is(public.solicitar_recuperacion_arrepentimiento('persona@example.test','192.0.2.93'), '{"ok": true}'::jsonb, 'nuevo pedido');
delete from claimed;
insert into claimed select * from public.comunicaciones_reclamar('pgtap-1', 10, 60);
insert into vars values ('t2', (select payload->>'token' from claimed where kind = 'recuperacion'));
select is(public.comunicaciones_resultado((select id from claimed where kind = 'recuperacion'), (select lease_id from claimed where kind = 'recuperacion'), 'aceptado'), 'aceptado', 'segundo enlace aceptado');
reset role;
update private.revocation_access_tokens set expires_at = clock_timestamp() - interval '1 second' where token_hash = extensions.digest((select value from vars where name = 't2'), 'sha256');
set local role service_role;
select is(public.canjear_constancia_arrepentimiento((select value from vars where name = 't2'), '192.0.2.94'), '{"invalid": true}'::jsonb, 'token vencido');
reset role;
-- Un fallo temporal revoca el token emitido para ese intento.
update public.revocation_messages set created_at = clock_timestamp() - interval '2 hours' where kind = 'recuperacion';
set local role service_role;
select is(public.solicitar_recuperacion_arrepentimiento('persona@example.test','192.0.2.95'), '{"ok": true}'::jsonb, 'tercer pedido');
delete from claimed;
insert into claimed select * from public.comunicaciones_reclamar('pgtap-1', 10, 60);
insert into vars values ('t3', (select payload->>'token' from claimed where kind = 'recuperacion'));
select is(public.comunicaciones_resultado((select id from claimed where kind = 'recuperacion'), (select lease_id from claimed where kind = 'recuperacion'), 'error_temporal', 'smtp_421'), 'reintento', 'falla el envío');
select is(public.canjear_constancia_arrepentimiento((select value from vars where name = 't3'), '192.0.2.96'), '{"invalid": true}'::jsonb, 'token de un envío fallido no sirve');
-- Límite de canjes por IP.
select is(public.canjear_constancia_arrepentimiento('A' || repeat('c', 42), '192.0.2.97') ? 'limited', g > 20, 'límite de canje por IP (' || g || ')') from generate_series(1, 21) g;
reset role;
-- Recuperación pendiente de más de 24 h se vence sin enviarse.
update public.revocation_messages set created_at = clock_timestamp() - interval '25 hours', next_attempt_at = clock_timestamp() - interval '1 minute' where kind = 'recuperacion' and status = 'pendiente';
set local role service_role;
delete from claimed;
insert into claimed select * from public.comunicaciones_reclamar('pgtap-1', 10, 60);
select is((select count(*)::int from claimed where kind = 'recuperacion'), 0, 'no se envía un enlace viejo');
reset role;
select ok(exists(select 1 from public.revocation_messages where kind = 'recuperacion' and status = 'vencido'), 'queda vencido');

-- ---------------------------------------------------------------------------
-- Estado e intervención administrativa
-- ---------------------------------------------------------------------------
set local role service_role;
select ok((select (s->>'fallidas')::int >= 2 and s ? 'ultimo_ejecutor' and s::text !~ '@' from public.estado_comunicaciones() s), 'estado sin datos personales');
reset role;
select set_config('request.jwt.claim.sub','bc710000-0000-4000-8000-000000000099',true);
set local role authenticated;
select is((select count(*)::int from public.revocation_messages), 0, 'no administrador no ve comunicaciones');
select throws_ok($$select public.admin_estado_comunicaciones()$$, '42501', null, 'no administrador no ve el estado');
select throws_ok($$select public.admin_intervenir_comunicacion(gen_random_uuid(), 0, 'reintento_manual', null)$$, '42501', null, 'no administrador no interviene');
reset role;
select set_config('request.jwt.claim.sub','bc710000-0000-4000-8000-000000000001',true);
set local role authenticated;
select ok((select count(*)::int from public.revocation_messages) > 0, 'administrador ve comunicaciones');
select lives_ok($$select public.admin_estado_comunicaciones()$$, 'administrador ve el estado');
select throws_ok($$select token_hash from private.revocation_access_tokens$$, '42501', null, 'ni el administrador lee tokens');
insert into vars values ('v', (select version::text from public.revocation_messages where id = (select value::uuid from vars where name = 'm2')));
select throws_ok($$select public.admin_intervenir_comunicacion((select value::uuid from vars where name = 'm2'), -1, 'reintento_manual', null)$$, 'SR004', null, 'versión vieja');
select throws_ok($$select public.admin_intervenir_comunicacion((select value::uuid from vars where name = 'm2'), (select value::int from vars where name = 'v'), 'rebote_manual', null)$$, '22023', null, 'rebote solo desde aceptado');
select throws_ok($$select public.admin_intervenir_comunicacion((select value::uuid from vars where name = 'm2'), (select value::int from vars where name = 'v'), 'resuelto_manual', '')$$, '22023', null, 'resolver exige nota');
select throws_ok($$select public.admin_intervenir_comunicacion((select value::uuid from vars where name = 'm2'), (select value::int from vars where name = 'v'), 'pagar', null)$$, '22023', null, 'acción desconocida');
select lives_ok($$select public.admin_intervenir_comunicacion((select value::uuid from vars where name = 'm2'), (select value::int from vars where name = 'v'), 'reintento_manual', 'Reintento tras corregir configuración')$$, 'reintento manual');
select ok((select status = 'pendiente' and max_attempts = attempts + 3 from public.revocation_messages where id = (select value::uuid from vars where name = 'm2')), 'misma comunicación vuelve a la cola con más intentos');
select ok((select actor_id = 'bc710000-0000-4000-8000-000000000001' and note = 'Reintento tras corregir configuración' and from_status = 'fallido' and to_status = 'pendiente'
             from public.revocation_message_events where message_id = (select value::uuid from vars where name = 'm2') and action = 'reintento_manual'), 'acción auditada con administrador y nota');
select lives_ok($$select public.admin_intervenir_comunicacion((select value::uuid from vars where name = 'm2'), (select value::int + 1 from vars where name = 'v'), 'resuelto_manual', 'Código comunicado por WhatsApp')$$, 'resuelto por otro canal');
select is((select count(*)::int from public.revocation_messages where kind = 'constancia' and request_id = (select request_id from public.revocation_messages where id = (select value::uuid from vars where name = 'm2'))), 1,
  'la intervención no duplica mensajes');
select is((select count(*)::int from public.revocation_requests where status <> 'recibida'), 0, 'intervenir comunicaciones no cambia el estado de la solicitud');
reset role;

select * from finish();
rollback;
