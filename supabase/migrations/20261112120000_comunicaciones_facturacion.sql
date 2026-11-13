-- Fase 5E local: amplía la única cola 4B.7. No SMTP, ARCA, cron ni cambios financieros.
alter table public.revocation_messages drop constraint revocation_messages_kind_check;
alter table public.revocation_messages add constraint revocation_messages_kind_check check
 (kind in ('constancia','recuperacion','alerta','pedido_recibido','pago_confirmado','pedido_despachado','recuperacion_pedido'));
alter table public.revocation_messages add column order_id uuid references public.orders(id) on delete cascade;
alter table public.revocation_messages add column business_key text unique;
alter table public.revocation_messages add constraint order_message_binding check
 (kind not in ('pedido_recibido','pago_confirmado','pedido_despachado','recuperacion_pedido') or order_id is not null);
create index order_messages_order on public.revocation_messages(order_id,created_at);
create unique index order_recovery_active on public.revocation_messages(order_id)
 where kind='recuperacion_pedido' and status in ('pendiente','enviando');

create table private.order_message_data (
 message_id uuid primary key references public.revocation_messages(id) on delete cascade,
 payload jsonb not null default '{}', revision integer not null default 0
);
create table private.order_access_tokens (
 id uuid primary key default gen_random_uuid(), order_id uuid not null references public.orders(id) on delete cascade,
 message_id uuid references public.revocation_messages(id) on delete cascade,
 token_hash bytea not null unique check(octet_length(token_hash)=32),
 kind text not null check(kind in ('recovery','session')),created_at timestamptz not null default clock_timestamp(),
 expires_at timestamptz not null,used_at timestamptz
);
create index order_access_expiration on private.order_access_tokens(expires_at);
create table private.order_access_events (
 id bigint generated always as identity primary key,kind text not null check(kind in ('request','exchange','lookup')),
 ip_hash bytea not null,order_id uuid references public.orders(id) on delete cascade,
 success boolean not null default false,created_at timestamptz not null default clock_timestamp()
);
create index order_access_rate on private.order_access_events(kind,ip_hash,created_at);
create table private.order_invoices (
 order_id uuid primary key references public.orders(id) on delete cascade,
 type text not null default 'C' check(type='C'),pos text not null check(pos ~ '^[0-9]{5}$' and pos<>'00000'),
 number text not null check(number ~ '^[0-9]{8}$' and number<>'00000000'),
 issued_on date not null,cents bigint not null check(cents between 1 and 999999999999),currency text not null default 'ARS' check(currency='ARS'),
 registered_at timestamptz not null default clock_timestamp(),admin_id uuid not null,
 notes text check(char_length(notes)<=500),version integer not null default 0,
 send_status text not null default 'pending' check(send_status in ('pending','sent','failed')),
 sent_at timestamptz,recipient text,sent_admin uuid,
 unique(type,pos,number),check(send_status<>'sent' or (sent_at is not null and recipient is not null and sent_admin is not null))
);
create table private.order_office_events (
 id bigint generated always as identity primary key,order_id uuid not null references public.orders(id) on delete cascade,
 actor uuid not null,kind text not null,created_at timestamptz not null default clock_timestamp(),
 note text not null check(char_length(note) between 5 and 500),before_data jsonb,after_data jsonb
);
create index order_office_history on private.order_office_events(order_id,created_at);
alter table private.order_message_data enable row level security;
alter table private.order_access_tokens enable row level security;
alter table private.order_access_events enable row level security;
alter table private.order_invoices enable row level security;
alter table private.order_office_events enable row level security;
revoke all on private.order_message_data,private.order_access_tokens,private.order_access_events,
 private.order_invoices,private.order_office_events from public,anon,authenticated,service_role;
revoke all on sequence private.order_access_events_id_seq,private.order_office_events_id_seq from public,anon,authenticated,service_role;

create function private.order_mail_snapshot(p_order uuid) returns jsonb language sql stable set search_path='' as $$
 select jsonb_build_object('code',o.code,'created_at',o.created_at,'payment_status',o.payment_status,
 'subtotal_cents',(o.subtotal_ars*100)::bigint,'shipping_cents',(o.shipping_ars*100)::bigint,'total_cents',(o.total_ars*100)::bigint,
 'items',(select jsonb_agg(jsonb_build_object('name',i.name,'quantity',i.quantity,'unit_cents',(i.unit_price_ars*100)::bigint,
 'line_cents',(i.line_total_ars*100)::bigint) order by i.id) from public.order_items i where i.order_id=o.id))
 from public.orders o where o.id=p_order
$$;
create function private.enqueue_order_mail(p_order uuid,p_kind text,p_key text,p_data jsonb default '{}') returns uuid
language plpgsql set search_path='' as $$
declare mid uuid;
begin
 insert into public.revocation_messages(order_id,kind,recipient,business_key)
 select id,p_kind,buyer_email,p_key from public.orders where id=p_order on conflict do nothing returning id into mid;
 if mid is not null then
  insert into private.order_message_data(message_id,payload) values(mid,p_data);
  insert into public.revocation_message_events(message_id,action,to_status) values(mid,'encolado','pendiente');
 end if;
 return mid;
