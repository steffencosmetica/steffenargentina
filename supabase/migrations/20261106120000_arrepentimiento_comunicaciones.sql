-- Fase 4B.7 — comunicaciones del Botón de Arrepentimiento.
--
-- La constancia inmediata en la web sigue siendo el canal principal. El email es un RESPALDO:
--   * se encola en la MISMA transacción que registra la solicitud (si hay solicitud, hay comunicación pendiente);
--   * lo envía un ejecutor (scripts/mail-worker.ts) o el propio servidor después de responder, siempre
--     reclamando filas con un arrendamiento (lease) para no enviar dos veces en paralelo;
--   * «aceptado» significa que el servidor SMTP aceptó el mensaje: NO acredita entrega ni lectura;
--   * los fallos definitivos encolan una alerta interna y quedan visibles en /admin/arrepentimientos.
-- Nada de este módulo modifica pedidos, pagos, reembolsos ni stock.

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

create table public.revocation_messages (
  id                  uuid primary key default gen_random_uuid(),
  -- constancia: la solicitud de origen. recuperación y alerta pueden no tenerla.
  request_id          uuid references public.revocation_requests(id) on delete cascade,
  kind                text not null check (kind in ('constancia', 'recuperacion', 'alerta')),
  recipient           text not null check (length(recipient) between 3 and 254),
  status              text not null default 'pendiente'
                      check (status in ('pendiente', 'enviando', 'aceptado', 'fallido', 'rebotado', 'resuelto_manual', 'vencido')),
  attempts            integer not null default 0 check (attempts >= 0),
  max_attempts        integer not null default 8 check (max_attempts between 1 and 60),
  next_attempt_at     timestamptz not null default clock_timestamp(),
  lease_id            uuid,
  locked_until        timestamptz,
  last_attempt_at     timestamptz,
  last_error_code     text check (length(last_error_code) <= 60),
  last_error          text check (length(last_error) <= 300),
  accepted_at         timestamptz,
  provider_message_id text check (length(provider_message_id) <= 300),
  -- alerta: comunicación que falló
  related_message_id  uuid references public.revocation_messages(id) on delete cascade,
  version             integer not null default 0,
  created_at          timestamptz not null default clock_timestamp(),
  updated_at          timestamptz not null default clock_timestamp(),
  constraint revocation_messages_constancia_request check (kind <> 'constancia' or request_id is not null),
  constraint revocation_messages_alerta_related check (kind <> 'alerta' or related_message_id is not null),
  constraint revocation_messages_lease check ((status = 'enviando') = (lease_id is not null and locked_until is not null))
);
-- Una sola constancia por solicitud: los reintentos reutilizan la fila (y el código), nunca la duplican.
create unique index revocation_messages_one_constancia on public.revocation_messages(request_id) where kind = 'constancia';
-- Una sola alerta activa por comunicación fallida.
create unique index revocation_messages_one_active_alert on public.revocation_messages(related_message_id)
  where kind = 'alerta' and status in ('pendiente', 'enviando');
create index revocation_messages_due_idx on public.revocation_messages(next_attempt_at) where status in ('pendiente', 'enviando');
create index revocation_messages_request_idx on public.revocation_messages(request_id);
create index revocation_messages_recovery_idx on public.revocation_messages(recipient, created_at desc) where kind = 'recuperacion';
create index revocation_messages_attention_idx on public.revocation_messages(status) where status in ('fallido', 'rebotado');

-- Cada intento de envío (registro técnico; el detalle de error ya viene sin direcciones de email).
create table public.revocation_message_attempts (
  id           bigint generated always as identity primary key,
  message_id   uuid not null references public.revocation_messages(id) on delete cascade,
  attempt      integer not null,
  worker       text not null check (length(worker) between 1 and 80),
  started_at   timestamptz not null default clock_timestamp(),
  finished_at  timestamptz,
  outcome      text check (outcome in ('aceptado', 'error_temporal', 'error_permanente', 'interrumpido')),
  error_code   text check (length(error_code) <= 60),
  error_detail text check (length(error_detail) <= 300),
  unique (message_id, attempt)
);

