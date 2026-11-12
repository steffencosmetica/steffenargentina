create table private.refund_requests (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  provider_order_id text not null,
  payment_id text,
  admin_id uuid not null,
  request_key uuid not null unique,
  provider_key uuid not null unique default gen_random_uuid(),
  kind text not null check (kind in ('full','partial')),
  cents bigint not null check (cents between 1 and 999999999999),
  transactions jsonb not null check (jsonb_typeof(transactions)='array'),
  reason text not null check (char_length(reason) between 8 and 400),
  state text not null default 'requested' check (state in ('requested','processing','confirmed','rejected','unknown')),
  lease uuid,
  lease_until timestamptz,
  provider_refund_id uuid unique,
  error text,
  created_at timestamptz not null default clock_timestamp(),
  resolved_at timestamptz,
  check ((kind = 'partial') = (payment_id is not null)),
  check ((state = 'processing') = (lease is not null)),
  check ((lease is null) = (lease_until is null)),
  check ((state in ('confirmed','rejected')) = (resolved_at is not null)),
  check (state <> 'confirmed' or provider_refund_id is not null)
);
create unique index refund_one_in_flight on private.refund_requests(order_id)
  where state in ('requested','processing','unknown');
create index refund_actor_rate on private.refund_requests(admin_id,created_at);

-- Ledger independiente del proveedor simulado. Una fila externa carece de clave local.
create table private.mock_refunds (
  id uuid primary key default gen_random_uuid(),
  provider_order_id text not null references private.mock_checkout_orders(id) on delete cascade,
  payment_id text not null,
  provider_key uuid unique,
  cents bigint not null check (cents between 1 and 999999999999),
  outcome text not null check (outcome in ('confirmed','rejected')),
  reason text,
  created_at timestamptz not null default clock_timestamp()
);
create index mock_refunds_order on private.mock_refunds(provider_order_id);
alter table private.mock_checkout_orders add column refund_balance_cents bigint check (refund_balance_cents >= 0);

create table private.mock_chargebacks (
  id uuid primary key default gen_random_uuid(),
  provider_order_id text not null references private.mock_checkout_orders(id) on delete cascade,
  payment_id text not null,
  seller text not null default 'local-simulator',
  currency text not null default 'ARS',
  live_mode boolean not null default false,
  cents bigint not null check (cents between 1 and 999999999999),
  impact_cents bigint not null default 0 check (impact_cents between 0 and cents),
  status text not null check (status in ('open','won','lost')),
  documentation text not null check (documentation in ('pending','review_pending','valid','invalid','not_supplied','not_applicable')),
  opened_at timestamptz not null default clock_timestamp(),
  deadline timestamptz,
  revision bigint not null default 1 check (revision > 0),
  check (status <> 'won' or impact_cents = 0),
  check (status <> 'lost' or impact_cents > 0)
);
create index mock_chargebacks_order on private.mock_chargebacks(provider_order_id);

create table private.observed_refunds (
  id uuid primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  provider_order_id text not null,
  payment_id text not null,
  request_id uuid references private.refund_requests(id) on delete cascade,
  cents bigint not null check (cents > 0),
  confirmed_at timestamptz not null
);
create index observed_refunds_order on private.observed_refunds(order_id);
create table private.chargeback_cases (
  id uuid primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  payment_id text not null,
  cents bigint not null check (cents between 1 and 999999999999),
  impact_cents bigint not null check (impact_cents between 0 and cents),
  status text not null check (status in ('open','won','lost')),
  documentation text not null check (documentation in ('pending','review_pending','valid','invalid','not_supplied','not_applicable')),
  opened_at timestamptz not null,
  deadline timestamptz,
  revision bigint not null check (revision>0),
  resolved_at timestamptz,
  check ((status='open')=(resolved_at is null)),
  check (status<>'won' or impact_cents=0),
  check (status<>'lost' or impact_cents>0)
);
create index chargeback_cases_order on private.chargeback_cases(order_id);
create index chargeback_cases_deadline on private.chargeback_cases(deadline) where status = 'open';