end $$;
create function private.enqueue_order_event_mail() returns trigger language plpgsql set search_path='' as $$
begin
 if new.event_type='created' then
  perform private.enqueue_order_mail(new.order_id,'pedido_recibido','received:'||new.order_id,private.order_mail_snapshot(new.order_id));
 elsif new.event_type in ('payment_approved','payment_approved_late') then
  perform private.enqueue_order_mail(new.order_id,'pago_confirmado','paid:'||new.order_id,private.order_mail_snapshot(new.order_id));
 elsif new.event_type='fulfillment_changed' and new.data->>'to'='shipped' then
  perform private.enqueue_order_mail(new.order_id,'pedido_despachado','dispatch:'||new.order_id);
 end if;
 return new;
end $$;
create trigger enqueue_order_event_mail after insert on public.order_events for each row execute function private.enqueue_order_event_mail();

create function private.prepare_order_mail(m public.revocation_messages) returns jsonb language plpgsql set search_path='' as $$
declare o public.orders; v_payload jsonb; token text;
begin
 select * into o from public.orders where id=m.order_id;
 select d.payload into v_payload from private.order_message_data d where d.message_id=m.id;
 if m.kind='recuperacion_pedido' then
  token:=translate(rtrim(encode(extensions.gen_random_bytes(32),'base64'),'='),'+/','-_');
  insert into private.order_access_tokens(order_id,message_id,token_hash,kind,expires_at)
   values(o.id,m.id,extensions.digest(token,'sha256'),'recovery',clock_timestamp()+interval '15 minutes');
  return jsonb_build_object('code',o.code,'token',token,'expires_minutes',15);
 end if;
 if m.kind='pago_confirmado' then
  v_payload:=v_payload||jsonb_build_object('needs_attention',o.resolution_status='pending' or o.stock_state<>'consumed'
    or exists(select 1 from private.observed_refunds where order_id=o.id)
    or exists(select 1 from private.chargeback_cases where order_id=o.id and status in ('open','lost')));
 elsif m.kind='pedido_despachado' then
  if o.fulfillment_status not in ('shipped','delivered') then return null; end if;
  if not (v_payload ? 'dispatched_at') then
   v_payload:=jsonb_build_object('code',o.code,'carrier',o.dispatch_carrier,'tracking',o.dispatch_tracking,
     'dispatched_at',o.dispatched_at,'correction',coalesce((v_payload->>'correction')::boolean,false));
   update private.order_message_data set payload=v_payload where message_id=m.id;
  end if;
 end if;
 return v_payload;
end $$;

-- La implementación de reclamo/resultado 4B.7 se amplía debajo, conservando firma y wrapper legacy.
-- CORE_GENERADO_5E
create or replace function private.encolar_alerta_comunicacion(p_message_id uuid) returns void language plpgsql volatile set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.revocation_messages(kind, recipient, related_message_id, request_id,order_id)
    select 'alerta', private.revocation_alert_recipient(), m.id, m.request_id,m.order_id
    from public.revocation_messages m where m.id = p_message_id and m.kind in ('constancia','pedido_recibido','pago_confirmado','pedido_despachado')
  on conflict do nothing
  returning id into v_id;
  if v_id is not null then
    insert into public.revocation_message_events(message_id, action, to_status) values (v_id, 'encolado', 'pendiente');
  end if;
end;
$$;

create function private.reclamar_comunicaciones(p_worker text, p_limit integer, p_lease_seconds integer, p_tienda boolean)
returns table (id uuid, lease_id uuid, kind text, recipient text, attempt integer, payload jsonb)
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_msg public.revocation_messages%rowtype;
  v_lease uuid;
  v_token text;
  v_payload jsonb;
  v_now timestamptz := clock_timestamp();