-- Historial auditable de cada comunicación: sistema (actor null) y administradores.
create table public.revocation_message_events (
  id          bigint generated always as identity primary key,
  message_id  uuid not null references public.revocation_messages(id) on delete cascade,
  created_at  timestamptz not null default clock_timestamp(),
  actor_id    uuid,
  action      text not null check (action in ('encolado', 'aceptado', 'reintento_programado', 'fallido', 'interrumpido',
                                              'vencido', 'reintento_manual', 'rebote_manual', 'resuelto_manual')),
  from_status text,
  to_status   text,
  note        text check (length(note) <= 500)
);
create index revocation_message_events_message_idx on public.revocation_message_events(message_id, created_at);

-- Tokens de recuperación: solo el hash SHA-256 (32 bytes aleatorios → sin valor sin el original).
-- Distintos del token de seguimiento de pedidos (otra tabla, otra clave, otro formato).
create table private.revocation_access_tokens (
  id         uuid primary key default gen_random_uuid(),
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  email      text not null,
  message_id uuid not null references public.revocation_messages(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  expires_at timestamptz not null,
  used_at    timestamptz,
  revoked_at timestamptz
);
create index revocation_access_tokens_message_idx on private.revocation_access_tokens(message_id);

-- Límites antiabuso de recuperación y canje (huella HMAC de la IP, nunca la IP).
create table private.revocation_rate_events (
  id         bigint generated always as identity primary key,
  kind       text not null check (kind in ('recuperacion', 'canje')),
  ip_hash    bytea not null,
  created_at timestamptz not null default clock_timestamp()
);
create index revocation_rate_events_idx on private.revocation_rate_events(kind, ip_hash, created_at desc);

-- Latido de los ejecutores: permite detectar un ejecutor detenido aunque el correo esté caído.
create table private.mail_workers (
  worker       text primary key check (length(worker) between 1 and 80),
  last_seen_at timestamptz not null default clock_timestamp()
);

alter table public.revocation_messages enable row level security;
alter table public.revocation_message_attempts enable row level security;
alter table public.revocation_message_events enable row level security;
alter table private.revocation_access_tokens enable row level security;
alter table private.revocation_rate_events enable row level security;
alter table private.mail_workers enable row level security;

revoke all on public.revocation_messages, public.revocation_message_attempts, public.revocation_message_events from anon, authenticated, service_role;
revoke all on private.revocation_access_tokens, private.revocation_rate_events, private.mail_workers from public, anon, authenticated, service_role;
-- Lectura administrativa (RLS). Las columnas de arrendamiento quedan fuera.
grant select (id, request_id, kind, recipient, status, attempts, max_attempts, next_attempt_at, last_attempt_at, last_error_code,
              last_error, accepted_at, related_message_id, version, created_at, updated_at) on public.revocation_messages to authenticated;
grant select on public.revocation_message_attempts, public.revocation_message_events to authenticated;
create policy revocation_messages_admin_read on public.revocation_messages for select to authenticated using ((select public.is_admin()));
create policy revocation_message_attempts_admin_read on public.revocation_message_attempts for select to authenticated using ((select public.is_admin()));
create policy revocation_message_events_admin_read on public.revocation_message_events for select to authenticated using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Ayudantes privados
-- ---------------------------------------------------------------------------

-- Destinatario de las alertas operativas: contacto institucional existente.
create function private.revocation_alert_recipient() returns text language sql immutable set search_path = '' as $$
  select 'info@steffenargentina.com.ar'::text
$$;

-- Ninguna dirección de email ni texto de control llega a las columnas de error.
create function private.redactar_error(p_text text) returns text language sql immutable set search_path = '' as $$
  select nullif(left(regexp_replace(regexp_replace(coalesce(p_text, ''), '[^[:space:]<>"''(),;:]+@[^[:space:]<>"''(),;:]+', '[email]', 'g'),
                                    '[[:cntrl:]]+', ' ', 'g'), 300), '')
$$;

-- Espera antes del próximo intento automático (1 min, 5 min, 15 min, 30 min, 1 h, 2 h, 4 h, 8 h...).
create function private.revocation_backoff(p_attempt integer) returns interval language sql immutable set search_path = '' as $$
  select (array['1 minute', '5 minutes', '15 minutes', '30 minutes', '1 hour', '2 hours', '4 hours', '8 hours']::interval[])
         [least(greatest(p_attempt, 1), 8)]
$$;

-- Encola (una vez) la alerta interna de una constancia fallida o rebotada. No alerta sobre alertas.
create function private.encolar_alerta_comunicacion(p_message_id uuid) returns void language plpgsql volatile set search_path = '' as $$
declare v_id uuid;
begin
  insert into public.revocation_messages(kind, recipient, related_message_id, request_id)
    select 'alerta', private.revocation_alert_recipient(), m.id, m.request_id
    from public.revocation_messages m where m.id = p_message_id and m.kind = 'constancia'
  on conflict do nothing
  returning id into v_id;
  if v_id is not null then
    insert into public.revocation_message_events(message_id, action, to_status) values (v_id, 'encolado', 'pendiente');
  end if;
end;
$$;

-- Marca una comunicación como fallida definitiva y dispara la alerta.
create function private.fallar_comunicacion(p_id uuid, p_from text) returns void language plpgsql volatile set search_path = '' as $$
begin
  update public.revocation_messages
     set status = 'fallido', lease_id = null, locked_until = null, version = version + 1, updated_at = clock_timestamp()
   where id = p_id;
  update private.revocation_access_tokens set revoked_at = clock_timestamp() where message_id = p_id and used_at is null and revoked_at is null;
  insert into public.revocation_message_events(message_id, action, from_status, to_status) values (p_id, 'fallido', p_from, 'fallido');
  perform private.encolar_alerta_comunicacion(p_id);
end;
$$;

revoke all on function private.revocation_alert_recipient(), private.redactar_error(text), private.revocation_backoff(integer),
  private.encolar_alerta_comunicacion(uuid), private.fallar_comunicacion(uuid, text) from public, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Recepción: misma función, ahora encola la constancia en la misma transacción
-- ---------------------------------------------------------------------------

create or replace function public.registrar_arrepentimiento(p_reference text, p_email text, p_key uuid, p_ip inet)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_hash bytea; v_row public.revocation_requests%rowtype; v_message uuid;
begin
  if p_reference is null or length(btrim(p_reference)) not between 3 and 100
     or p_reference ~ '[[:cntrl:]]' or p_email is null or length(p_email) > 254
     or p_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
     or p_key is null or p_ip is null then
    raise exception 'Solicitud no válida' using errcode = '22023';
  end if;
  v_hash := private.hash_ip(p_ip);
  -- Una misma clave no puede producir dos solicitudes, incluso con distintas IP.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(p_key::text, 7047));
  select * into v_row from public.revocation_requests where idempotency_key = p_key;
  if found then
    if v_row.ip_hash <> v_hash or v_row.purchase_reference <> btrim(p_reference) or v_row.contact_email <> lower(btrim(p_email)) then
      raise exception 'Solicitud no válida' using errcode = '22023';
    end if;
    -- Reintento: mismo código y la MISMA comunicación (no se encola otra).
    return jsonb_build_object('code', v_row.code, 'received_at', v_row.received_at);
  end if;
  -- Serializar por IP hace efectivo el límite también con solicitudes concurrentes.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(encode(v_hash, 'hex'), 7048));
  if (select count(*) from public.revocation_requests where ip_hash = v_hash and received_at > clock_timestamp() - interval '1 hour') >= 5 then
    return jsonb_build_object('limited', true);
  end if;
  insert into public.revocation_requests(purchase_reference, contact_email, idempotency_key, ip_hash)
    values(btrim(p_reference), lower(btrim(p_email)), p_key, v_hash) returning * into v_row;
  insert into public.revocation_events(request_id, status) values(v_row.id, 'recibida');
  -- Persistencia duradera del respaldo por email: si la solicitud existe, su comunicación también.
  insert into public.revocation_messages(request_id, kind, recipient) values (v_row.id, 'constancia', v_row.contact_email) returning id into v_message;
  insert into public.revocation_message_events(message_id, action, to_status) values (v_message, 'encolado', 'pendiente');
  return jsonb_build_object('code', v_row.code, 'received_at', v_row.received_at);
