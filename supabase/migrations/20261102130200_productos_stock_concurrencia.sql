-- Fase 4B.3: control de concurrencia optimista del stock entre el panel y las reservas.
--
-- Problema: el panel guarda el stock como valor absoluto. Si un comprador reserva unidades mientras el
-- administrador tiene el formulario abierto (stock 20 → 17), al guardar "20" se borraría la reserva.
--
-- Solución (la impone la base, no la interfaz):
--   * products.stock_version: aumenta en 1 con CADA cambio de stock, sea del panel o de una reserva,
--     liberación o pago.
--   * Para cambiar el stock desde la API (authenticated, service_role, anon) hay que enviar
--     stock_version = versión leída + 1. Si se omite, o si mientras tanto hubo otro cambio, el UPDATE falla
--     con SR003 (stock_conflict) y no modifica nada. Aplica a TODA vía de escritura: formulario completo,
--     edición rápida, cualquier código futuro o una llamada directa a la API.
--   * El UPDATE espera el bloqueo de fila que toma crear_pedido() (FOR UPDATE) y el trigger compara contra la
--     fila ya confirmada: las dos operaciones quedan serializadas y la comparación es atómica.
--   * Las funciones internas (security definer, rol postgres) incrementan la versión solas; el SQL Editor
--     (postgres) también puede corregir el stock sin versión, como operación manual consciente.
-- La regla stock >= 0 no cambia.

alter table public.products add column stock_version bigint not null default 0;

comment on column public.products.stock_version is
  'Versión del stock: +1 en cada cambio. Para cambiar el stock por la API hay que enviar stock_version = versión leída + 1 (control optimista, ver products_control_stock).';

create function private.products_control_stock()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.stock_version := 0;
    return new;
  end if;

  if new.stock is distinct from old.stock then
    if current_user in ('postgres', 'supabase_admin') then
      new.stock_version := old.stock_version + 1;
    elsif new.stock_version is distinct from old.stock_version + 1 then
      -- detalle para el panel (solo llega a quien pudo hacer el UPDATE, o sea un administrador)
      raise exception 'stock_conflict'
        using errcode = 'SR003',
              detail = jsonb_build_object('stock', old.stock, 'stock_version', old.stock_version)::text,
              hint = 'El stock cambió desde que se leyó. Volvé a leerlo y enviá stock_version = versión leída + 1.';
    end if;
  else
    -- sin cambio de stock la versión no se toca (ni se puede adelantar a mano)
    new.stock_version := old.stock_version;
  end if;
  return new;
end;
$$;

revoke all on function private.products_control_stock() from public, anon, authenticated, service_role;

create trigger products_control_stock
  before insert or update on public.products
  for each row execute function private.products_control_stock();

-- El panel lee el stock exacto y su versión juntos (misma fila, misma lectura).
-- Cambia el tipo de retorno: hay que recrearla.
drop function public.admin_product_stock(uuid[]);

create function public.admin_product_stock(p_ids uuid[] default null)
returns table (id uuid, stock integer, stock_version bigint)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo los administradores pueden consultar el stock exacto' using errcode = '42501';
  end if;
  return query
    select p.id, p.stock, p.stock_version
      from public.products p
     where p_ids is null or p.id = any (p_ids);
end;
$$;

comment on function public.admin_product_stock(uuid[]) is
  'Stock exacto y su versión (para el control optimista) de los productos indicados (o de todos). Solo administradores.';

revoke all on function public.admin_product_stock(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_product_stock(uuid[]) to authenticated, service_role;
