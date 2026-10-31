-- Zonas y tarifas de envío administrables desde /admin/envios.
-- Tarifa fija por zona, envío gratis opcional desde un importe, y cobertura por provincia:
-- una provincia pertenece como máximo a una zona; sin zona activa, no hay envío a ese destino.
-- Esta migración no crea zonas ni precios: los carga el administrador.

-- ---------------------------------------------------------------------------
-- Provincias (las 24 jurisdicciones, códigos ISO 3166-2:AR)
-- ---------------------------------------------------------------------------

create table public.provinces (
  code text primary key,
  name text not null unique,
  constraint provinces_code_check check (code ~ '^AR-[A-Z]$')
);

comment on table public.provinces is 'Jurisdicciones argentinas (ISO 3166-2:AR). Datos de referencia: no se editan desde la app.';

insert into public.provinces (code, name) values
  ('AR-C', 'Ciudad Autónoma de Buenos Aires'),
  ('AR-B', 'Buenos Aires'),
  ('AR-K', 'Catamarca'),
  ('AR-H', 'Chaco'),
  ('AR-U', 'Chubut'),
  ('AR-X', 'Córdoba'),
  ('AR-W', 'Corrientes'),
  ('AR-E', 'Entre Ríos'),
  ('AR-P', 'Formosa'),
  ('AR-Y', 'Jujuy'),
  ('AR-L', 'La Pampa'),
  ('AR-F', 'La Rioja'),
  ('AR-M', 'Mendoza'),
  ('AR-N', 'Misiones'),
  ('AR-Q', 'Neuquén'),
  ('AR-R', 'Río Negro'),
  ('AR-A', 'Salta'),
  ('AR-J', 'San Juan'),
  ('AR-D', 'San Luis'),
  ('AR-Z', 'Santa Cruz'),
  ('AR-S', 'Santa Fe'),
  ('AR-G', 'Santiago del Estero'),
  ('AR-V', 'Tierra del Fuego, Antártida e Islas del Atlántico Sur'),
  ('AR-T', 'Tucumán');

alter table public.provinces enable row level security;

-- lectura pública: el checkout necesita la lista de provincias
create policy "provinces: lectura pública"
  on public.provinces for select
  to anon, authenticated
  using (true);

revoke all on public.provinces from anon, authenticated;
grant select on public.provinces to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Zonas de envío
-- ---------------------------------------------------------------------------

create table public.shipping_zones (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  -- importes exactos en pesos argentinos, como products.price_ars
  price_ars     numeric(12, 2) not null,
  -- envío gratis cuando el subtotal alcanza este importe (opcional)
  free_from_ars numeric(12, 2),
  is_active     boolean not null default true,
  sort_order    integer not null default 0,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),

  constraint shipping_zones_name_key unique (name),
  constraint shipping_zones_name_check check (btrim(name) <> '' and char_length(name) <= 80),
  constraint shipping_zones_price_check check (price_ars >= 0),
  constraint shipping_zones_free_from_check check (free_from_ars is null or free_from_ars > 0)
);

create index shipping_zones_orden_idx on public.shipping_zones (sort_order, name);

create trigger shipping_zones_set_updated_at
  before update on public.shipping_zones
  for each row execute function public.set_updated_at();

-- Cobertura: la clave primaria por provincia garantiza que cada provincia esté en una sola zona.
-- on delete restrict: una zona con provincias no se puede borrar (hay que quitarle la cobertura
-- a propósito antes, con la advertencia del panel).
create table public.shipping_zone_provinces (
  province_code text primary key references public.provinces (code) on delete restrict,
  zone_id       uuid not null references public.shipping_zones (id) on delete restrict
);

create index shipping_zone_provinces_zone_idx on public.shipping_zone_provinces (zone_id);

-- ---------------------------------------------------------------------------
-- Seguridad: solo administradores leen y escriben la configuración.
-- El público cotiza con cotizar_envio() y ve la cobertura con provincias_cobertura().
-- ---------------------------------------------------------------------------

alter table public.shipping_zones enable row level security;
alter table public.shipping_zone_provinces enable row level security;

revoke all on public.shipping_zones, public.shipping_zone_provinces from anon, authenticated;
grant select, insert, update, delete on public.shipping_zones, public.shipping_zone_provinces to authenticated;

