begin;
create extension if not exists pgtap with schema extensions;
select no_plan();
insert into auth.users(id,email) values ('ad000000-0000-4000-8000-000000000001','posventa@test.local');
insert into public.admin_users(user_id) values ('ad000000-0000-4000-8000-000000000001');
select set_config('request.jwt.claim.sub','ad000000-0000-4000-8000-000000000001',true);
insert into public.categories(id,name,slug) values ('ad000000-0000-4000-8000-000000000002','Posventa','posventa');
insert into public.products(id,sku,name,slug,category_id,price_ars,stock) values
 ('ad000000-0000-4000-8000-000000000003','POSVENTA','Posventa','posventa','ad000000-0000-4000-8000-000000000002',2000.10,30);
insert into public.shipping_zones(id,name,price_ars) values ('ad000000-0000-4000-8000-000000000004','Posventa',1500.21);
insert into public.shipping_zone_provinces(zone_id,province_code) values ('ad000000-0000-4000-8000-000000000004','AR-C');
update public.store_settings set checkout_enabled=true;
create temp table fixtures(n int,o jsonb,c jsonb,remote text);
do $$ declare j jsonb; c jsonb; r text; begin
 for i in 1..5 loop
  j:=public.crear_pedido('posventa-'||i||repeat('a',30),
   jsonb_build_object('name','Comprador Test','email','posventa-'||i||'@test.local','phone','+54 11 5555-0000'),
   '{"street":"Av. Siempre Viva","number":"742","city":"Ciudad","postal_code":"C1000AAA","province_code":"AR-C"}',
   '[{"product_id":"ad000000-0000-4000-8000-000000000003","quantity":2}]',5500.41,'198.51.100.29');
  c:=public.iniciar_intento_pago(j->>'code',j->>'token','198.51.100.29');
  r:=public.simular_order_pago((c->>'key')::uuid,(c->>'lease')::uuid,c->>'reference',c->>'total');
  perform public.finalizar_intento_pago((c->>'id')::uuid,(c->>'lease')::uuid,r,null);
  if i<=4 then
  update private.mock_checkout_orders set status='processed',status_detail='accredited',paid_amount=total_ars,
   payment_id='PAYMOCK'||replace(gen_random_uuid()::text,'-',''),revision=2 where id=r;
  perform private.aplicar_pago((j->>'order_id')::uuid,'local:'||(select payment_id from private.mock_checkout_orders where id=r),'approved',5500.41);
  end if;
  insert into fixtures values(i,j,c,r);
 end loop;
end $$;
create function pg_temp.oid(n int) returns uuid language sql as $$ select (o->>'order_id')::uuid from fixtures where fixtures.n=$1 $$;
create function pg_temp.payment(n int) returns text language sql as $$ select m.payment_id from fixtures f join private.mock_checkout_orders m on m.id=f.remote where f.n=$1 $$;
create function pg_temp.request(n int,k text,amount bigint,expected bigint) returns uuid language sql as $$
 select public.admin_solicitar_reembolso(pg_temp.oid(n),gen_random_uuid(),k,case when k='partial' then pg_temp.payment(n) end,amount,expected,'Motivo de prueba',true,true) $$;
create temp table work(id uuid,j jsonb,old jsonb);
insert into work(id) select pg_temp.request(1,'partial',100001,0);
update work set j=public.admin_tomar_reembolso(pg_temp.oid(1),id,true);
create function pg_temp.send() returns text language sql as $$
 select public.simular_reembolso_posventa(id,(j->>'key')::uuid,(j->>'lease')::uuid,
  case when j->>'kind'='partial' then jsonb_build_object('transactions',jsonb_build_array(jsonb_build_object('id',j->>'payment','amount',((j->>'cents')::numeric/100)::numeric(12,2)::text))) end) from work $$;
create function pg_temp.resolve() returns text language sql as $$ select public.resolver_reembolso_posventa(id,(j->>'lease')::uuid,null) from work $$;
select is(pg_temp.send(),'confirmed','parcial confirmado en proveedor');
select is(pg_temp.send(),'confirmed','mismo idempotency key no repite');
select is((select count(*) from private.mock_refunds),1::bigint,'un movimiento remoto');
select is(public.admin_solicitar_reembolso(pg_temp.oid(1),(select request_key from private.refund_requests where id=(select id from work)),
 'partial',pg_temp.payment(1),100001,0,'Motivo de prueba',true,true),(select id from work),'doble clic devuelve misma intención');
select throws_ok($$select public.admin_solicitar_reembolso(gen_random_uuid(),gen_random_uuid(),'full',null,null,0,'Motivo de prueba',true,true)$$,
 '55000',null,'pedido inexistente');
