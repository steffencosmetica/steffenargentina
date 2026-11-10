create table private.payment_attempts (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null unique references public.orders(id) on delete cascade,
  idempotency_key uuid not null unique default gen_random_uuid(),
  environment text not null check (environment = 'local_mock'),
  seller_reference text not null check (seller_reference = 'local-simulator'),
  external_reference text not null unique,
  total_ars numeric(12,2) not null check (total_ars > 0),
  checkout_expires_at timestamptz not null,
  expiration_seconds integer not null check (expiration_seconds between 1 and 1800),
  status text not null check (status in ('creating', 'unknown', 'open')),
  provider_order_id text unique check (provider_order_id ~ '^ORDMOCK[0-9a-f]{32}$'),
  lease uuid,
  lease_until timestamptz,
  last_error text check (last_error in ('timeout', 'network', 'conflict', 'invalid_response', 'unavailable')),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  check ((status = 'open') = (provider_order_id is not null)),
  check ((status = 'creating') = (lease is not null and lease_until is not null)),
  check ((lease is null) = (lease_until is null))
);

create table private.payment_request_limits (
  ip_hash bytea primary key,
  window_start timestamptz not null,
  hits integer not null
);

-- Estado remoto simulado, con su propio commit, para reproducir pérdidas de respuesta.
create table private.mock_checkout_orders (
  id text primary key,
  idempotency_key uuid not null unique references private.payment_attempts(idempotency_key) on delete cascade,
  external_reference text not null unique,
  total_ars numeric(12,2) not null,
  created_at timestamptz not null default clock_timestamp()
);

alter table private.payment_attempts enable row level security;
alter table private.payment_request_limits enable row level security;
alter table private.mock_checkout_orders enable row level security;
revoke all on private.payment_attempts, private.payment_request_limits, private.mock_checkout_orders
  from public, anon, authenticated, service_role;

create function private.payment_order_eligible(p_order public.orders)
returns boolean language sql volatile set search_path = '' as $$
  select p_order.payment_status = 'pending'
     and p_order.stock_state = 'reserved'
     and p_order.fulfillment_status = 'pending'
     and p_order.resolution_status <> 'pending'
     and p_order.reservation_expires_at > clock_timestamp()
     and exists (select 1 from public.store_settings where id and checkout_enabled)
$$;

create function public.iniciar_intento_pago(p_code text, p_token text, p_client_ip inet)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_attempt private.payment_attempts;
  v_window timestamptz := date_trunc('minute', clock_timestamp());
  v_hits integer;
  v_recover boolean;
  v_deadline timestamptz;
  v_seconds integer;
begin
  if p_client_ip is null then return '{"status":"not_found"}'; end if;

  insert into private.payment_request_limits as limits values (private.hash_ip(p_client_ip), v_window, 1)
  on conflict (ip_hash) do update set window_start = greatest(limits.window_start, excluded.window_start),
    hits = case when limits.window_start >= excluded.window_start then least(limits.hits + 1, 61) else 1 end
  returning hits into v_hits;
  if v_hits > 60 then return '{"status":"rate_limited"}'; end if;

  if p_code is null or p_token is null or p_code !~ '^STF-[0-9]{4}-[2-9A-HJ-NP-Z]{4}$'
     or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return '{"status":"not_found"}';
  end if;
  select * into v_order from public.orders
    where code = p_code and access_token_hash = sha256(convert_to(p_token, 'UTF8')) for update;
  if not found then return '{"status":"not_found"}'; end if;
  if not private.payment_order_eligible(v_order) then return '{"status":"unavailable"}'; end if;

  select * into v_attempt from private.payment_attempts where order_id = v_order.id;
  v_recover := found;
  if v_recover then
    if v_attempt.checkout_expires_at <= clock_timestamp() then return '{"status":"unavailable"}'; end if;
    if v_attempt.status = 'open' then
      return jsonb_build_object('status', 'open', 'provider_order_id', v_attempt.provider_order_id);
    end if;
    if v_attempt.lease_until > clock_timestamp() then return '{"status":"busy"}'; end if;
    update private.payment_attempts set status = 'creating', lease = gen_random_uuid(),
      lease_until = clock_timestamp() + interval '20 seconds', updated_at = clock_timestamp()
      where id = v_attempt.id returning * into v_attempt;
  else
    v_deadline := v_order.reservation_expires_at - interval '30 seconds';
    v_seconds := floor(extract(epoch from v_deadline - clock_timestamp()));
    if v_seconds < 1 then return '{"status":"unavailable"}'; end if;
    insert into private.payment_attempts (order_id, environment, seller_reference, external_reference,
      total_ars, checkout_expires_at, expiration_seconds, status, lease, lease_until)
    values (v_order.id, 'local_mock', 'local-simulator', v_order.code, v_order.total_ars,
      v_deadline, v_seconds, 'creating', gen_random_uuid(), clock_timestamp() + interval '20 seconds')
    returning * into v_attempt;
  end if;

  return jsonb_build_object('status', 'creating', 'id', v_attempt.id, 'key', v_attempt.idempotency_key,
    'lease', v_attempt.lease, 'recover', v_recover, 'createdAt', v_attempt.created_at,
    'expirationSeconds', v_attempt.expiration_seconds, 'reference', v_attempt.external_reference,
    'total', v_attempt.total_ars::text, 'shipping', v_order.shipping_ars::text,
    'items', (select jsonb_agg(jsonb_build_object('title', name, 'quantity', quantity,
      'unitPrice', unit_price_ars::text) order by id) from public.order_items where order_id = v_order.id));