create policy "shipping_zones: admin lee"
  on public.shipping_zones for select to authenticated using ((select public.is_admin()));
create policy "shipping_zones: admin crea"
  on public.shipping_zones for insert to authenticated with check ((select public.is_admin()));
create policy "shipping_zones: admin edita"
  on public.shipping_zones for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "shipping_zones: admin borra"
  on public.shipping_zones for delete to authenticated using ((select public.is_admin()));

create policy "shipping_zone_provinces: admin lee"
  on public.shipping_zone_provinces for select to authenticated using ((select public.is_admin()));
create policy "shipping_zone_provinces: admin asigna"
  on public.shipping_zone_provinces for insert to authenticated with check ((select public.is_admin()));
create policy "shipping_zone_provinces: admin reasigna"
  on public.shipping_zone_provinces for update to authenticated
  using ((select public.is_admin())) with check ((select public.is_admin()));
create policy "shipping_zone_provinces: admin quita"
  on public.shipping_zone_provinces for delete to authenticated using ((select public.is_admin()));

-- ---------------------------------------------------------------------------
-- Asignación de provincias a una zona, en una sola transacción
-- ---------------------------------------------------------------------------
-- security invoker: corre con los permisos del administrador que la llama (RLS sigue aplicando);
-- además verifica is_admin() para dar un error claro. Reemplaza el conjunto completo de provincias
-- de la zona: si alguna pertenece a otra zona, solo se mueve con p_move = true; si no, falla sin
-- cambiar nada.

create function public.admin_set_zone_provinces(p_zone_id uuid, p_codes text[], p_move boolean default false)
returns table (added text[], removed text[], moved text[])
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_codes text[] := coalesce((select array_agg(distinct c order by c) from unnest(p_codes) c), '{}');
  v_unknown text[];
  v_taken text[];
begin
  if not public.is_admin() then
    raise exception 'Solo los administradores pueden configurar envíos' using errcode = '42501';
  end if;
  if not exists (select 1 from public.shipping_zones z where z.id = p_zone_id) then
    raise exception 'La zona no existe' using errcode = 'P0002';
  end if;

  select array_agg(c order by c) into v_unknown
    from unnest(v_codes) c
   where not exists (select 1 from public.provinces p where p.code = c);
  if v_unknown is not null then
    raise exception 'Provincias inválidas: %', array_to_string(v_unknown, ', ') using errcode = '22023';
  end if;

  select array_agg(zp.province_code order by zp.province_code) into v_taken
    from public.shipping_zone_provinces zp
   where zp.province_code = any (v_codes) and zp.zone_id <> p_zone_id;
  if v_taken is not null and not p_move then
    raise exception 'Provincias asignadas a otra zona: %', array_to_string(v_taken, ', ') using errcode = '23505';
  end if;

  select array_agg(zp.province_code order by zp.province_code) into removed
    from public.shipping_zone_provinces zp
   where zp.zone_id = p_zone_id and not (zp.province_code = any (v_codes));
  delete from public.shipping_zone_provinces zp
   where zp.zone_id = p_zone_id and not (zp.province_code = any (v_codes));

  moved := coalesce(v_taken, '{}');
  update public.shipping_zone_provinces zp set zone_id = p_zone_id where zp.province_code = any (moved);

  select array_agg(c order by c) into added
    from unnest(v_codes) c
   where not exists (select 1 from public.shipping_zone_provinces zp where zp.province_code = c);
  insert into public.shipping_zone_provinces (province_code, zone_id)
  select c, p_zone_id from unnest(coalesce(added, '{}')) c;

  added := coalesce(added, '{}');
  removed := coalesce(removed, '{}');
  return next;
end;
$$;

revoke all on function public.admin_set_zone_provinces(uuid, text[], boolean) from public, anon, authenticated;
grant execute on function public.admin_set_zone_provinces(uuid, text[], boolean) to authenticated, service_role;

