-- El simulador guarda evidencia separada de la notificación. Solo postgres puede modificarla.
alter table private.mock_checkout_orders
  add column status text not null default 'created',
  add column status_detail text not null default 'created',
  add column paid_amount numeric(12,2) not null default 0,
  add column payment_id text,
  add column revision bigint not null default 1 check (revision between 1 and 9007199254740991);

alter table private.payment_attempts
  add column financial_state text check (financial_state in ('created','pending','processing','accredited','rejected','cancelled','expired','refunded','partially_refunded','disputed')),
  add column financial_revision bigint not null default 0;

create table private.payment_jobs (
  id uuid primary key default gen_random_uuid(),
  environment text not null default 'local_mock' check (environment = 'local_mock'),
  request_id text unique check (request_id ~ '^[A-Za-z0-9_-]{1,100}$'),
  notification_id text unique check (notification_id ~ '^[0-9]{1,24}$'),
  provider_order_id text check (provider_order_id ~ '^ORDMOCK[0-9a-f]{32}$'),
  event_type text check (event_type ~ '^order\.[a-z_]{1,40}$'),
  attempt_id uuid unique references private.payment_attempts(id) on delete cascade,
  received_at timestamptz not null default clock_timestamp(),
  state text not null default 'queued' check (state in ('queued','running','done','dead')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  next_at timestamptz not null default clock_timestamp(),
  lease uuid,
  lease_until timestamptz,
  last_error text check (last_error ~ '^[a-z_]{1,40}$'),
  result text check (result ~ '^[a-z_]{1,40}$'),
  resolved_at timestamptz,
  check ((attempt_id is null) = (request_id is not null)),
  check ((request_id is null) = (notification_id is null)),
  check ((request_id is null) = (provider_order_id is null)),
  check ((request_id is null) = (event_type is null)),
  check ((state = 'running') = (lease is not null and lease_until is not null)),
  check ((lease is null) = (lease_until is null)),
  check ((state in ('done','dead')) = (resolved_at is not null))
);
create index payment_jobs_due on private.payment_jobs(next_at, id) where state in ('queued','running');
create index payment_jobs_lease on private.payment_jobs(lease_until) where state = 'running';
create index payment_jobs_provider on private.payment_jobs(provider_order_id) where provider_order_id is not null;
alter table private.payment_jobs enable row level security;
revoke all on private.payment_jobs from public, anon, authenticated, service_role;

-- No se persisten el cuerpo, la firma ni el secreto. El mismo evento o request se confirma una sola vez.
create function public.recibir_notificacion_pago(p_request text, p_notification text, p_provider text, p_event text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  insert into private.payment_jobs(request_id,notification_id,provider_order_id,event_type)
    values (p_request,p_notification,p_provider,p_event) on conflict do nothing;
  if found then return true; end if;
  return exists (select 1 from private.payment_jobs
    where provider_order_id = p_provider and event_type = p_event
      and (request_id = p_request or notification_id = p_notification));
end;
$$;

create function private.mock_payment_evidence(p_order private.mock_checkout_orders)
returns jsonb language sql stable set search_path = '' as $$
  select jsonb_build_object('id', p_order.id, 'external_reference', p_order.external_reference,
    'total_amount', p_order.total_ars::text, 'total_paid_amount', p_order.paid_amount::text,
    'status', p_order.status, 'status_detail', p_order.status_detail, 'currency', 'ARS',
    'user_id', 'local-simulator', 'application_id', 'local-payment-app', 'live_mode', false,
    'revision', p_order.revision, 'payment_id', p_order.payment_id)
$$;

create or replace function public.buscar_order_pago_simulada(p_id text, p_reference text, p_begin timestamptz, p_end timestamptz)
returns jsonb language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_agg(private.mock_payment_evidence(m)), '[]')
  from private.mock_checkout_orders m
  where (p_id is not null and m.id = p_id)
     or (p_id is null and m.external_reference = p_reference and m.created_at between p_begin and p_end)
$$;

create function public.tomar_trabajos_pago()
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_job jsonb;
begin
  insert into private.payment_jobs(attempt_id)
    select a.id from private.payment_attempts a
    where (a.status in ('unknown','open') or a.lease_until <= clock_timestamp())
      and not exists (select 1 from private.payment_jobs j where j.attempt_id = a.id)
    order by a.created_at, a.id limit 20 on conflict do nothing;

  update private.payment_jobs set state = case when attempt_id is null then 'dead' else 'queued' end,
    lease = null, lease_until = null, next_at = clock_timestamp() + interval '15 minutes',
    resolved_at = case when attempt_id is null then clock_timestamp() end, last_error = 'lease_exhausted'
    where state = 'running' and lease_until <= clock_timestamp() and attempts >= 10;

  with due as (
    select id from private.payment_jobs
    where (state = 'queued' and next_at <= clock_timestamp())
       or (state = 'running' and lease_until <= clock_timestamp())
    order by next_at, id limit 1 for update skip locked
  ), claimed as (
    update private.payment_jobs j set state = 'running', lease = gen_random_uuid(),
      lease_until = clock_timestamp() + interval '30 seconds', attempts = least(10, attempts + 1)
    from due where j.id = due.id returning j.*
  )
  select jsonb_build_object('id',j.id,'lease',j.lease,'provider',coalesce(j.provider_order_id,a.provider_order_id),
    'reference',a.external_reference,'createdAt',a.created_at)
  into v_job from claimed j left join private.payment_attempts a on a.id = j.attempt_id;
  return v_job;
end;
$$;

create function public.resolver_trabajo_pago(p_id uuid,p_lease uuid,p_evidence jsonb,p_state text,p_error text,p_retry boolean)
returns text language plpgsql security definer set search_path = '' as $$
declare
  j private.payment_jobs;
  a private.payment_attempts;
  o public.orders;
  m private.mock_checkout_orders;
  v_result text;
  v_state text := 'done';
  v_delay interval := interval '1 minute';
  v_payment_ref text;
begin
  select * into j from private.payment_jobs where id = p_id and lease = p_lease and state = 'running'
    and lease_until > clock_timestamp() for update;
  if not found or j.lease_until <= clock_timestamp() then return 'stale'; end if;

  if p_error is not null then
    v_result := p_error;
    v_state := case when p_retry and (j.attempt_id is not null or j.attempts < 10) then 'queued' else 'dead' end;
    v_delay := make_interval(secs => least(900, 5 * (1 << least(j.attempts, 8))));
  else
    -- Bloqueo del pedido antes del intento, igual que la creación 5B y la liberación de reservas.
    select a0.* into a from private.payment_attempts a0 join private.mock_checkout_orders m0
      on m0.idempotency_key = a0.idempotency_key
      where m0.id = p_evidence->>'id'
        and (j.attempt_id is null or a0.id = j.attempt_id)
        and (j.provider_order_id is null or m0.id = j.provider_order_id);
    if not found then
      v_state := 'dead'; v_result := 'unlinked';
    else
      select * into o from public.orders where id = a.order_id for update;
      select * into a from private.payment_attempts where id = a.id for update;
      select * into m from private.mock_checkout_orders where id = p_evidence->>'id' for share;
      if j.lease_until <= clock_timestamp() then return 'stale'; end if;
      if not found or o.id is null or a.id is null then
        v_state := 'dead'; v_result := 'unlinked';
      elsif private.mock_payment_evidence(m) <> p_evidence then
        v_state := case when j.attempt_id is not null or j.attempts < 10 then 'queued' else 'dead' end;
        v_result := 'evidence_changed';
        if j.attempts >= 10 then v_delay := interval '15 minutes'; end if;
      elsif a.external_reference <> m.external_reference or a.total_ars <> m.total_ars or o.total_ars <> m.total_ars
         or (a.provider_order_id is not null and a.provider_order_id <> m.id) then
        v_state := 'dead'; v_result := 'identity_mismatch';
      elsif a.provider_order_id is null and a.lease_until > clock_timestamp() then
        v_state := case when j.attempt_id is not null or j.attempts < 10 then 'queued' else 'dead' end;
        v_result := 'creation_busy';
        if j.attempts >= 10 then v_delay := interval '15 minutes'; end if;
      elsif m.revision < a.financial_revision
         or (a.financial_state in ('accredited','refunded','partially_refunded','disputed')
             and p_state in ('created','pending','processing','rejected','cancelled','expired'))
         or (a.financial_state in ('refunded','partially_refunded','disputed') and p_state = 'accredited') then
        v_result := 'outdated';
      else
        if p_state = 'accredited' then
          if m.status <> 'processed' or m.status_detail <> 'accredited' or m.paid_amount <> o.total_ars
             or m.payment_id is null or m.payment_id !~ '^PAYMOCK[0-9a-f]{32}$' then
            v_state := 'dead'; v_result := 'invalid_accreditation';
          elsif o.payment_status = 'cancelled' then
            v_state := 'dead'; v_result := 'cancelled_order_paid';
          else
            v_payment_ref := 'local:' || m.payment_id;
            v_result := private.aplicar_pago(o.id,v_payment_ref,'approved',m.paid_amount);
          end if;
        elsif p_state = 'rejected' and m.status = 'failed' and m.payment_id ~ '^PAYMOCK[0-9a-f]{32}$' then
          v_result := private.aplicar_pago(o.id,'local:' || m.payment_id,'rejected',m.total_ars);
        else
          v_result := p_state;
        end if;
        if v_result is null or p_state not in ('created','pending','processing','accredited','rejected','cancelled','expired','refunded','partially_refunded','disputed') then
          v_state := 'dead'; v_result := 'unknown_state';
        elsif v_state <> 'dead' then
          update private.payment_attempts set status = 'open', provider_order_id = m.id, lease = null, lease_until = null,
            financial_state = p_state, financial_revision = m.revision, updated_at = clock_timestamp() where id = a.id;
          if p_state in ('refunded','partially_refunded','disputed') then
            v_state := 'dead';
          elsif p_state in ('created','pending','processing','rejected','cancelled','expired') and j.attempt_id is not null then
            if p_state in ('created','pending','processing') then
              v_state := 'queued';
              if j.received_at < clock_timestamp() - interval '7 days' then v_delay := interval '15 minutes'; end if;
            elsif j.received_at >= clock_timestamp() - interval '7 days' then
              v_state := 'queued';
            end if;
          end if;
        end if;
      end if;
    end if;
  end if;

  update private.payment_jobs set state = v_state, lease = null, lease_until = null,
    next_at = clock_timestamp() + v_delay,
    attempts = case when v_state = 'queued' and p_error is null and v_result not in ('creation_busy','evidence_changed') then 0 else attempts end,
    resolved_at = case when v_state in ('done','dead') then clock_timestamp() end,
    last_error = case when v_state = 'dead' or p_error is not null or v_result in ('creation_busy','evidence_changed') then v_result end,
    result = v_result where id = j.id;
  return v_result;
end;
$$;

create function public.estado_trabajos_pago()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('dead',count(*) filter (where state = 'dead'),
    'overdue',count(*) filter (where state = 'queued' and next_at < now() - interval '5 minutes'),
    'degraded_polls',count(*) filter (where state in ('queued','running') and attempt_id is not null
      and (attempts >= 10 or last_error = 'lease_exhausted'
        or (received_at < now() - interval '7 days' and result in ('created','pending','processing')))),
    'expired_leases',count(*) filter (where state = 'running' and lease_until <= now()))
  from private.payment_jobs
$$;

revoke all on function private.mock_payment_evidence(private.mock_checkout_orders),
  public.recibir_notificacion_pago(text,text,text,text), public.tomar_trabajos_pago(),
  public.resolver_trabajo_pago(uuid,uuid,jsonb,text,text,boolean),public.estado_trabajos_pago()
  from public,anon,authenticated,service_role;
grant execute on function public.recibir_notificacion_pago(text,text,text,text),public.tomar_trabajos_pago(),
  public.resolver_trabajo_pago(uuid,uuid,jsonb,text,text,boolean),public.estado_trabajos_pago() to service_role;
