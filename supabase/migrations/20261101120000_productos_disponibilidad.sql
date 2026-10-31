-- Paso 1 de 2 (aditivo): disponibilidad pública y lectura del stock exacto reservada a administradores.
-- No quita ningún permiso: el código que todavía lee stock sigue funcionando. El paso 2
-- (20261101120100_productos_stock_privado.sql) restringe las lecturas y se aplica recién cuando el
-- código que usa availability y admin_product_stock() está desplegado.

-- Disponibilidad pública, calculada por la base con los tres niveles que muestra la tienda:
-- disponible (más de 3), ultimas (1 a 3), sin-stock (0).
alter table public.products
  add column availability text generated always as (
    case
      when stock > 3 then 'disponible'
      when stock > 0 then 'ultimas'
      else 'sin-stock'
    end
  ) stored;

comment on column public.products.availability is
  'Disponibilidad pública derivada del stock: disponible (> 3), ultimas (1 a 3), sin-stock (0). El stock exacto no es público.';

-- Stock exacto para el panel. Los administradores usan el mismo rol de base (authenticated) que
-- cualquier usuario logueado, así que la restricción no puede ser por rol: esta función la hace por
-- persona, con is_admin(). security definer para leer la columna aunque authenticated ya no tenga
-- SELECT sobre ella (paso 2); search_path vacío para que no se pueda suplantar ninguna tabla.
create function public.admin_product_stock(p_ids uuid[] default null)
returns table (id uuid, stock integer)
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
    select p.id, p.stock
      from public.products p
     where p_ids is null or p.id = any (p_ids);
end;
$$;

comment on function public.admin_product_stock(uuid[]) is
  'Stock exacto de los productos indicados (o de todos). Solo administradores; cualquier otro recibe 42501.';

revoke all on function public.admin_product_stock(uuid[]) from public, anon, authenticated;
grant execute on function public.admin_product_stock(uuid[]) to authenticated, service_role;