-- Alta o edición de una zona junto con sus provincias, todo o nada: si la asignación falla
-- (provincia inválida, o de otra zona sin confirmar), la zona tampoco se crea ni se modifica.
-- p_id null crea la zona al final del orden. security invoker: RLS sigue aplicando.
create function public.admin_save_zone(
  p_id uuid,
  p_name text,
  p_price_ars numeric,
  p_free_from_ars numeric,
  p_is_active boolean,
  p_codes text[],
  p_move boolean default false
)
returns table (zone_id uuid, added text[], removed text[], moved text[])
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_id uuid := p_id;
begin
  if not public.is_admin() then
    raise exception 'Solo los administradores pueden configurar envíos' using errcode = '42501';
  end if;

  if v_id is null then
    insert into public.shipping_zones (name, price_ars, free_from_ars, is_active, sort_order)
    values (btrim(p_name), p_price_ars, p_free_from_ars, p_is_active,
            coalesce((select max(z.sort_order) from public.shipping_zones z), 0) + 10)
    returning id into v_id;
  else
    update public.shipping_zones z
       set name = btrim(p_name), price_ars = p_price_ars, free_from_ars = p_free_from_ars, is_active = p_is_active
     where z.id = v_id;
    if not found then
      raise exception 'La zona no existe' using errcode = 'P0002';
    end if;
  end if;

  zone_id := v_id;
  select r.added, r.removed, r.moved into added, removed, moved
    from public.admin_set_zone_provinces(v_id, coalesce(p_codes, '{}'), p_move) r;
  return next;
end;
$$;

revoke all on function public.admin_save_zone(uuid, text, numeric, numeric, boolean, text[], boolean) from public, anon, authenticated;
grant execute on function public.admin_save_zone(uuid, text, numeric, numeric, boolean, text[], boolean) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Cotización pública
-- ---------------------------------------------------------------------------
-- security definer porque el público no lee las tablas de configuración: la función devuelve solo
-- lo necesario para cotizar. search_path vacío y nombres calificados.
-- La futura transacción de creación de pedidos la reutiliza con el subtotal calculado en la base;
-- el subtotal que manda el navegador solo sirve para mostrar una estimación.

create function public.cotizar_envio(p_province_code text, p_subtotal_ars numeric)
returns table (
  has_coverage  boolean,
  zone_id       uuid,
  zone_name     text,
  rate_ars      numeric(12, 2),
  free_from_ars numeric(12, 2),
  is_free       boolean,
  cost_ars      numeric(12, 2)
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_zone public.shipping_zones%rowtype;
begin
  if p_province_code is null or not exists (select 1 from public.provinces p where p.code = p_province_code) then
    raise exception 'Provincia inválida' using errcode = '22023';
  end if;
  if p_subtotal_ars is null or p_subtotal_ars < 0 or p_subtotal_ars > 9999999999.99 or p_subtotal_ars <> round(p_subtotal_ars, 2) then
    raise exception 'Subtotal inválido' using errcode = '22023';
  end if;

  select z.* into v_zone
    from public.shipping_zone_provinces zp
    join public.shipping_zones z on z.id = zp.zone_id
   where zp.province_code = p_province_code and z.is_active;

  if not found then
    return query select false, null::uuid, null::text, null::numeric(12, 2), null::numeric(12, 2), false, null::numeric(12, 2);
    return;
  end if;

  return query select
    true,
    v_zone.id,
    v_zone.name,
    v_zone.price_ars,
    v_zone.free_from_ars,
    v_zone.free_from_ars is not null and p_subtotal_ars >= v_zone.free_from_ars,
    case when v_zone.free_from_ars is not null and p_subtotal_ars >= v_zone.free_from_ars then 0::numeric(12, 2) else v_zone.price_ars end;
end;
$$;

revoke all on function public.cotizar_envio(text, numeric) from public, anon, authenticated;
grant execute on function public.cotizar_envio(text, numeric) to anon, authenticated, service_role;

-- Provincias con y sin cobertura, para el selector del checkout (sin precios ni zonas).
create function public.provincias_cobertura()
returns table (code text, name text, has_coverage boolean)
language sql
stable
security definer
set search_path = ''
as $$
  select p.code, p.name,
         exists (select 1 from public.shipping_zone_provinces zp
                   join public.shipping_zones z on z.id = zp.zone_id
                  where zp.province_code = p.code and z.is_active)
    from public.provinces p
   order by p.name;
$$;

revoke all on function public.provincias_cobertura() from public, anon, authenticated;
grant execute on function public.provincias_cobertura() to anon, authenticated, service_role;