end;
$$;
revoke all on function public.registrar_arrepentimiento(text,text,uuid,inet) from public, anon, authenticated, service_role;
grant execute on function public.registrar_arrepentimiento(text,text,uuid,inet) to service_role;

-- ---------------------------------------------------------------------------
-- Ejecutor: reclamar y registrar resultados (solo servidor)
-- ---------------------------------------------------------------------------

-- Reclama hasta p_limit comunicaciones vencidas con un arrendamiento de p_lease_seconds.
-- Recupera las que quedaron «enviando» si su ejecutor murió (arrendamiento vencido): se registran como
-- intento interrumpido. Por eso el envío es «al menos una vez»: si el proceso cayó DESPUÉS de que el
-- servidor SMTP aceptara el mensaje, puede repetirse el MISMO email (mismo código, misma fila).
create function public.comunicaciones_reclamar(p_worker text, p_limit integer default 10, p_lease_seconds integer default 120)
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
     where m.kind = 'recuperacion' and m.created_at < v_now - interval '24 hours'
       and (m.status = 'pendiente' or (m.status = 'enviando' and m.locked_until < v_now))
    returning m.id
  ) insert into public.revocation_message_events(message_id, action, to_status) select e.id, 'vencido', 'vencido' from expired e;

  for v_msg in
    select m.* from public.revocation_messages m
     where (m.status = 'pendiente' and m.next_attempt_at <= v_now) or (m.status = 'enviando' and m.locked_until < v_now)
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
    else
      select jsonb_build_object('code', r.code, 'failed_kind', f.kind, 'failed_status', f.status,
                                'error_code', f.last_error_code, 'attempts', f.attempts)
        into v_payload
        from public.revocation_messages f left join public.revocation_requests r on r.id = f.request_id
       where f.id = v_msg.related_message_id;
    end if;

    id := v_msg.id; lease_id := v_lease; kind := v_msg.kind; recipient := v_msg.recipient;
    attempt := v_msg.attempts + 1; payload := coalesce(v_payload, '{}'::jsonb);
    return next;
  end loop;