create table private.physical_returns (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  item_id uuid not null references public.order_items(id) on delete cascade,
  quantity integer not null check (quantity > 0),
  reason text not null check (char_length(reason) between 5 and 400),
  requested_at timestamptz not null default clock_timestamp(),
  received_at timestamptz,
  inspected_at timestamptz,
  state text not null default 'requested' check (state in ('requested','coordinated','received','inspected','resolved')),
  suitable integer,
  unsuitable integer,
  condition text,
  notes text check (char_length(notes)<=500),
  check ((state in ('received','inspected','resolved'))=(received_at is not null)),
  check ((state in ('inspected','resolved'))=(inspected_at is not null)),
  check ((inspected_at is not null)=(suitable is not null and unsuitable is not null and condition is not null)),
  check (suitable between 0 and quantity and unsuitable=quantity-suitable),
  check (condition in ('sealed','opened','used','damaged','mixed')),
  check (condition not in ('opened','used','damaged') or suitable=0)
);
create index physical_returns_order on private.physical_returns(order_id);
create table private.after_sales_events (
  id bigint generated always as identity primary key,
  order_id uuid not null references public.orders(id) on delete cascade,
  subject uuid not null,
  actor uuid,
  kind text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default clock_timestamp()
);
create index after_sales_events_order on private.after_sales_events(order_id,id);

alter table private.refund_requests enable row level security;
alter table private.mock_refunds enable row level security;
alter table private.mock_chargebacks enable row level security;
alter table private.observed_refunds enable row level security;
alter table private.chargeback_cases enable row level security;
alter table private.physical_returns enable row level security;
alter table private.after_sales_events enable row level security;
revoke all on private.refund_requests,private.mock_refunds,private.mock_chargebacks,private.observed_refunds,
  private.chargeback_cases,private.physical_returns,private.after_sales_events from public,anon,authenticated,service_role;
revoke all on sequence private.after_sales_events_id_seq from public,anon,authenticated,service_role;

-- El order lock precede a las lecturas del proveedor y las escrituras del ledger.
create function private.refundable_mock_order(p_order uuid)
returns private.mock_checkout_orders language sql stable set search_path='' as $$
  select m from public.orders o join private.payment_attempts a on a.order_id=o.id
    join private.mock_checkout_orders m on m.id=a.provider_order_id and m.idempotency_key=a.idempotency_key
    where o.id=p_order and o.payment_status='approved' and a.environment='local_mock'
      and a.seller_reference='local-simulator' and m.external_reference=o.code
      and m.total_ars=o.total_ars and m.paid_amount=o.total_ars and m.payment_id ~ '^PAYMOCK[0-9a-f]{32}$'
      and exists(select 1 from public.order_events e where e.order_id=o.id and e.payment_ref='local:'||m.payment_id
        and e.event_type in ('payment_approved','payment_approved_late'))
$$;

create function private.audit_refund_request()
returns trigger language plpgsql set search_path='' as $$
begin
  if tg_op='INSERT' or old.state is distinct from new.state or old.lease is distinct from new.lease then
    insert into private.after_sales_events(order_id,subject,actor,kind,details)
    values(new.order_id,new.id,coalesce(auth.uid(),new.admin_id),'refund_'||new.state,
      jsonb_build_object('cents',new.cents,'error',new.error,'provider_refund_id',new.provider_refund_id));
  end if;
  return new;
end;
$$;
create trigger refund_audit after insert or update on private.refund_requests
  for each row execute function private.audit_refund_request();

create function public.admin_solicitar_reembolso(p_order uuid,p_key uuid,p_kind text,p_payment text,
  p_cents bigint,p_expected bigint,p_reason text,p_confirm boolean,p_contact boolean)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  actor uuid := private.exigir_admin();
  o public.orders;
  m private.mock_checkout_orders;
  r private.refund_requests;
  refunded bigint;
  balance bigint;