select throws_ok($$select public.admin_solicitar_reembolso(pg_temp.oid(1),gen_random_uuid(),'full',null,null,0,'Motivo de prueba',false,true)$$,
 '22023',null,'confirmación explícita obligatoria');
select is((select state from private.refund_requests where id=(select id from work)),'processing','enviar no confirma localmente');
select is(pg_temp.resolve(),'confirmed','consulta evidencia y confirma');
select is(pg_temp.resolve(),'confirmed','resolver idempotente');
select is((select stock from public.products where sku='POSVENTA'),20,'reembolsar no aumenta stock');
select throws_ok($$select pg_temp.request(5,'full',null,0)$$,'55000',null,'pedido no acreditado no admite reintegro');
select is((public.admin_ver_posventa(pg_temp.oid(1))->>'balance')::bigint,450040::bigint,'saldo exacto con envío');
select throws_ok($$select pg_temp.request(1,'partial',450041,100001)$$,'55000',null,'no supera saldo');
select throws_ok($$select pg_temp.request(1,'full',null,0)$$,'55000',null,'saldo del navegador obsoleto');
delete from work;
insert into work(id) select pg_temp.request(1,'partial',100000,100001);
update work set j=public.admin_tomar_reembolso(pg_temp.oid(1),id,true);
select is(pg_temp.send(),'confirmed','segundo parcial');
select is(pg_temp.resolve(),'confirmed','confirma segundo parcial');
delete from work;
insert into work(id) select pg_temp.request(1,'full',null,200001);
update work set j=public.admin_tomar_reembolso(pg_temp.oid(1),id,true);
select is((select (j->>'cents')::bigint from work),350040::bigint,'total después de parciales usa saldo restante');
select is(pg_temp.send(),'confirmed','total sin body');
select is(pg_temp.resolve(),'confirmed','total confirmado');
select is((public.admin_ver_posventa(pg_temp.oid(1))->>'balance')::bigint,0::bigint,'saldo agotado');
select throws_ok($$select pg_temp.request(1,'full',null,550041)$$,'55000',null,'no permite un segundo total');
select is((select payment_status from public.orders where id=pg_temp.oid(1)),'approved','acreditación histórica intacta');
delete from work;
insert into work(id) select pg_temp.request(2,'full',null,0);
update work set j=public.admin_tomar_reembolso(pg_temp.oid(2),id,true);
select throws_ok($$select pg_temp.request(2,'partial',1,0)$$,'55000',null,'intención incompatible bloqueada');
update work set old=j;
update private.refund_requests set lease_until=clock_timestamp()-interval '1 second' where id=(select id from work);
update work set j=public.admin_tomar_reembolso(pg_temp.oid(2),id,true);
select isnt((select old->>'lease' from work),(select j->>'lease' from work),'fencing cambia concesión');
select is((select public.simular_reembolso_posventa(id,(old->>'key')::uuid,(old->>'lease')::uuid,null) from work),'stale','worker viejo no envía');
select is((select public.resolver_reembolso_posventa(id,(old->>'lease')::uuid,'network') from work),'stale','worker viejo no finaliza');
select is((select old->>'key' from work),(select j->>'key' from work),'misma clave tras reinicio');
select is(pg_temp.send(),'confirmed','proveedor confirma antes de fallo local');
select lives_ok($$select private.observe_after_sales(pg_temp.oid(2))$$,'webhook antes de persistir respuesta recupera evidencia');
select is(pg_temp.resolve(),'confirmed','respuesta tardía no duplica');
select is((select count(*) from private.observed_refunds where order_id=pg_temp.oid(2)),1::bigint,'una confirmación');
delete from work;
insert into work(id) select pg_temp.request(3,'full',null,0);
update work set j=public.admin_tomar_reembolso(pg_temp.oid(3),id,true);
update private.refund_requests set lease_until=clock_timestamp()-interval '1 second' where id=(select id from work);
select lives_ok($$select private.observe_after_sales(pg_temp.oid(3))$$,'polling recupera caída antes del envío');
select is((select state from private.refund_requests where id=(select id from work)),'unknown','concesión expirada visible como resultado desconocido');
update work set old=j,j=public.admin_tomar_reembolso(pg_temp.oid(3),id,true);
select is((select old->>'key' from work),(select j->>'key' from work),'caída conserva clave original');
select is((select public.resolver_reembolso_posventa(id,(j->>'lease')::uuid,'conflict') from work),'unknown','409 queda ambiguo');
select throws_ok($$select pg_temp.request(3,'full',null,0)$$,'55000',null,'ambiguo bloquea clave nueva');
update work set j=public.admin_tomar_reembolso(pg_temp.oid(3),id,true);
update private.mock_checkout_orders set refund_balance_cents=0 where id=(select remote from fixtures where n=3);
select is(pg_temp.send(),'rejected','saldo vendedor insuficiente');
select is(pg_temp.resolve(),'rejected','rechazo observado');
select throws_ok($$select public.admin_solicitar_reembolso(pg_temp.oid(4),gen_random_uuid(),'partial','PAYMOCK'||repeat('f',32),1,0,'Motivo de prueba',true,true)$$,
 '55000',null,'transacción inexistente rechazada');