begin
  if p_worker is null or p_worker !~ '^[A-Za-z0-9._:-]{1,80}$' or p_limit is null or p_limit not between 1 and 50
     or p_lease_seconds is null or p_lease_seconds not between 30 and 900 then
    raise exception 'Parámetros no válidos' using errcode = '22023';
  end if;
  insert into private.mail_workers(worker, last_seen_at) values (p_worker, v_now)
    on conflict (worker) do update set last_seen_at = excluded.last_seen_at;

  -- Higiene técnica (no son plazos de conservación de datos personales).
  delete from private.revocation_access_tokens t where t.expires_at < v_now - interval '1 day';
  delete from private.revocation_rate_events r where r.created_at < v_now - interval '1 day';
  delete from private.mail_workers w where w.last_seen_at < v_now - interval '30 days';

  -- Un email de recuperación que no salió en 24 h ya no sirve: se vence (sin alerta).
  with expired as (
    update public.revocation_messages m set status = 'vencido', lease_id = null, locked_until = null, version = m.version + 1, updated_at = v_now
     where m.kind in ('recuperacion','recuperacion_pedido') and m.created_at < v_now - interval '24 hours'
       and (m.status = 'pendiente' or (m.status = 'enviando' and m.locked_until < v_now))
    returning m.id
  ) insert into public.revocation_message_events(message_id, action, to_status) select e.id, 'vencido', 'vencido' from expired e;

  for v_msg in
    select m.* from public.revocation_messages m
     where ((m.status = 'pendiente' and m.next_attempt_at <= v_now) or (m.status = 'enviando' and m.locked_until < v_now))
       and (p_tienda or (m.order_id is null and m.kind not in ('pedido_recibido','pago_confirmado','pedido_despachado','recuperacion_pedido')))
     order by m.next_attempt_at, m.created_at
     limit p_limit
     for update skip locked
  loop
    if v_msg.status = 'enviando' then
      update public.revocation_message_attempts a set finished_at = v_now, outcome = 'interrumpido', error_code = 'arrendamiento_vencido'
       where a.message_id = v_msg.id and a.outcome is null;
      insert into public.revocation_message_events(message_id, action, from_status, to_status) values (v_msg.id, 'interrumpido', 'enviando', 'pendiente');
      update private.revocation_access_tokens t set revoked_at = v_now where t.message_id = v_msg.id and t.used_at is null and t.revoked_at is null;
    end if;
    if v_msg.attempts >= v_msg.max_attempts then
      perform private.fallar_comunicacion(v_msg.id, v_msg.status);
      continue;
    end if;

    v_lease := gen_random_uuid();
    update public.revocation_messages m
       set status = 'enviando', lease_id = v_lease, locked_until = v_now + make_interval(secs => p_lease_seconds),
           attempts = m.attempts + 1, last_attempt_at = v_now, updated_at = v_now
     where m.id = v_msg.id;
    insert into public.revocation_message_attempts(message_id, attempt, worker, started_at) values (v_msg.id, v_msg.attempts + 1, p_worker, v_now);

    if v_msg.kind = 'constancia' then
      select jsonb_build_object('code', r.code, 'received_at', r.received_at) into v_payload
        from public.revocation_requests r where r.id = v_msg.request_id;
    elsif v_msg.kind = 'recuperacion' then
      -- Token nuevo por intento: el texto plano solo existe en memoria del ejecutor y en el email.
      -- Un enlace nuevo invalida los anteriores sin usar de esa dirección.
      update private.revocation_access_tokens t set revoked_at = v_now where t.email = v_msg.recipient and t.used_at is null and t.revoked_at is null;
      v_token := translate(rtrim(encode(extensions.gen_random_bytes(32), 'base64'), '='), '+/', '-_');
      insert into private.revocation_access_tokens(token_hash, email, message_id, expires_at)
        values (extensions.digest(v_token, 'sha256'), v_msg.recipient, v_msg.id, v_now + interval '30 minutes');
      v_payload := jsonb_build_object('token', v_token, 'expires_minutes', 30);
    elsif v_msg.kind in ('pedido_recibido','pago_confirmado','pedido_despachado','recuperacion_pedido') then
      v_payload := private.prepare_order_mail(v_msg);
      if v_payload is null then
        update public.revocation_messages set status='vencido',lease_id=null,locked_until=null where revocation_messages.id=v_msg.id;
        insert into public.revocation_message_events(message_id,action,to_status) values(v_msg.id,'vencido','vencido');
        continue;
      end if;
      v_payload:=v_payload||jsonb_build_object('_lease_until',v_now+make_interval(secs=>p_lease_seconds));
    else
      select jsonb_build_object('code', coalesce(r.code,o.code), 'failed_kind', f.kind, 'failed_status', f.status,
                                'error_code', f.last_error_code, 'attempts', f.attempts)
        into v_payload
        from public.revocation_messages f left join public.revocation_requests r on r.id = f.request_id left join public.orders o on o.id=f.order_id
       where f.id = v_msg.related_message_id;
    end if;

    if v_msg.order_id is not null then v_payload:=v_payload||jsonb_build_object('_order_message',true,'_lease_until',v_now+make_interval(secs=>p_lease_seconds)); end if;
    id := v_msg.id; lease_id := v_lease; kind := v_msg.kind; recipient := v_msg.recipient;
    attempt := v_msg.attempts + 1; payload := coalesce(v_payload, '{}'::jsonb);
    return next;
  end loop;
end;
$$;


create or replace function public.comunicaciones_reclamar(p_worker text,p_limit integer default 10,p_lease_seconds integer default 120)
returns table(id uuid,lease_id uuid,kind text,recipient text,attempt integer,payload jsonb)
language sql volatile security definer set search_path='' as $$
 select * from private.reclamar_comunicaciones(p_worker,p_limit,p_lease_seconds,false)