begin
  if p_confirm is distinct from true or p_key is null or p_kind is null or p_kind not in ('full','partial')
     or p_reason is null or char_length(btrim(p_reason)) not between 8 and 400
     or (p_kind='full' and (p_cents is not null or p_payment is not null))
     or (p_kind='partial' and (p_cents is null or p_payment is null)) then
    raise exception 'refund_input' using errcode='22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('refund:'||actor::text,0));
  select * into o from public.orders where id=p_order for update;
  if not found then raise exception 'refund_unavailable' using errcode='55000'; end if;
  select * into r from private.refund_requests where request_key=p_key;
  if found then
    if r.order_id=p_order and r.admin_id=actor and r.kind=p_kind and r.reason=btrim(p_reason)
       and (p_kind='full' or (r.cents=p_cents and r.payment_id=p_payment)) then return r.id; end if;
    raise exception 'refund_conflict' using errcode='55000';
  end if;
  if (select count(*) from private.refund_requests where admin_id=actor and created_at>now()-interval '1 hour') >= 12 then
    raise exception 'refund_rate_limit' using errcode='55000';
  end if;
  if o.resolution_reason='stock_shortage' and p_contact is distinct from true then
    raise exception 'refund_contact_required' using errcode='55000';
  end if;
  select * into m from private.refundable_mock_order(p_order);
  if m.id is null or o.paid_at < now()-interval '180 days'
     or not ((m.status='processed' and m.status_detail in ('accredited','partially_refunded'))
       or (m.status='charged_back' and m.status_detail='reimbursed'
         and exists(select 1 from private.mock_chargebacks c where c.provider_order_id=m.id and c.status='won')))
     or exists(select 1 from private.mock_chargebacks c where c.provider_order_id=m.id and c.status in ('open','lost'))
     or exists(select 1 from private.refund_requests where order_id=p_order and state in ('requested','processing','unknown')) then
    raise exception 'refund_unavailable' using errcode='55000';
  end if;
  select coalesce(sum(cents),0) into refunded from private.mock_refunds where provider_order_id=m.id and outcome='confirmed';
  balance := (m.paid_amount*100)::bigint-refunded;
  if refunded is distinct from p_expected or balance<=0
     or (p_kind='partial' and (p_payment is distinct from m.payment_id or p_cents not between 1 and balance)) then
    raise exception 'refund_balance_changed' using errcode='55000';
  end if;
  insert into private.refund_requests(order_id,provider_order_id,payment_id,admin_id,request_key,kind,cents,reason,transactions)
    values(p_order,m.id,p_payment,actor,p_key,p_kind,coalesce(p_cents,balance),btrim(p_reason),
      jsonb_build_array(jsonb_build_object('id',m.payment_id,'paid',(m.paid_amount*100)::bigint,'refunded',refunded))) returning * into r;
  if o.resolution_reason='stock_shortage' then
    insert into private.after_sales_events(order_id,subject,actor,kind) values(p_order,r.id,actor,'buyer_contact_confirmed');
  end if;
  return r.id;
end;
$$;

create function public.admin_tomar_reembolso(p_order uuid,p_id uuid,p_confirm boolean)
returns jsonb language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid := private.exigir_admin();
  r private.refund_requests;
begin
  if p_confirm is distinct from true then raise exception 'refund_input' using errcode='22023'; end if;
  perform pg_advisory_xact_lock(hashtextextended('refund-claim:'||v_actor::text,0));
  perform 1 from public.orders where id=p_order for update;
  select * into r from private.refund_requests where id=p_id and order_id=p_order for update;
  if not found then raise exception 'refund_unavailable' using errcode='55000'; end if;
  if r.state in ('confirmed','rejected') or r.lease_until > clock_timestamp() then
    return jsonb_build_object('state',r.state);
  end if;
  if (select count(*) from private.after_sales_events where actor=v_actor and kind='refund_processing'
      and created_at>now()-interval '1 hour') >= 24 then
    raise exception 'refund_rate_limit' using errcode='55000';
  end if;
  update private.refund_requests set state='processing',lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '30 seconds',
    error=null where id=r.id returning * into r;
  return jsonb_build_object('state',r.state,'id',r.id,'key',r.provider_key,'lease',r.lease,'kind',r.kind,
    'provider',r.provider_order_id,'payment',r.payment_id,'cents',r.cents,'transactions',r.transactions);
end;
$$;

-- Transacción remota simulada. Repetir la misma clave nunca crea un segundo movimiento.
create function public.simular_reembolso_posventa(p_id uuid,p_key uuid,p_lease uuid,p_payload jsonb)
returns text language plpgsql security definer set search_path='' as $$
declare
  r private.refund_requests;
  m private.mock_checkout_orders;
  balance bigint;
  refunded bigint;
  failure text;
  prior text;