insert into private.mock_refunds(provider_order_id,payment_id,cents,outcome)
 select remote,pg_temp.payment(4),100,'confirmed' from fixtures where n=4;
select lives_ok($$select private.observe_after_sales(pg_temp.oid(4))$$,'descubre reembolso externo');
select is((select count(*) from private.observed_refunds where order_id=pg_temp.oid(4) and request_id is null),1::bigint,'sin inventar solicitud administrativa');
insert into private.mock_chargebacks(provider_order_id,payment_id,cents,status,documentation,deadline)
 select remote,pg_temp.payment(4),550041,'open','pending',now()+interval '1 day' from fixtures where n=4;
select lives_ok($$select private.observe_after_sales(pg_temp.oid(4))$$,'contracargo consultado');
select is(jsonb_array_length(public.admin_disputas_abiertas()),1,'alerta de disputa abierta');
select throws_ok($$select pg_temp.request(4,'partial',100,100)$$,'55000',null,'no duplica devolución bajo disputa');
select ok(exists(select 1 from private.after_sales_events where kind='refund_chargeback_overlap'),'solapamiento visible');
update private.mock_chargebacks set status='won',documentation='valid',revision=2;
select lives_ok($$select private.observe_after_sales(pg_temp.oid(4))$$,'disputa ganada');
update private.mock_chargebacks set status='open',revision=1;
select lives_ok($$select private.observe_after_sales(pg_temp.oid(4))$$,'evento antiguo no reabre');
select is((select status from private.chargeback_cases),'won','no degrada caso resuelto');
update private.mock_chargebacks set seller='otra-cuenta',revision=3,status='lost',impact_cents=550041;
select lives_ok($$select private.observe_after_sales(pg_temp.oid(4))$$,'vendedor incorrecto queda como incidencia');
select is((select status from private.chargeback_cases),'won','otra cuenta no cambia impacto financiero');
select ok(exists(select 1 from private.after_sales_events where kind='chargeback_evidence_mismatch'),'alerta de identidad persistida');
update private.mock_chargebacks set seller='local-simulator',cents=550040,impact_cents=550040;
select lives_ok($$select private.observe_after_sales(pg_temp.oid(4))$$,'importe distinto no reemplaza evidencia');
select is((select cents from private.chargeback_cases),550041::bigint,'importe original conservado');
update private.mock_chargebacks set cents=550041,impact_cents=550041;
select lives_ok($$select private.observe_after_sales(pg_temp.oid(4))$$,'disputa perdida confirmada');
select is((select impact_cents from private.chargeback_cases),550041::bigint,'impacto registrado separado del reintegro');
select ok(not has_table_privilege('authenticated','private.refund_requests','select') and not has_table_privilege('anon','private.chargeback_cases','select'),'tablas privadas');
select ok(not has_function_privilege('authenticated','public.simular_reembolso_posventa(uuid,uuid,uuid,jsonb)','execute')
 and not has_function_privilege('anon','public.admin_ver_posventa(uuid)','execute'),'permisos financieros mínimos');
select ok((select bool_and(relrowsecurity) from pg_class where oid in ('private.refund_requests'::regclass,'private.mock_refunds'::regclass,'private.physical_returns'::regclass,'private.chargeback_cases'::regclass)),'RLS');
select lives_ok($$select public.admin_operar_pedido(pg_temp.oid(1),(select admin_version from public.orders where id=pg_temp.oid(1)),'preparing')$$,'reembolso no retrocede preparación');
select lives_ok($$select public.admin_operar_pedido(pg_temp.oid(1),(select admin_version from public.orders where id=pg_temp.oid(1)),'shipped',null,'Transporte','ABC',now())$$,'despacho independiente');
create temp table physical(id uuid);
insert into physical values(gen_random_uuid());
create function pg_temp.physical(action text,suitable int default null,condition text default null) returns uuid language sql as $$
 select public.admin_devolucion_fisica(pg_temp.oid(1),(select id from physical),
 (select id from public.order_items where order_id=pg_temp.oid(1)),action,1,'Devolución parcial',suitable,condition,'Inspección local') $$;