$$;
create function public.comunicaciones_reclamar_tienda(p_worker text,p_limit integer default 10,p_lease_seconds integer default 120)
returns table(id uuid,lease_id uuid,kind text,recipient text,attempt integer,payload jsonb)
language sql volatile security definer set search_path='' as $$
 select * from private.reclamar_comunicaciones(p_worker,p_limit,p_lease_seconds,true)
$$;
create function public.comunicaciones_validar_envio(p_id uuid,p_lease uuid) returns boolean
language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.revocation_messages where id=p_id and lease_id=p_lease and status='enviando' and locked_until>clock_timestamp())
$$;


create or replace function public.comunicaciones_resultado(p_id uuid, p_lease uuid, p_outcome text, p_error_code text default null,
                                                p_error_detail text default null, p_provider_id text default null)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare v_msg public.revocation_messages%rowtype; v_now timestamptz := clock_timestamp(); v_code text; v_detail text;
begin
  if p_outcome is null or p_outcome not in ('aceptado', 'error_temporal', 'error_permanente') or p_id is null or p_lease is null then
    raise exception 'Parámetros no válidos' using errcode = '22023';
  end if;
  select * into v_msg from public.revocation_messages m where m.id = p_id for update;
  if not found or v_msg.status <> 'enviando' or v_msg.lease_id is distinct from p_lease
     or (v_msg.order_id is not null and v_msg.locked_until<=v_now) then
    return 'sin_cambios';
  end if;
  v_code := left(regexp_replace(coalesce(p_error_code, ''), '[^a-z0-9_]', '', 'g'), 60);
  v_detail := private.redactar_error(p_error_detail);
  update public.revocation_message_attempts a
     set finished_at = v_now, outcome = p_outcome, error_code = nullif(v_code, ''), error_detail = v_detail
   where a.message_id = p_id and a.attempt = v_msg.attempts;

  if p_outcome = 'aceptado' then
    update public.revocation_messages m
       set status = 'aceptado', accepted_at = v_now, provider_message_id = left(private.redactar_error(p_provider_id), 300),
           lease_id = null, locked_until = null, last_error_code = null, last_error = null, version = m.version + 1, updated_at = v_now
     where m.id = p_id;
    insert into public.revocation_message_events(message_id, action, from_status, to_status) values (p_id, 'aceptado', 'enviando', 'aceptado');
    return 'aceptado';
  end if;

  update public.revocation_messages m set last_error_code = nullif(v_code, ''), last_error = v_detail, updated_at = v_now where m.id = p_id;
  if p_outcome = 'error_permanente' or v_msg.attempts >= v_msg.max_attempts then
    perform private.fallar_comunicacion(p_id, 'enviando');
    return 'fallido';
  end if;
  update private.revocation_access_tokens t set revoked_at = v_now where t.message_id = p_id and t.used_at is null and t.revoked_at is null;
  update public.revocation_messages m
     set status = 'pendiente', lease_id = null, locked_until = null, next_attempt_at = v_now + private.revocation_backoff(v_msg.attempts),
         version = m.version + 1, updated_at = v_now
   where m.id = p_id;
  insert into public.revocation_message_events(message_id, action, from_status, to_status) values (p_id, 'reintento_programado', 'enviando', 'pendiente');
  return 'reintento';
end;
$$;