begin
  select * into r from private.refund_requests where id=p_id;
  if not found then return 'stale'; end if;
  perform 1 from public.orders where id=r.order_id for update;
  select * into r from private.refund_requests where id=p_id and provider_key=p_key and lease=p_lease
    and state='processing' and lease_until>clock_timestamp() for update;
  if not found then return 'stale'; end if;
  select outcome into prior from private.mock_refunds where provider_key=p_key;
  if found then return prior; end if;
  select * into m from private.mock_checkout_orders where id=r.provider_order_id for update;
  if m.id is null or (private.refundable_mock_order(r.order_id)).id is distinct from m.id
     or r.lease_until<=clock_timestamp() then return 'stale'; end if;
  if (r.kind='full' and p_payload is not null)
     or (r.kind='partial' and (r.payment_id is distinct from m.payment_id or p_payload is distinct from
        jsonb_build_object('transactions',jsonb_build_array(jsonb_build_object('id',r.payment_id,
          'amount',(r.cents::numeric/100)::numeric(12,2)::text))))) then return 'invalid_payload'; end if;
  select coalesce(sum(cents),0) into refunded from private.mock_refunds where provider_order_id=m.id and outcome='confirmed';
  balance := (m.paid_amount*100)::bigint-refunded;
  if exists(select 1 from private.mock_chargebacks c where c.provider_order_id=m.id and c.status in ('open','lost'))
    or not ((m.status='processed' and m.status_detail in ('accredited','partially_refunded'))
      or (m.status='charged_back' and m.status_detail='reimbursed'
        and exists(select 1 from private.mock_chargebacks c where c.provider_order_id=m.id and c.status='won'))) then
    failure := 'provider_order_blocked';
  elsif r.cents>balance or (r.kind='full' and r.cents<>balance) then
    failure := 'provider_balance_changed';
  elsif m.refund_balance_cents is not null and r.cents>m.refund_balance_cents then
    failure := 'provider_insufficient_funds';
  end if;
  insert into private.mock_refunds(provider_order_id,payment_id,provider_key,cents,outcome,reason)
    values(m.id,m.payment_id,p_key,r.cents,case when failure is null then 'confirmed' else 'rejected' end,failure);
  if failure is not null then return 'rejected'; end if;
  update private.mock_checkout_orders set
    status=case when r.cents=balance then 'refunded' else 'processed' end,
    status_detail=case when r.cents=balance then 'refunded' else 'partially_refunded' end,
    revision=revision+1,
    refund_balance_cents=refund_balance_cents-r.cents
    where id=m.id;
  return 'confirmed';
end;
$$;

-- La conciliación es de solo lectura sobre el proveedor. No invoca la operación de envío.
create function private.observe_after_sales(p_order uuid)
returns void language plpgsql set search_path='' as $$
declare
  m private.mock_checkout_orders;
  f private.mock_refunds;
  r private.refund_requests;
  c private.mock_chargebacks;
  previous private.chargeback_cases;
  paid bigint;