end;
$$;

-- Registra el resultado de un intento. Idempotente: si el arrendamiento ya no corresponde (otro
-- ejecutor lo recuperó, un administrador intervino o el resultado ya se registró) no cambia nada.
create function public.comunicaciones_resultado(p_id uuid, p_lease uuid, p_outcome text, p_error_code text default null,
                                                p_error_detail text default null, p_provider_id text default null)
returns text language plpgsql volatile security definer set search_path = '' as $$
declare v_msg public.revocation_messages%rowtype; v_now timestamptz := clock_timestamp(); v_code text; v_detail text;
begin
  if p_outcome is null or p_outcome not in ('aceptado', 'error_temporal', 'error_permanente') or p_id is null or p_lease is null then
    raise exception 'Parámetros no válidos' using errcode = '22023';
  end if;
  select * into v_msg from public.revocation_messages m where m.id = p_id for update;
  if not found or v_msg.status <> 'enviando' or v_msg.lease_id is distinct from p_lease then
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

-- Indicadores de salud (sin datos personales): para el panel, el monitor externo y la CLI.
create function private.estado_comunicaciones_datos() returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object(
    'now', clock_timestamp(),
    'pendientes', (select count(*) from public.revocation_messages where status in ('pendiente', 'enviando')),
    'vencidas', (select count(*) from public.revocation_messages
                  where (status = 'pendiente' and next_attempt_at < clock_timestamp() - interval '10 minutes')
                     or (status = 'enviando' and locked_until < clock_timestamp() - interval '10 minutes')),
    'fallidas', (select count(*) from public.revocation_messages where status in ('fallido', 'rebotado') and kind <> 'recuperacion'),
    'alertas_pendientes', (select count(*) from public.revocation_messages where kind = 'alerta' and status in ('pendiente', 'enviando')),
    'mas_antigua_pendiente', (select min(created_at) from public.revocation_messages where status in ('pendiente', 'enviando')),
    -- Solo ejecutores autónomos: el envío inmediato de la web (web-*) depende de que haya visitas.
    'ultimo_ejecutor', (select max(last_seen_at) from private.mail_workers where worker not like 'web-%')
  )
$$;
revoke all on function private.estado_comunicaciones_datos() from public, anon, authenticated, service_role;

create function public.estado_comunicaciones() returns jsonb language sql stable security definer set search_path = '' as $$
  select private.estado_comunicaciones_datos()
$$;
create function public.admin_estado_comunicaciones() returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform private.exigir_admin();
  return private.estado_comunicaciones_datos();
end;
$$;

revoke all on function public.comunicaciones_reclamar(text, integer, integer), public.comunicaciones_resultado(uuid, uuid, text, text, text, text),
  public.estado_comunicaciones(), public.admin_estado_comunicaciones() from public, anon, authenticated, service_role;
grant execute on function public.comunicaciones_reclamar(text, integer, integer), public.comunicaciones_resultado(uuid, uuid, text, text, text, text),
  public.estado_comunicaciones() to service_role;
grant execute on function public.admin_estado_comunicaciones() to authenticated;