end;
$$;

create function public.finalizar_intento_pago(p_id uuid, p_lease uuid, p_provider_order_id text, p_error text)
returns boolean language plpgsql security definer set search_path = '' as $$
declare
  v_order public.orders;
  v_attempt private.payment_attempts;
begin
  select o.* into v_order from public.orders o join private.payment_attempts a on a.order_id = o.id
    where a.id = p_id for update of o;
  if not found then return false; end if;
  update private.payment_attempts set
    status = case when p_provider_order_id is null then 'unknown' else 'open' end,
    provider_order_id = p_provider_order_id, last_error = p_error,
    lease = null, lease_until = null, updated_at = clock_timestamp()
  where id = p_id and lease = p_lease and status = 'creating'
  returning * into v_attempt;
  return found and v_attempt.status = 'open' and v_attempt.checkout_expires_at > clock_timestamp()
    and private.payment_order_eligible(v_order);
end;
$$;

create function public.simular_order_pago(p_key uuid, p_lease uuid, p_reference text, p_total text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  v_attempt private.payment_attempts;
  v_order public.orders;
  v_id text;
begin
  select o.* into v_order from public.orders o join private.payment_attempts a on a.order_id = o.id
    where a.idempotency_key = p_key for update of o;
  if not found or not private.payment_order_eligible(v_order) then return null; end if;
  select * into v_attempt from private.payment_attempts where idempotency_key = p_key
    and lease = p_lease and lease_until > clock_timestamp() and checkout_expires_at > clock_timestamp()
    and external_reference = p_reference and total_ars::text = p_total;
  if not found then return null; end if;
  insert into private.mock_checkout_orders as mock (id, idempotency_key, external_reference, total_ars)
    values ('ORDMOCK' || replace(gen_random_uuid()::text, '-', ''), p_key, p_reference, v_attempt.total_ars)
    on conflict (idempotency_key) do nothing returning id into v_id;
  if v_id is null then
    select id into v_id from private.mock_checkout_orders where idempotency_key = p_key;
  end if;
  return v_id;
end;
$$;

create function public.buscar_order_pago_simulada(p_id text, p_reference text, p_begin timestamptz, p_end timestamptz)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(jsonb_build_object('id', id, 'external_reference', external_reference,
    'total_amount', total_ars::text, 'status', 'created', 'currency', 'ARS', 'user_id', 'local-simulator')), '[]')
  from private.mock_checkout_orders
  where (p_id is not null and id = p_id)
     or (p_id is null and external_reference = p_reference and created_at between p_begin and p_end)
$$;

revoke all on function private.payment_order_eligible(public.orders) from public, anon, authenticated, service_role;
revoke all on function public.iniciar_intento_pago(text,text,inet), public.finalizar_intento_pago(uuid,uuid,text,text),
  public.simular_order_pago(uuid,uuid,text,text), public.buscar_order_pago_simulada(text,text,timestamptz,timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.iniciar_intento_pago(text,text,inet), public.finalizar_intento_pago(uuid,uuid,text,text),
  public.simular_order_pago(uuid,uuid,text,text), public.buscar_order_pago_simulada(text,text,timestamptz,timestamptz)
  to service_role;