begin
  perform 1 from public.orders where id=p_order for update;
  select * into m from private.refundable_mock_order(p_order);
  if m.id is null then
    insert into private.after_sales_events(order_id,subject,kind)
      select p_order,a.id,'after_sales_evidence_mismatch' from private.payment_attempts a
      join public.orders o on o.id=a.order_id where a.order_id=p_order and a.environment='local_mock'
        and o.payment_status='approved' and not exists(select 1 from private.after_sales_events e
          where e.subject=a.id and e.kind='after_sales_evidence_mismatch');
    return;
  end if;
  paid := (m.paid_amount*100)::bigint;
  if exists(select 1 from private.mock_refunds where provider_order_id=m.id
     and payment_id is distinct from m.payment_id)
    or (select coalesce(sum(cents),0) from private.mock_refunds where provider_order_id=m.id and outcome='confirmed') > paid then
    insert into private.after_sales_events(order_id,subject,kind)
      select p_order,a.id,'refund_evidence_mismatch' from private.payment_attempts a where a.order_id=p_order
        and not exists(select 1 from private.after_sales_events e where e.subject=a.id and e.kind='refund_evidence_mismatch');
  else
    for f in select * from private.mock_refunds where provider_order_id=m.id order by created_at,id loop
      if exists(select 1 from private.observed_refunds v where v.id=f.id and
        (v.order_id<>p_order or v.payment_id<>f.payment_id or v.cents<>f.cents or f.outcome<>'confirmed')) then
        insert into private.after_sales_events(order_id,subject,kind)
          select p_order,f.id,'refund_evidence_mismatch'
          where not exists(select 1 from private.after_sales_events where subject=f.id and kind='refund_evidence_mismatch');
        continue;
      end if;
      select * into r from private.refund_requests where provider_key=f.provider_key and order_id=p_order;
      if f.provider_key is not null and (r.id is null or r.cents<>f.cents
          or r.provider_order_id<>f.provider_order_id or (r.payment_id is not null and r.payment_id<>f.payment_id)) then
        insert into private.after_sales_events(order_id,subject,kind)
          select p_order,f.id,'refund_evidence_mismatch'
          where not exists(select 1 from private.after_sales_events where subject=f.id and kind='refund_evidence_mismatch');
        continue;
      end if;
      if f.outcome='confirmed' then
        insert into private.observed_refunds(id,order_id,provider_order_id,payment_id,request_id,cents,confirmed_at)
          values(f.id,p_order,m.id,f.payment_id,r.id,f.cents,f.created_at) on conflict do nothing;
        if found and r.id is null then
          insert into private.after_sales_events(order_id,subject,kind,details)
            values(p_order,f.id,'refund_external',jsonb_build_object('cents',f.cents));
        end if;
      end if;
      if r.id is not null then
        update private.refund_requests set state=f.outcome,provider_refund_id=f.id,lease=null,lease_until=null,
          error=f.reason,resolved_at=f.created_at
          where id=r.id and state in ('requested','processing','unknown');
      end if;
    end loop;
  end if;
  -- Una caída sin respuesta no queda indefinidamente rotulada como ejecución activa.
  update private.refund_requests set state='unknown',lease=null,lease_until=null,error='lease_expired'
    where order_id=p_order and state='processing' and lease_until<=clock_timestamp();
  for c in select * from private.mock_chargebacks where provider_order_id=m.id loop
    select * into previous from private.chargeback_cases where id=c.id;
    if c.seller<>'local-simulator' or c.currency<>'ARS' or c.live_mode or c.payment_id<>m.payment_id or c.cents>paid
       or (previous.id is not null and (previous.order_id<>p_order or previous.payment_id<>c.payment_id or previous.cents<>c.cents)) then
      insert into private.after_sales_events(order_id,subject,kind)
        select p_order,c.id,'chargeback_evidence_mismatch'
        where not exists(select 1 from private.after_sales_events where subject=c.id and kind='chargeback_evidence_mismatch');
      continue;
    end if;
    if previous.id is not null and (previous.revision>=c.revision or (previous.status<>'open' and c.status='open')) then continue; end if;
    insert into private.chargeback_cases(id,order_id,payment_id,cents,impact_cents,status,documentation,opened_at,deadline,revision,resolved_at)
      values(c.id,p_order,c.payment_id,c.cents,c.impact_cents,c.status,c.documentation,c.opened_at,c.deadline,c.revision,
        case when c.status<>'open' then clock_timestamp() end)
      on conflict(id) do update set impact_cents=excluded.impact_cents,status=excluded.status,documentation=excluded.documentation,
        deadline=excluded.deadline,revision=excluded.revision,resolved_at=excluded.resolved_at;
    insert into private.after_sales_events(order_id,subject,kind,details) values(p_order,c.id,'chargeback_'||c.status,
      jsonb_build_object('revision',c.revision,'impact_cents',c.impact_cents,'documentation',c.documentation));
    if c.status in ('open','lost') and exists(select 1 from private.observed_refunds where order_id=p_order) then
      insert into private.after_sales_events(order_id,subject,kind)
        select p_order,c.id,'refund_chargeback_overlap'
        where not exists(select 1 from private.after_sales_events where subject=c.id and kind='refund_chargeback_overlap');
    end if;
  end loop;
end;
$$;

create function public.resolver_reembolso_posventa(p_id uuid,p_lease uuid,p_error text)
returns text language plpgsql security definer set search_path='' as $$
declare
  r private.refund_requests;
begin
  select * into r from private.refund_requests where id=p_id;
  if not found then return 'stale'; end if;
  perform 1 from public.orders where id=r.order_id for update;
  select * into r from private.refund_requests where id=p_id for update;
  if r.state in ('confirmed','rejected') then return r.state; end if;
  if r.lease is distinct from p_lease or r.lease_until is null or r.lease_until<=clock_timestamp() then return 'stale'; end if;
  perform private.observe_after_sales(r.order_id);
  select * into r from private.refund_requests where id=p_id;
  if r.state in ('confirmed','rejected') then return r.state; end if;
  update private.refund_requests set state='unknown',lease=null,lease_until=null,
    error=case when p_error in ('timeout','network','conflict','invalid_payload') then p_error else 'unknown_result' end where id=p_id;
  return 'unknown';