select lives_ok($$select pg_temp.physical('request')$$,'devolución parcial solicitada');
select lives_ok($$select pg_temp.physical('request')$$,'solicitud física idempotente');
select throws_ok($$select public.admin_devolucion_fisica(pg_temp.oid(1),gen_random_uuid(),(select id from public.order_items where order_id=pg_temp.oid(1)),'request',2,'Demasiadas unidades',null,null,null)$$,'22023',null,'cantidad acumulada no supera vendida');
select throws_ok($$select pg_temp.physical('inspect',1,'sealed')$$,'55000',null,'no inspecciona sin recepción');
select lives_ok($$select pg_temp.physical('coordinate')$$,'coordinación');
select lives_ok($$select pg_temp.physical('receive')$$,'recepción');
select throws_ok($$select pg_temp.physical('inspect',1,'used')$$,'22023',null,'usado no es apto');
select lives_ok($$select pg_temp.physical('inspect',1,'sealed')$$,'inspección sellado apto');
select lives_ok($$select pg_temp.physical('resolve')$$,'resolución física');
select lives_ok($$select pg_temp.physical('resolve')$$,'resolución repetida');
select is((select stock from public.products where sku='POSVENTA'),20,'recibir e inspeccionar no reincorpora inventario');
select is((select fulfillment_status from public.orders where id=pg_temp.oid(1)),'shipped','despacho intacto tras devolución');
create temp table poll as select public.tomar_posventa_simulada() as j,(select count(*) from private.mock_refunds) as before_count;
select is(public.resolver_posventa_simulada((j->>'order')::uuid,gen_random_uuid()),'stale','polling respeta fencing') from poll;
select is(public.resolver_posventa_simulada((j->>'order')::uuid,(j->>'lease')::uuid),'observed','polling concilia sin webhook') from poll;
select is((select count(*) from private.mock_refunds),(select before_count from poll),'polling jamás envía reembolso');
select is(public.resolver_posventa_simulada(pg_temp.oid(4),null),'stale','concesión nula nunca autoriza procesamiento');
create function pg_temp.fail_observation() returns trigger language plpgsql as $$ begin raise exception 'fixture PostgreSQL unavailable'; end $$;
create trigger fail_observation before insert on private.observed_refunds for each row execute function pg_temp.fail_observation();
update private.after_sales_polls set next_at=clock_timestamp()-interval '1 day',failures=9 where order_id=pg_temp.oid(4);
update poll set j=public.tomar_posventa_simulada();
select is(public.resolver_posventa_simulada((j->>'order')::uuid,(j->>'lease')::uuid),'observation_failed','fallo de persistencia clasificado') from poll;
select ok((select failures=10 and next_at>clock_timestamp() and error='observation_failed' and lease is null
 from private.after_sales_polls where order_id=pg_temp.oid(4)),'diez fallos conservan trabajo con backoff');
select is((public.estado_posventa_simulada()->>'degraded')::int,1,'degradación observable sin perder operación');
drop trigger fail_observation on private.observed_refunds;
update private.after_sales_polls set next_at=clock_timestamp()-interval '1 day' where order_id=pg_temp.oid(4);
update poll set j=public.tomar_posventa_simulada();
select is(public.resolver_posventa_simulada((j->>'order')::uuid,(j->>'lease')::uuid),'observed','se recupera después del fallo PostgreSQL') from poll;
update private.mock_checkout_orders set external_reference='STF-2611-AAAA' where id=(select remote from fixtures where n=4);
select lives_ok($$select private.observe_after_sales(pg_temp.oid(4))$$,'evidencia de order alterada no se usa');
select ok(exists(select 1 from private.after_sales_events where order_id=pg_temp.oid(4) and kind='after_sales_evidence_mismatch'),'identidad inconsistente queda visible');
select is((public.admin_ver_posventa(pg_temp.oid(4))->>'paid')::bigint,550041::bigint,'no borra importe históricamente acreditado');
select is(public.admin_ver_posventa(pg_temp.oid(4))->>'blocked','true','evidencia alterada bloquea nuevos envíos');
insert into private.after_sales_events(order_id,subject,kind)
 select pg_temp.oid(4),gen_random_uuid(),'fixture_note' from generate_series(1,101);
select ok(exists(select 1 from jsonb_array_elements(public.admin_ver_posventa(pg_temp.oid(4))->'events') e
 where e->>'kind'='after_sales_evidence_mismatch'),'incidencias siguen visibles después de cien eventos');
select set_config('request.jwt.claim.sub','ad000000-0000-4000-8000-000000000009',true);
select throws_ok($$select public.admin_ver_posventa(pg_temp.oid(1))$$,'42501',null,'usuario no admin rechazado');
select * from finish();
rollback;
