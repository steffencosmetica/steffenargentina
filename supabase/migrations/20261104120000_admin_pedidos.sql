-- Control optimista común a todos los cambios, incluidos pagos y vencimientos.
alter table public.orders add column admin_version integer not null default 0;
grant select (admin_version) on public.orders to authenticated;

create function private.orders_incrementar_version() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.admin_version := old.admin_version + 1;
  return new;
end;
$$;
create trigger orders_incrementar_version before update on public.orders
for each row execute function private.orders_incrementar_version();
revoke all on function private.orders_incrementar_version() from public, anon, authenticated, service_role;

-- Bloquea, compara la versión y delega las reglas y la auditoría a las funciones de 4B.3.
create function public.admin_operar_pedido(
  p_order_id uuid, p_version integer, p_operation text,
  p_notes text default null, p_carrier text default null, p_tracking text default null,
  p_dispatched_at timestamptz default null
) returns void language plpgsql volatile security definer set search_path = '' as $$
declare v_order public.orders%rowtype;
begin
  perform private.exigir_admin();
  select * into v_order from public.orders where id = p_order_id for update;
  if not found then raise exception 'El pedido no existe' using errcode = 'P0002'; end if;
  if p_version is null or p_version <> v_order.admin_version then
    raise exception 'El pedido cambió. Recargá y revisá los datos antes de continuar.' using errcode = 'SR004';
  end if;
  case p_operation
    when 'notes' then perform public.admin_actualizar_notas(p_order_id, p_notes);
    when 'cancel' then perform public.admin_cancelar_pedido(p_order_id);
    when 'resolve_stock' then perform public.admin_resolver_faltante(p_order_id);
    when 'preparing', 'pending', 'shipped', 'delivered' then
      if p_operation = v_order.fulfillment_status then
        raise exception 'El estado ya cambió' using errcode = 'SR004';
      end if;
      if p_operation = 'shipped' and (p_dispatched_at is null or p_dispatched_at > clock_timestamp()
          or p_dispatched_at < coalesce(v_order.paid_at, v_order.created_at)) then
        raise exception 'Fecha de despacho inválida' using errcode = '22023';
      end if;
      perform public.admin_actualizar_preparacion(p_order_id, p_operation, p_carrier, p_tracking);
      if p_operation = 'shipped' then
        update public.orders set dispatched_at = p_dispatched_at where id = p_order_id;
      end if;
    else
      -- Resolver pagos/reembolsos requiere la integración de Fase 5.
      raise exception 'Operación no disponible' using errcode = '22023';
  end case;
end;
$$;
revoke all on function public.admin_operar_pedido(uuid, integer, text, text, text, text, timestamptz)
from public, anon, authenticated, service_role;
grant execute on function public.admin_operar_pedido(uuid, integer, text, text, text, text, timestamptz) to authenticated;

-- POST RPC: el texto de búsqueda no aparece en URLs de PostgREST ni del panel.
create function public.admin_listar_pedidos(p_filters jsonb, p_page integer default 1)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_result jsonb;
begin
  perform private.exigir_admin();
  if p_page is null or p_page < 1 or p_page > 999999 then raise exception 'Página inválida' using errcode = '22023'; end if;
  with filtered as (
    select id, code, created_at, buyer_name, buyer_email, total_ars, payment_status, fulfillment_status, resolution_status
    from public.orders o where
      (coalesce(p_filters->>'q', '') = '' or strpos(lower(o.code || ' ' || o.buyer_name || ' ' || o.buyer_email), lower(p_filters->>'q')) > 0)
      and (coalesce(p_filters->>'payment', '') = '' or o.payment_status = p_filters->>'payment')
      and (coalesce(p_filters->>'fulfillment', '') = '' or o.fulfillment_status = p_filters->>'fulfillment')
      and (coalesce(p_filters->>'resolution', '') = '' or o.resolution_status = p_filters->>'resolution')
      and (coalesce(p_filters->>'from', '') = '' or o.created_at >= ((p_filters->>'from')::date::timestamp at time zone 'America/Argentina/Buenos_Aires'))
      and (coalesce(p_filters->>'to', '') = '' or o.created_at < (((p_filters->>'to')::date + 1)::timestamp at time zone 'America/Argentina/Buenos_Aires'))
  ), page_rows as (select * from filtered order by created_at desc, id desc limit 20 offset (p_page - 1) * 20)
  select jsonb_build_object('rows', coalesce((select jsonb_agg(to_jsonb(r) order by created_at desc, id desc) from page_rows r), '[]'::jsonb),
    'count', (select count(*) from filtered),
    'to_prepare', (select count(*) from public.orders where payment_status = 'approved' and stock_state = 'consumed' and fulfillment_status = 'pending' and resolution_status <> 'pending'),
    'to_resolve', (select count(*) from public.orders where resolution_status = 'pending')) into v_result;
  return v_result;
end;
$$;
revoke all on function public.admin_listar_pedidos(jsonb, integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_listar_pedidos(jsonb, integer) to authenticated;