end;
$$;

create function private.observe_after_payment_job()
returns trigger language plpgsql set search_path='' as $$
declare
  order_id uuid;
begin
  if new.result in ('approved','approved_late','approved_shortage','already_applied','partially_refunded','refunded','disputed') then
    select a.order_id into order_id from private.payment_attempts a
      where a.id=new.attempt_id or a.provider_order_id=new.provider_order_id;
    if order_id is not null then perform private.observe_after_sales(order_id); end if;
  end if;
  return new;
end;
$$;
create trigger observe_after_payment_job after update of result on private.payment_jobs
  for each row execute function private.observe_after_payment_job();

create function public.admin_devolucion_fisica(p_order uuid,p_id uuid,p_item uuid,p_action text,p_quantity integer,
  p_reason text,p_suitable integer,p_condition text,p_notes text)
returns uuid language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid := private.exigir_admin();
  r private.physical_returns;
  sold integer;
  next_state text;
begin
  if p_id is null or p_action is null or char_length(coalesce(p_notes,''))>500 then
    raise exception 'return_input' using errcode='22023';
  end if;
  perform 1 from public.orders where id=p_order and fulfillment_status in ('shipped','delivered') for update;
  if not found then raise exception 'return_unavailable' using errcode='55000'; end if;
  select * into r from private.physical_returns where id=p_id and order_id=p_order;
  if p_action='request' then
    if r.id is not null then
      if r.item_id=p_item and r.quantity=p_quantity and r.reason=btrim(p_reason) then return r.id; end if;
      raise exception 'return_conflict' using errcode='55000';
    end if;
    select quantity into sold from public.order_items where id=p_item and order_id=p_order;
    if sold is null or p_quantity is null or p_quantity<1 or p_reason is null
       or char_length(btrim(p_reason)) not between 5 and 400
       or p_quantity + (select coalesce(sum(quantity),0) from private.physical_returns where item_id=p_item)>sold then
      raise exception 'return_input' using errcode='22023';
    end if;
    insert into private.physical_returns(id,order_id,item_id,quantity,reason,notes)
      values(p_id,p_order,p_item,p_quantity,btrim(p_reason),nullif(btrim(p_notes),'')) returning * into r;
  else
    next_state := case p_action when 'coordinate' then 'coordinated' when 'receive' then 'received'
      when 'inspect' then 'inspected' when 'resolve' then 'resolved' end;
    if r.id is null or next_state is null then raise exception 'return_unavailable' using errcode='55000'; end if;
    if r.state=next_state then
      if p_action='inspect' and (r.suitable is distinct from p_suitable or r.condition is distinct from p_condition) then
        raise exception 'return_conflict' using errcode='55000';
      end if;
      return r.id;
    end if;
    if not ((r.state='requested' and next_state='coordinated') or (r.state='coordinated' and next_state='received')
        or (r.state='received' and next_state='inspected') or (r.state='inspected' and next_state='resolved')) then
      raise exception 'return_conflict' using errcode='55000';
    end if;
    if p_action='inspect' and (p_suitable is null or p_suitable not between 0 and r.quantity
      or p_condition is null or p_condition not in ('sealed','opened','used','damaged','mixed')
      or (p_condition in ('opened','used','damaged') and p_suitable<>0)) then
      raise exception 'return_input' using errcode='22023';
    end if;
    update private.physical_returns set state=next_state,
      received_at=case when p_action='receive' then clock_timestamp() else received_at end,
      inspected_at=case when p_action='inspect' then clock_timestamp() else inspected_at end,
      condition=case when p_action='inspect' then p_condition else condition end,
      suitable=case when p_action='inspect' then p_suitable else suitable end,
      unsuitable=case when p_action='inspect' then quantity-p_suitable else unsuitable end,
      notes=coalesce(nullif(btrim(p_notes),''),notes)
      where id=p_id returning * into r;
  end if;
  insert into private.after_sales_events(order_id,subject,actor,kind,details)
    values(p_order,r.id,v_actor,'return_'||r.state,jsonb_build_object('quantity',r.quantity,'condition',r.condition,
      'suitable',r.suitable,'unsuitable',r.unsuitable,'notes',nullif(btrim(p_notes),'')));
  return r.id;
end;
$$;

