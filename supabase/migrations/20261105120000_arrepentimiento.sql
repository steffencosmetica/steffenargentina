-- Solicitudes independientes de pedidos: recibir NO confirma identidad, pago ni reembolso.
create table public.revocation_requests (
  id uuid primary key default gen_random_uuid(),
  code text not null unique default ('ARR-' || upper(replace(gen_random_uuid()::text, '-', ''))),
  purchase_reference text not null check (length(purchase_reference) between 3 and 100),
  contact_email text not null check (length(contact_email) <= 254),
  received_at timestamptz not null default clock_timestamp(),
  status text not null default 'recibida' check (status in ('recibida', 'en_gestion', 'cerrada')),
  version integer not null default 0,
  updated_at timestamptz not null default clock_timestamp(),
  idempotency_key uuid not null unique,
  ip_hash bytea not null
);
create index revocation_received_idx on public.revocation_requests(received_at desc);
create index revocation_ip_idx on public.revocation_requests(ip_hash, received_at desc);
create table public.revocation_events (
  id bigint generated always as identity primary key,
  request_id uuid not null references public.revocation_requests(id) on delete cascade,
  created_at timestamptz not null default clock_timestamp(),
  actor_id uuid,
  status text not null check (status in ('recibida', 'en_gestion', 'cerrada'))
);
alter table public.revocation_requests enable row level security;
alter table public.revocation_events enable row level security;
revoke all on public.revocation_requests, public.revocation_events from anon, authenticated, service_role;
grant select (id, code, purchase_reference, contact_email, received_at, status, version, updated_at) on public.revocation_requests to authenticated;
grant select on public.revocation_events to authenticated;
create policy revocation_admin_read on public.revocation_requests for select to authenticated using ((select public.is_admin()));
create policy revocation_events_admin_read on public.revocation_events for select to authenticated using ((select public.is_admin()));

create function public.registrar_arrepentimiento(p_reference text, p_email text, p_key uuid, p_ip inet)
returns jsonb language plpgsql volatile security definer set search_path = '' as $$
declare v_hash bytea; v_row public.revocation_requests%rowtype;
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
  return jsonb_build_object('code', v_row.code, 'received_at', v_row.received_at);
end;
$$;
revoke all on function public.registrar_arrepentimiento(text,text,uuid,inet) from public, anon, authenticated, service_role;
grant execute on function public.registrar_arrepentimiento(text,text,uuid,inet) to service_role;

create function public.admin_gestionar_arrepentimiento(p_id uuid, p_version integer, p_status text)
returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_row public.revocation_requests%rowtype;
begin
  perform private.exigir_admin();
  select * into v_row from public.revocation_requests where id = p_id for update;
  if not found then raise exception 'Solicitud no encontrada' using errcode = 'P0002'; end if;
  if p_version is null or p_version <> v_row.version then raise exception 'La solicitud cambió. Recargá antes de continuar.' using errcode = 'SR004'; end if;
  if p_status is null or not ((v_row.status = 'recibida' and p_status = 'en_gestion') or (v_row.status = 'en_gestion' and p_status = 'cerrada')) then
    raise exception 'Transición no válida' using errcode = '22023';
  end if;
  update public.revocation_requests set status = p_status, version = version + 1, updated_at = clock_timestamp() where id = p_id;
  insert into public.revocation_events(request_id, actor_id, status) values(p_id, auth.uid(), p_status);
end;
$$;
revoke all on function public.admin_gestionar_arrepentimiento(uuid,integer,text) from public, anon, authenticated, service_role;
grant execute on function public.admin_gestionar_arrepentimiento(uuid,integer,text) to authenticated;