-- ---------------------------------------------------------------------------
-- Recuperación privada de constancias (solo servidor)
-- ---------------------------------------------------------------------------

-- Siempre responde lo mismo, exista o no una solicitud con ese email. Solo encola un email si hay
-- solicitudes para esa dirección (no se usa la tienda para escribir a terceros) y dentro de los límites.
create function public.solicitar_recuperacion_arrepentimiento(p_email text, p_ip inet)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_email text := lower(btrim(p_email)); v_hash bytea; v_id uuid;
begin
  if p_email is null or length(p_email) > 254 or v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' or p_ip is null then
    raise exception 'Solicitud no válida' using errcode = '22023';
  end if;
  v_hash := private.hash_ip(p_ip);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(encode(v_hash, 'hex'), 7049));
  if (select count(*) from private.revocation_rate_events where kind = 'recuperacion' and ip_hash = v_hash
        and created_at > clock_timestamp() - interval '1 hour') >= 5 then
    return jsonb_build_object('limited', true);
  end if;
  insert into private.revocation_rate_events(kind, ip_hash) values ('recuperacion', v_hash);

  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_email, 7050));
  if exists (select 1 from public.revocation_requests where contact_email = v_email)
     and (select count(*) from public.revocation_messages where kind = 'recuperacion' and recipient = v_email
            and created_at > clock_timestamp() - interval '1 hour') < 3
     and not exists (select 1 from public.revocation_messages where kind = 'recuperacion' and recipient = v_email
            and status in ('pendiente', 'enviando')) then
    insert into public.revocation_messages(kind, recipient, max_attempts) values ('recuperacion', v_email, 5) returning id into v_id;
    insert into public.revocation_message_events(message_id, action, to_status) values (v_id, 'encolado', 'pendiente');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

-- Canjea un token (un solo uso, 30 minutos) por la información mínima de las constancias de ese email.
create function public.canjear_constancia_arrepentimiento(p_token text, p_ip inet)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_hash bytea; v_token private.revocation_access_tokens%rowtype;
begin
  if p_ip is null then raise exception 'Solicitud no válida' using errcode = '22023'; end if;
  v_hash := private.hash_ip(p_ip);
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(encode(v_hash, 'hex'), 7051));
  if (select count(*) from private.revocation_rate_events where kind = 'canje' and ip_hash = v_hash
        and created_at > clock_timestamp() - interval '1 hour') >= 20 then
    return jsonb_build_object('limited', true);
  end if;
  insert into private.revocation_rate_events(kind, ip_hash) values ('canje', v_hash);
  if p_token is null or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return jsonb_build_object('invalid', true);
  end if;
  select * into v_token from private.revocation_access_tokens t where t.token_hash = extensions.digest(p_token, 'sha256') for update;
  if not found or v_token.used_at is not null or v_token.revoked_at is not null or v_token.expires_at <= clock_timestamp() then
    return jsonb_build_object('invalid', true);
  end if;
  update private.revocation_access_tokens set used_at = clock_timestamp() where id = v_token.id;
  return jsonb_build_object('items', coalesce((
    select jsonb_agg(jsonb_build_object('code', r.code, 'received_at', r.received_at, 'status', r.status) order by r.received_at desc)
      from (select code, received_at, status from public.revocation_requests where contact_email = v_token.email
             order by received_at desc limit 20) r), '[]'::jsonb));
end;
$$;

revoke all on function public.solicitar_recuperacion_arrepentimiento(text, inet), public.canjear_constancia_arrepentimiento(text, inet)
  from public, anon, authenticated, service_role;
grant execute on function public.solicitar_recuperacion_arrepentimiento(text, inet), public.canjear_constancia_arrepentimiento(text, inet) to service_role;

-- ---------------------------------------------------------------------------
-- Intervención administrativa (auditada; nunca toca pedidos, pagos, reembolsos ni stock)
-- ---------------------------------------------------------------------------

create function public.admin_intervenir_comunicacion(p_id uuid, p_version integer, p_action text, p_note text)
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
    if v_msg.kind = 'recuperacion' or v_msg.status not in ('fallido', 'rebotado', 'aceptado', 'resuelto_manual') then
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
revoke all on function public.admin_intervenir_comunicacion(uuid, integer, text, text) from public, anon, authenticated, service_role;
grant execute on function public.admin_intervenir_comunicacion(uuid, integer, text, text) to authenticated;
