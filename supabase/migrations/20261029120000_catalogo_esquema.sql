-- Catálogo de la tienda Steffen: administradores, categorías, productos e imágenes.
-- Venta al público general. Sin variantes: cada presentación es un producto con su propio SKU.

-- ---------------------------------------------------------------------------
-- Utilidades
-- ---------------------------------------------------------------------------

-- Mantiene updated_at al día en cada UPDATE
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- Administradores
-- ---------------------------------------------------------------------------
-- La autorización no depende de nada que mande el navegador: un usuario es administrador
-- solo si su id (verificado por Supabase Auth en el JWT) figura en esta tabla.
-- Las altas y bajas se hacen desde el SQL Editor o con la clave service_role, nunca desde la web.

create table public.admin_users (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  note       text,
  created_at timestamptz not null default now()
);

comment on table public.admin_users is
  'Usuarios de Supabase Auth autorizados a administrar el catálogo. Solo se modifica desde el servidor.';

alter table public.admin_users enable row level security;

-- cada usuario puede saber si él mismo es administrador; nadie puede ver ni tocar al resto
create policy "admin_users: ver el propio registro"
  on public.admin_users for select
  to authenticated
  using (user_id = (select auth.uid()));

revoke all on public.admin_users from anon, authenticated;
grant select on public.admin_users to authenticated;

-- ¿El usuario de la sesión actual es administrador?
-- security definer para poder consultar admin_users sin depender de sus políticas;
-- search_path vacío para que no se pueda suplantar ninguna tabla.
create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.admin_users a where a.user_id = (select auth.uid())
  );
$$;

revoke all on function public.is_admin() from public;
grant execute on function public.is_admin() to anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Categorías
-- ---------------------------------------------------------------------------

create table public.categories (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  slug        text not null,
  description text,
  -- ruta del archivo dentro del bucket "catalogo" (no una URL)
  image_path  text,
  sort_order  integer not null default 0,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),

  constraint categories_slug_key unique (slug),
  constraint categories_name_check check (btrim(name) <> ''),
  constraint categories_slug_check check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint categories_image_path_check check (
    image_path is null or (image_path !~ '^/' and image_path !~ '(^|/)\.\.(/|$)' and btrim(image_path) <> '')
  )
);

create index categories_listado_idx on public.categories (sort_order, name) where is_active;

create trigger categories_set_updated_at
  before update on public.categories
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Productos
-- ---------------------------------------------------------------------------

create table public.products (
  id                 uuid primary key default gen_random_uuid(),
  sku                text not null,
  name               text not null,
  slug               text not null,
  short_description  text,
  description        text,
  usage_instructions text,
  category_id        uuid not null references public.categories (id) on delete restrict,
  -- importe exacto en pesos argentinos (decimal, nunca punto flotante)
  price_ars          numeric(12, 2) not null,
  -- unidades disponibles para la venta
  stock              integer not null default 0,
  weight_grams       integer,
  -- medidas del paquete listo para enviar, en milímetros (opcionales)
  package_length_mm  integer,
  package_width_mm   integer,
  package_height_mm  integer,
  is_featured        boolean not null default false,
  is_active          boolean not null default true,
  sort_order         integer not null default 0,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),

  constraint products_slug_key unique (slug),
  constraint products_sku_check check (btrim(sku) = sku and sku <> ''),
  constraint products_name_check check (btrim(name) <> ''),
  constraint products_slug_check check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
  constraint products_price_check check (price_ars >= 0),
  constraint products_stock_check check (stock >= 0),
  constraint products_weight_check check (weight_grams is null or weight_grams > 0),
  constraint products_package_check check (
    (package_length_mm is null or package_length_mm > 0)
    and (package_width_mm is null or package_width_mm > 0)
    and (package_height_mm is null or package_height_mm > 0)
  )
);

-- el SKU es único sin distinguir mayúsculas ("STF-001" y "stf-001" serían el mismo)
create unique index products_sku_key on public.products (lower(sku));
create index products_category_idx on public.products (category_id);
create index products_listado_idx on public.products (sort_order, name) where is_active;
create index products_destacados_idx on public.products (sort_order) where is_active and is_featured;