create or replace function public.admin_intervenir_comunicacion(p_id uuid, p_version integer, p_action text, p_note text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_actor uuid; v_msg public.revocation_messages%rowtype; v_note text := nullif(btrim(coalesce(p_note, '')), ''); v_to text;
begin
  v_actor := private.exigir_admin();
  if p_action is null or p_action not in ('reintento_manual', 'rebote_manual', 'resuelto_manual')
     or (v_note is not null and (length(v_note) > 500 or v_note ~ '[[:cntrl:]]')) then
    raise exception 'Acción no válida' using errcode = '22023';
  end if;
  select * into v_msg from public.revocation_messages where id = p_id for update;
  if not found then raise exception 'Comunicación no encontrada' using errcode = 'P0002'; end if;
  if p_version is null or p_version <> v_msg.version then
    raise exception 'La comunicación cambió. Recargá antes de continuar.' using errcode = 'SR004';
  end if;
  if p_action = 'reintento_manual' then
    -- Reenvía la MISMA fila (mismo código). Las recuperaciones se piden de nuevo desde la web.
    if v_msg.kind in ('recuperacion','recuperacion_pedido') or (v_msg.order_id is not null and v_msg.status='aceptado') or v_msg.status not in ('fallido', 'rebotado', 'aceptado', 'resuelto_manual') then
      raise exception 'Transición no válida' using errcode = '22023';
    end if;
    v_to := 'pendiente';
    update public.revocation_messages
       set status = 'pendiente', next_attempt_at = clock_timestamp(), max_attempts = least(attempts + 3, 60),
           version = version + 1, updated_at = clock_timestamp()
     where id = p_id;
  elsif p_action = 'rebote_manual' then
    -- Rebote informado por el servidor de correo (NDR en la casilla institucional).
    if v_msg.status <> 'aceptado' then raise exception 'Transición no válida' using errcode = '22023'; end if;
    v_to := 'rebotado';
    update public.revocation_messages set status = 'rebotado', version = version + 1, updated_at = clock_timestamp() where id = p_id;
  else
    -- Resuelto por otro canal (p. ej. se comunicó el código por WhatsApp). Exige una nota sin datos sensibles.
    if v_msg.status not in ('fallido', 'rebotado', 'pendiente') or v_note is null or length(v_note) < 5 then
      raise exception 'Transición no válida' using errcode = '22023';
    end if;
    v_to := 'resuelto_manual';
    update public.revocation_messages set status = 'resuelto_manual', version = version + 1, updated_at = clock_timestamp() where id = p_id;
  end if;
  insert into public.revocation_message_events(message_id, actor_id, action, from_status, to_status, note)
    values (p_id, v_actor, p_action, v_msg.status, v_to, v_note);
end;
$$;

create function private.order_access_limit(p_kind text,p_ip inet,p_max integer) returns boolean
language plpgsql set search_path='' as $$
declare h bytea;
begin
 if p_ip is null then raise exception 'access_input' using errcode='22023'; end if;
 h:=private.hash_ip(p_ip);
 perform pg_advisory_xact_lock(hashtextextended(p_kind||encode(h,'hex'),7055));
 if (select count(*) from private.order_access_events where kind=p_kind and ip_hash=h and created_at>clock_timestamp()-interval '1 hour')>=p_max then return false; end if;
 insert into private.order_access_events(kind,ip_hash) values(p_kind,h);
 return true;
end $$;
create function public.solicitar_recuperacion_pedido(p_code text,p_email text,p_ip inet) returns jsonb
language plpgsql security definer set search_path='' as $$
declare oid uuid; mid uuid; email text:=lower(btrim(p_email));
begin
 if p_code is null or p_code !~ '^STF-[0-9]{4}-[2-9A-HJ-NP-Z]{4}$' or email is null
  or char_length(email)>254 or email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then
  raise exception 'access_input' using errcode='22023'; end if;
 if not private.order_access_limit('request',p_ip,5) then return jsonb_build_object('limited',true); end if;
 perform pg_advisory_xact_lock(hashtextextended('order-recovery:'||p_code||email,7056));
 select id into oid from public.orders where code=p_code and lower(buyer_email)=email;
 -- Un acceso anterior ya vencido no puede bloquear indefinidamente una nueva solicitud.
 with expired as (update public.revocation_messages m set status='vencido',lease_id=null,locked_until=null,version=version+1,updated_at=clock_timestamp()
 where m.order_id=oid and m.kind='recuperacion_pedido' and m.status in ('pendiente','enviando')
 and (m.locked_until is null or m.locked_until<=clock_timestamp())
 and (m.created_at<clock_timestamp()-interval '24 hours' or
   exists(select 1 from private.order_access_tokens t where t.message_id=m.id)
   and not exists(select 1 from private.order_access_tokens t where t.message_id=m.id and t.expires_at>clock_timestamp())) returning m.id)
 insert into public.revocation_message_events(message_id,action,to_status) select id,'vencido','vencido' from expired;
 if oid is not null and (select count(*) from public.revocation_messages where order_id=oid and kind='recuperacion_pedido'
    and created_at>clock_timestamp()-interval '1 hour')<3
  and not exists(select 1 from public.revocation_messages where order_id=oid and kind='recuperacion_pedido'
    and (status in ('pendiente','enviando') or created_at>clock_timestamp()-interval '5 minutes')) then
  mid:=private.enqueue_order_mail(oid,'recuperacion_pedido','recovery:'||gen_random_uuid());
  if mid is not null then update private.order_access_events set success=true,order_id=oid
   where id=(select max(id) from private.order_access_events where kind='request' and ip_hash=private.hash_ip(p_ip)); end if;
 end if;
 -- Resultado uniforme, inclusive cuando el límite por pedido evita otro envío.
 return jsonb_build_object('ok',true);
end $$;
create function public.canjear_recuperacion_pedido(p_token text,p_ip inet) returns jsonb
language plpgsql security definer set search_path='' as $$
declare t private.order_access_tokens; session text; code text;
begin
 if not private.order_access_limit('exchange',p_ip,20) then return jsonb_build_object('limited',true); end if;
 if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then return null; end if;
 select * into t from private.order_access_tokens where token_hash=extensions.digest(p_token,'sha256') and kind='recovery';
 if t.id is not null then
  perform pg_advisory_xact_lock(hashtextextended('recover-use:'||t.message_id,7057));
  select * into t from private.order_access_tokens where token_hash=extensions.digest(p_token,'sha256') and kind='recovery' for update;
 end if;
 if t.id is null or t.used_at is not null or t.expires_at<=clock_timestamp() then return null; end if;
 update private.order_access_tokens set used_at=clock_timestamp() where message_id=t.message_id and kind='recovery' and used_at is null;
 session:=translate(rtrim(encode(extensions.gen_random_bytes(32),'base64'),'='),'+/','-_');
 insert into private.order_access_tokens(order_id,kind,token_hash,expires_at)
 values(t.order_id,'session',extensions.digest(session,'sha256'),clock_timestamp()+interval '30 minutes');
 update private.order_access_events set success=true,order_id=t.order_id where id=(select max(id) from private.order_access_events
  where kind='exchange' and ip_hash=private.hash_ip(p_ip));
 select o.code into code from public.orders o where o.id=t.order_id;
 return jsonb_build_object('code',code,'session',session);
end $$;

create function public.admin_corregir_despacho(p_order uuid,p_version integer,p_carrier text,p_tracking text,p_date timestamptz,p_note text,p_confirm boolean)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.exigir_admin(); o public.orders; mid uuid; was_sent boolean;
begin
 if p_confirm is distinct from true or char_length(btrim(coalesce(p_note,''))) not between 5 and 500
  or char_length(btrim(coalesce(p_carrier,''))) not between 1 and 80 or p_carrier ~ '[[:cntrl:]]'
  or char_length(coalesce(p_tracking,''))>120 or p_tracking ~ '[[:cntrl:]]' then raise exception 'dispatch_input' using errcode='22023'; end if;
 select * into o from public.orders where id=p_order for update;
 if o.id is null or o.admin_version is distinct from p_version or o.fulfillment_status not in ('shipped','delivered')
  or p_date is null or p_date>clock_timestamp() or p_date<coalesce(o.paid_at,o.created_at) then raise exception 'dispatch_changed' using errcode='55000'; end if;
 -- Serializa con el reclamo (que usa FOR UPDATE SKIP LOCKED) antes de inspeccionar concesiones.
 perform id from public.revocation_messages where order_id=p_order and kind='pedido_despachado' order by id for update;
 if exists(select 1 from public.revocation_messages where order_id=p_order and kind='pedido_despachado'
  and status='enviando' and locked_until>clock_timestamp()) then raise exception 'dispatch_sending' using errcode='55000'; end if;
 if (o.dispatch_carrier,o.dispatch_tracking,o.dispatched_at) is not distinct from (btrim(p_carrier),nullif(btrim(p_tracking),''),p_date) then return; end if;
 -- Un envío intentado con resultado ambiguo también pudo llegar al destinatario.
 was_sent:=exists(select 1 from public.revocation_messages where order_id=p_order and kind='pedido_despachado' and (attempts>0 or status in ('aceptado','rebotado')));
 -- Ninguna modificación durante una concesión activa. Sustituye pendientes y deja historial.
 update public.revocation_messages set status='vencido',lease_id=null,locked_until=null,version=version+1
 where order_id=p_order and kind='pedido_despachado' and status in ('pendiente','enviando','fallido');
 update public.orders set dispatch_carrier=btrim(p_carrier),dispatch_tracking=nullif(btrim(p_tracking),''),dispatched_at=p_date where id=p_order;
 insert into private.order_office_events(order_id,actor,kind,note,before_data,after_data)
 values(p_order,actor,'dispatch_corrected',btrim(p_note),jsonb_build_object('carrier',o.dispatch_carrier,'tracking',o.dispatch_tracking,'date',o.dispatched_at),
 jsonb_build_object('carrier',btrim(p_carrier),'tracking',nullif(btrim(p_tracking),''),'date',p_date));
 mid:=private.enqueue_order_mail(p_order,'pedido_despachado','dispatch-correction:'||p_order||':'||p_version,jsonb_build_object('correction',was_sent));
end $$;

create function public.admin_registrar_factura(p_order uuid,p_version integer,p_pos text,p_number text,p_date date,p_cents bigint,p_note text,p_confirm boolean)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.exigir_admin(); previous private.order_invoices; current private.order_invoices;
begin
 if p_confirm is distinct from true or p_pos is null or p_pos !~ '^[0-9]{5}$' or p_pos='00000'
  or p_number is null or p_number !~ '^[0-9]{8}$' or p_number='00000000' or p_date is null
  or p_date>(clock_timestamp() at time zone 'America/Argentina/Buenos_Aires')::date
  or p_cents is null or p_cents not between 1 and 999999999999
  or char_length(btrim(coalesce(p_note,''))) not between 5 and 500 then raise exception 'invoice_input' using errcode='22023'; end if;
 perform 1 from public.orders where id=p_order for update;
 if not found then raise exception 'invoice_unavailable' using errcode='55000'; end if;
 select * into previous from private.order_invoices where order_id=p_order;
 if coalesce(previous.version,-1) is distinct from p_version then raise exception 'invoice_changed' using errcode='55000'; end if;
 insert into private.order_invoices(order_id,pos,number,issued_on,cents,admin_id,notes)
 values(p_order,p_pos,p_number,p_date,p_cents,actor,btrim(p_note)) on conflict(order_id) do update
 set pos=excluded.pos,number=excluded.number,issued_on=excluded.issued_on,cents=excluded.cents,notes=excluded.notes,
 version=order_invoices.version+1,send_status='pending',sent_at=null,recipient=null,sent_admin=null returning * into current;
 insert into private.order_office_events(order_id,actor,kind,note,before_data,after_data)
 values(p_order,actor,case when previous.order_id is null then 'invoice_registered' else 'invoice_corrected' end,btrim(p_note),to_jsonb(previous),to_jsonb(current));
end $$;
create function public.admin_registrar_envio_factura(p_order uuid,p_version integer,p_status text,p_email text,p_date timestamptz,p_note text,p_confirm boolean)
returns void language plpgsql security definer set search_path='' as $$
declare actor uuid:=private.exigir_admin(); previous private.order_invoices; current private.order_invoices;
begin
 if p_confirm is distinct from true or p_status is null or p_status not in ('pending','sent','failed')
  or p_email is null or char_length(p_email)>254 or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
  or p_date is null or p_date>clock_timestamp() or char_length(btrim(coalesce(p_note,''))) not between 5 and 500 then
  raise exception 'invoice_input' using errcode='22023'; end if;
 perform 1 from public.orders where id=p_order for update;
 select * into previous from private.order_invoices where order_id=p_order;
 if previous.order_id is null or previous.version is distinct from p_version
  or p_date<(previous.issued_on::timestamp at time zone 'America/Argentina/Buenos_Aires') then raise exception 'invoice_changed' using errcode='55000'; end if;
 update private.order_invoices set send_status=p_status,recipient=lower(btrim(p_email)),sent_at=case when p_status='sent' then p_date end,sent_admin=actor,
 version=version+1 where order_id=p_order returning * into current;
 insert into private.order_office_events(order_id,actor,kind,note,before_data,after_data)
 values(p_order,actor,'invoice_send_declared',btrim(p_note),to_jsonb(previous),to_jsonb(current)||jsonb_build_object('declared_at',p_date));
end $$;
create function public.admin_ver_oficina_pedido(p_order uuid) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare o public.orders;
begin
 perform private.exigir_admin();select * into o from public.orders where id=p_order;
 if o.id is null then return null; end if;
 return jsonb_build_object('invoice',(select to_jsonb(i) from private.order_invoices i where order_id=p_order),
 'review_required',o.payment_status<>'approved' or o.resolution_status='pending'
  or exists(select 1 from private.observed_refunds where order_id=p_order)
  or exists(select 1 from private.chargeback_cases where order_id=p_order)
  or exists(select 1 from private.physical_returns where order_id=p_order)
  or exists(select 1 from private.order_invoices where order_id=p_order and (cents<>(o.total_ars*100)::bigint or (recipient is not null and recipient<>lower(o.buyer_email)))),
 'events',(select coalesce(jsonb_agg(to_jsonb(e) order by id desc),'[]') from private.order_office_events e where order_id=p_order),
 'messages',(select coalesce(jsonb_agg(jsonb_build_object('id',m.id,'kind',m.kind,'status',m.status,'attempts',m.attempts,
 'error',m.last_error_code,'version',m.version,'created_at',m.created_at,'accepted_at',m.accepted_at) order by m.created_at desc),'[]')
 from public.revocation_messages m where m.order_id=p_order));
end $$;

-- VISTA_Y_PERMISOS_5E

create function private.order_tracking_view(p_order public.orders) returns jsonb language sql stable set search_path='' as $$
  select jsonb_build_object(
    'code', p_order.code,
    'created_at', p_order.created_at,
    'payment_status', p_order.payment_status,
    'fulfillment_status', p_order.fulfillment_status,
    'needs_attention', p_order.resolution_status = 'pending',
    'reservation_expires_at', case when p_order.stock_state = 'reserved' then p_order.reservation_expires_at end,
    'subtotal_ars', p_order.subtotal_ars,
    'shipping_ars', p_order.shipping_ars,
    'total_ars', p_order.total_ars,
    'destination', jsonb_build_object(
      'city', p_order.ship_city,
      'province', (select p.name from public.provinces p where p.code = p_order.ship_province_code)
    ),
    'dispatch', case when p_order.dispatched_at is null then null else jsonb_build_object(
      'carrier', p_order.dispatch_carrier, 'tracking', p_order.dispatch_tracking,
      'dispatched_at', p_order.dispatched_at, 'delivered_at', p_order.delivered_at) end,
    'items', (select jsonb_agg(jsonb_build_object(
                'sku', oi.sku, 'name', oi.name, 'unit_price_ars', oi.unit_price_ars,
                'quantity', oi.quantity, 'line_total_ars', oi.line_total_ars) order by oi.name, oi.sku)
                from public.order_items oi where oi.order_id = p_order.id)
  );
$$;
create or replace function public.consultar_pedido(p_code text, p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  if p_code is null or p_token is null or p_code !~ '^STF-[0-9]{4}-[2-9A-HJ-NP-Z]{4}$' or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return null;
  end if;
  select * into v_order from public.orders o where o.code = p_code;
  if not found or v_order.access_token_hash <> sha256(convert_to(p_token, 'UTF8')) then
    return null;
  end if;

  return private.order_tracking_view(v_order);
end;
$$;

create function public.consultar_pedido_recuperado(p_code text,p_session text,p_ip inet) returns jsonb
language plpgsql security definer set search_path='' as $$
declare o public.orders;
begin
 if not private.order_access_limit('lookup',p_ip,120) then return null; end if;
 if p_code is null or p_session is null or p_session !~ '^[A-Za-z0-9_-]{43}$' then return null; end if;
 select q.* into o from public.orders q join private.order_access_tokens t on t.order_id=q.id
 where q.code=p_code and t.kind='session' and t.used_at is null and t.token_hash=extensions.digest(p_session,'sha256') and t.expires_at>clock_timestamp();
 if o.id is null then return null; end if;
 update private.order_access_events set success=true,order_id=o.id where id=(select max(id) from private.order_access_events
  where kind='lookup' and ip_hash=private.hash_ip(p_ip));
 return private.order_tracking_view(o);
end $$;
create function public.revocar_acceso_pedido(p_session text) returns void
language plpgsql security definer set search_path='' as $$
begin
 if p_session is null or p_session !~ '^[A-Za-z0-9_-]{43}$' then return; end if;
 update private.order_access_tokens set used_at=clock_timestamp()
 where kind='session' and token_hash=extensions.digest(p_session,'sha256') and used_at is null;
end $$;
create function public.admin_comunicacion_pedido(p_order uuid,p_id uuid,p_version integer,p_action text,p_note text)
returns void language plpgsql security definer set search_path='' as $$
begin
 perform private.exigir_admin();
 perform 1 from public.orders where id=p_order for update;
 if not exists(select 1 from public.revocation_messages where id=p_id and order_id=p_order) then raise exception 'message_unavailable' using errcode='55000'; end if;
 perform public.admin_intervenir_comunicacion(p_id,p_version,p_action,p_note);
end $$;

revoke all on function private.order_mail_snapshot(uuid),
 private.enqueue_order_mail(uuid,text,text,jsonb),
 private.enqueue_order_event_mail(),
 private.prepare_order_mail(public.revocation_messages),
 private.encolar_alerta_comunicacion(uuid),
 private.reclamar_comunicaciones(text,integer,integer,boolean),
 public.comunicaciones_reclamar(text,integer,integer),
 public.comunicaciones_reclamar_tienda(text,integer,integer),
 public.comunicaciones_validar_envio(uuid,uuid),
 public.comunicaciones_resultado(uuid,uuid,text,text,text,text),
 public.admin_intervenir_comunicacion(uuid,integer,text,text),
 private.order_access_limit(text,inet,integer),
 public.solicitar_recuperacion_pedido(text,text,inet),
 public.canjear_recuperacion_pedido(text,inet),
 public.admin_corregir_despacho(uuid,integer,text,text,timestamptz,text,boolean),
 public.admin_registrar_factura(uuid,integer,text,text,date,bigint,text,boolean),
 public.admin_registrar_envio_factura(uuid,integer,text,text,timestamptz,text,boolean),
 public.admin_ver_oficina_pedido(uuid),
 private.order_tracking_view(public.orders),
 public.consultar_pedido(text,text),
 public.consultar_pedido_recuperado(text,text,inet),public.revocar_acceso_pedido(text),
 public.admin_comunicacion_pedido(uuid,uuid,integer,text,text) from public,anon,authenticated,service_role;
grant execute on function public.comunicaciones_reclamar(text,integer,integer),public.comunicaciones_reclamar_tienda(text,integer,integer),
 public.comunicaciones_resultado(uuid,uuid,text,text,text,text),public.comunicaciones_validar_envio(uuid,uuid),
 public.solicitar_recuperacion_pedido(text,text,inet),public.canjear_recuperacion_pedido(text,inet),
 public.consultar_pedido_recuperado(text,text,inet),public.revocar_acceso_pedido(text),public.consultar_pedido(text,text) to service_role;
grant execute on function public.admin_intervenir_comunicacion(uuid,integer,text,text),
 public.admin_corregir_despacho(uuid,integer,text,text,timestamptz,text,boolean),
 public.admin_registrar_factura(uuid,integer,text,text,date,bigint,text,boolean),
 public.admin_registrar_envio_factura(uuid,integer,text,text,timestamptz,text,boolean),
 public.admin_ver_oficina_pedido(uuid),public.admin_comunicacion_pedido(uuid,uuid,integer,text,text) to authenticated;