create function public.admin_nota_contracargo(p_order uuid,p_case uuid,p_note text,p_reference text)
returns void language plpgsql security definer set search_path='' as $$
declare
  v_actor uuid := private.exigir_admin();
begin
  if p_note is null or char_length(btrim(p_note)) not between 5 and 500 or
     (p_reference is not null and p_reference !~ '^[A-Za-z0-9_./-]{1,120}$') then
    raise exception 'chargeback_input' using errcode='22023';
  end if;
  if not exists(select 1 from private.chargeback_cases where id=p_case and order_id=p_order) then
    raise exception 'chargeback_unavailable' using errcode='55000';
  end if;
  insert into private.after_sales_events(order_id,subject,actor,kind,details)
    values(p_order,p_case,v_actor,'chargeback_note',jsonb_build_object('note',btrim(p_note),'reference',p_reference));
end;
$$;

create function public.admin_ver_posventa(p_order uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare
  m private.mock_checkout_orders;
  refunded bigint;
  paid bigint;
  blocked boolean;
begin
  perform private.exigir_admin();
  select * into m from private.refundable_mock_order(p_order);
  select coalesce(sum(cents),0) into refunded from private.observed_refunds where order_id=p_order;
  select case when o.payment_status='approved' and exists(select 1 from public.order_events e
    where e.order_id=o.id and e.event_type in ('payment_approved','payment_approved_late'))
    then (o.total_ars*100)::bigint else 0 end into paid from public.orders o where o.id=p_order;
  paid := coalesce(paid,0);
  blocked := m.id is null or exists(select 1 from private.mock_chargebacks where provider_order_id=m.id and status in ('open','lost'))
    or exists(select 1 from private.refund_requests where order_id=p_order and state in ('requested','processing','unknown'));
  return jsonb_build_object('paid',paid,'refunded',refunded,'balance',greatest(0,paid-refunded),'blocked',blocked,
    'transactions',case when m.id is null then '[]'::jsonb else
      jsonb_build_array(jsonb_build_object('id',m.payment_id,'paid',paid,'refunded',refunded)) end,
    'requests', (select coalesce(jsonb_agg(to_jsonb(r)-'lease'-'provider_key'-'request_key'-'lease_until'-'transactions' order by created_at desc),'[]')
      from private.refund_requests r where order_id=p_order),
    'external', (select coalesce(jsonb_agg(to_jsonb(f) order by confirmed_at desc),'[]')
      from private.observed_refunds f where order_id=p_order and request_id is null),
    'returns', (select coalesce(jsonb_agg(to_jsonb(r) order by requested_at desc),'[]') from private.physical_returns r where order_id=p_order),
    'cases', (select coalesce(jsonb_agg(to_jsonb(c) order by opened_at desc),'[]') from private.chargeback_cases c where order_id=p_order),
    'events', (select coalesce(jsonb_agg(to_jsonb(e) order by e.id desc),'[]') from
      (select ev.* from private.after_sales_events ev where ev.order_id=p_order and
        (ev.kind like '%_mismatch' or ev.kind='refund_chargeback_overlap' or ev.id in
          (select recent.id from private.after_sales_events recent where recent.order_id=p_order order by recent.id desc limit 100))) e));
end;
$$;

create function public.admin_disputas_abiertas()
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  perform private.exigir_admin();
  return (select coalesce(jsonb_agg(to_jsonb(c) order by c.deadline nulls last),'[]') from (
    select c.id,c.order_id,o.code,c.cents,c.deadline,c.documentation from private.chargeback_cases c
    join public.orders o on o.id=c.order_id where c.status='open' order by c.deadline nulls last limit 30
  ) c);
end;
$$;

revoke all on function private.refundable_mock_order(uuid),private.audit_refund_request(),
  private.observe_after_sales(uuid),private.observe_after_payment_job(),
  public.admin_solicitar_reembolso(uuid,uuid,text,text,bigint,bigint,text,boolean,boolean),
  public.admin_tomar_reembolso(uuid,uuid,boolean),public.simular_reembolso_posventa(uuid,uuid,uuid,jsonb),
  public.resolver_reembolso_posventa(uuid,uuid,text),
  public.admin_devolucion_fisica(uuid,uuid,uuid,text,integer,text,integer,text,text),
  public.admin_nota_contracargo(uuid,uuid,text,text),public.admin_ver_posventa(uuid),public.admin_disputas_abiertas()
  from public,anon,authenticated,service_role;
grant execute on function public.admin_solicitar_reembolso(uuid,uuid,text,text,bigint,bigint,text,boolean,boolean),
  public.admin_tomar_reembolso(uuid,uuid,boolean),public.admin_devolucion_fisica(uuid,uuid,uuid,text,integer,text,integer,text,text),
  public.admin_nota_contracargo(uuid,uuid,text,text),public.admin_ver_posventa(uuid),public.admin_disputas_abiertas()
  to authenticated;
grant execute on function public.simular_reembolso_posventa(uuid,uuid,uuid,jsonb),public.resolver_reembolso_posventa(uuid,uuid,text)
  to service_role;

-- POLLING_POSVENTA: lectura periódica independiente del envío comercial.
create table private.after_sales_polls (
  order_id uuid primary key references public.orders(id) on delete cascade,
  next_at timestamptz not null default clock_timestamp(),
  lease uuid,
  lease_until timestamptz,
  failures integer not null default 0 check (failures>=0),
  error text,
  check ((lease is null)=(lease_until is null))
);
alter table private.after_sales_polls enable row level security;
revoke all on private.after_sales_polls from public,anon,authenticated,service_role;
create index after_sales_polls_due on private.after_sales_polls(next_at);

create function private.schedule_after_sales() returns trigger language plpgsql set search_path='' as $$
begin
  if new.event_type in ('payment_approved','payment_approved_late') then
    insert into private.after_sales_polls(order_id) values(new.order_id) on conflict do nothing;
  end if;
  return new;
end $$;
create trigger schedule_after_sales after insert on public.order_events
 for each row execute function private.schedule_after_sales();
insert into private.after_sales_polls(order_id)
 select distinct a.order_id from private.payment_attempts a join public.orders o on o.id=a.order_id
 where a.environment='local_mock' and o.payment_status='approved';

create function public.tomar_posventa_simulada() returns jsonb language plpgsql security definer set search_path='' as $$
declare p private.after_sales_polls;
begin
  select * into p from private.after_sales_polls where next_at<=clock_timestamp()
    and (lease_until is null or lease_until<=clock_timestamp()) order by next_at,order_id for update skip locked limit 1;
  if not found then return null; end if;
  update private.after_sales_polls set lease=gen_random_uuid(),lease_until=clock_timestamp()+interval '30 seconds'
    where order_id=p.order_id returning * into p;
  return jsonb_build_object('order',p.order_id,'lease',p.lease);
end $$;
create function public.resolver_posventa_simulada(p_order uuid,p_lease uuid) returns text
language plpgsql security definer set search_path='' as $$
declare p private.after_sales_polls;
begin
  perform 1 from public.orders where id=p_order for update;
  select * into p from private.after_sales_polls where order_id=p_order for update;
  if not found or p_lease is null or p.lease is null or p.lease_until is null
    or p.lease is distinct from p_lease or p.lease_until<=clock_timestamp() then return 'stale'; end if;
  begin
    perform private.observe_after_sales(p_order);
    update private.after_sales_polls set lease=null,lease_until=null,failures=0,error=null,
      next_at=clock_timestamp()+interval '15 minutes' where order_id=p_order;
    return 'observed';
  exception when others then
    update private.after_sales_polls set lease=null,lease_until=null,failures=failures+1,error='observation_failed',
      next_at=clock_timestamp()+least(interval '1 hour',interval '30 seconds'*power(2,least(failures,7))) where order_id=p_order;
    return 'observation_failed';
  end;
end $$;
create function public.estado_posventa_simulada() returns jsonb language sql stable security definer set search_path='' as $$
 select jsonb_build_object('degraded',(select count(*) from private.after_sales_polls where failures>=10),
  'unknown',(select count(*) from private.refund_requests where state='unknown'
    or (state='processing' and lease_until<=clock_timestamp())),
  'disputes',(select count(*) from private.chargeback_cases where status='open'),
  'incidents',(select count(*) from private.after_sales_events where kind like '%_mismatch' or kind='refund_chargeback_overlap'))
$$;
revoke all on function private.schedule_after_sales(),public.tomar_posventa_simulada(),
 public.resolver_posventa_simulada(uuid,uuid),public.estado_posventa_simulada() from public,anon,authenticated,service_role;
grant execute on function public.tomar_posventa_simulada(),public.resolver_posventa_simulada(uuid,uuid),
 public.estado_posventa_simulada() to service_role;