create trigger products_set_updated_at
  before update on public.products
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Imágenes de productos
-- ---------------------------------------------------------------------------

create table public.product_images (
  id           uuid primary key default gen_random_uuid(),
  product_id   uuid not null references public.products (id) on delete cascade,
  -- ruta del archivo dentro del bucket "catalogo", por ejemplo "productos/<id>/frente.webp"
  storage_path text not null,
  sort_order   integer not null default 0,
  is_primary   boolean not null default false,
  alt_text     text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),

  constraint product_images_path_key unique (product_id, storage_path),
  constraint product_images_path_check check (
    storage_path !~ '^/' and storage_path !~ '(^|/)\.\.(/|$)' and btrim(storage_path) <> ''
  )
);

-- a lo sumo una imagen principal por producto
create unique index product_images_primary_key on public.product_images (product_id) where is_primary;
create index product_images_orden_idx on public.product_images (product_id, sort_order);

create trigger product_images_set_updated_at
  before update on public.product_images
  for each row execute function public.set_updated_at();

-- Marca una imagen como principal y desmarca las demás del mismo producto, en una sola operación.
-- security invoker: corre con los permisos de quien la llama, así que las políticas RLS
-- (solo administradores pueden modificar imágenes) siguen aplicando.
create or replace function public.set_primary_product_image(p_image_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_product_id uuid;
begin
  select product_id into v_product_id from public.product_images where id = p_image_id;
  if v_product_id is null then
    raise exception 'Imagen inexistente' using errcode = 'P0002';
  end if;

  update public.product_images set is_primary = false
   where product_id = v_product_id and is_primary and id <> p_image_id;
  update public.product_images set is_primary = true where id = p_image_id;

  if not found then
    raise exception 'Sin permiso para modificar la imagen' using errcode = '42501';
  end if;
end;
$$;

revoke all on function public.set_primary_product_image(uuid) from public;
grant execute on function public.set_primary_product_image(uuid) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Seguridad (RLS)
-- ---------------------------------------------------------------------------
-- Visitantes: solo leen categorías activas y productos activos de categorías activas.
-- Administradores (is_admin()): leen todo y pueden crear, editar, desactivar y borrar.

alter table public.categories enable row level security;
alter table public.products enable row level security;
alter table public.product_images enable row level security;

-- Visitantes y usuarios logueados sin rol de administrador no pueden escribir aunque
-- alguna política quedara mal: se les quitan los permisos de escritura a nivel de tabla.
revoke insert, update, delete, truncate on public.categories, public.products, public.product_images from anon;
revoke truncate on public.categories, public.products, public.product_images from authenticated;

-- categorías
create policy "categories: lectura pública de activas"
  on public.categories for select
  to anon, authenticated
  using (is_active or (select public.is_admin()));

create policy "categories: alta solo admin"
  on public.categories for insert
  to authenticated
  with check ((select public.is_admin()));

create policy "categories: edición solo admin"
  on public.categories for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "categories: baja solo admin"
  on public.categories for delete
  to authenticated
  using ((select public.is_admin()));

-- productos
create policy "products: lectura pública de activos"
  on public.products for select
  to anon, authenticated
  using (
    (is_active and exists (
      select 1 from public.categories c where c.id = category_id and c.is_active
    ))
    or (select public.is_admin())
  );

create policy "products: alta solo admin"
  on public.products for insert
  to authenticated
  with check ((select public.is_admin()));

create policy "products: edición solo admin"
  on public.products for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "products: baja solo admin"
  on public.products for delete
  to authenticated
  using ((select public.is_admin()));

-- imágenes: visibles si su producto es visible (la subconsulta ya aplica la política de products)
create policy "product_images: lectura pública de productos visibles"
  on public.product_images for select
  to anon, authenticated
  using (
    exists (select 1 from public.products p where p.id = product_id)
    or (select public.is_admin())
  );

create policy "product_images: alta solo admin"
  on public.product_images for insert
  to authenticated
  with check ((select public.is_admin()));

create policy "product_images: edición solo admin"
  on public.product_images for update
  to authenticated
  using ((select public.is_admin()))
  with check ((select public.is_admin()));

create policy "product_images: baja solo admin"
  on public.product_images for delete
  to authenticated
  using ((select public.is_admin()));
