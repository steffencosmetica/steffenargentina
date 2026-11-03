-- Fase 4B.3 (1 de 2): configuración de la tienda, pedidos, artículos, eventos e intentos de checkout.
-- Solo estructura, reglas e invariantes. Las operaciones (crear, liberar, pagar, preparar) están en
-- 20261102130100_pedidos_funciones.sql. Ninguna de las dos habilita el checkout ni programa tareas.
--
-- Modelo de stock: products.stock es el stock DISPONIBLE para vender. Crear un pedido lo descuenta
-- (reserva); el pago aprobado consume la reserva sin volver a descontar; el vencimiento o la
-- cancelación lo devuelven exactamente una vez (orders.stock_state impide devolverlo dos veces).

-- ---------------------------------------------------------------------------
-- Esquema privado: no está expuesto por la API (config.toml solo expone public y graphql_public).
-- Guarda el secreto para los HMAC y las funciones internas.
-- ---------------------------------------------------------------------------

create schema private;
revoke all on schema private from public;
comment on schema private is 'Funciones y datos internos de la tienda. Sin acceso para anon, authenticated ni service_role.';

-- Una clave distinta por finalidad (nunca se reutiliza la misma clave para dos usos) y con versión,
-- para poder rotarlas sin invalidar lo ya emitido (ver supabase/docs/pedidos.md, "Rotación de claves").
create table private.app_secrets (
  name       text not null,
  version    smallint not null,
  value      bytea not null,
  active     boolean not null default true,
  created_at timestamptz not null default now(),
  primary key (name, version),
  constraint app_secrets_name_check check (name in ('ip_hash', 'order_token')),
  constraint app_secrets_version_check check (version > 0),
  constraint app_secrets_value_check check (octet_length(value) >= 32)
);

-- una sola versión activa por finalidad
create unique index app_secrets_active_key on private.app_secrets (name) where active;

comment on table private.app_secrets is
  'Claves HMAC generadas dentro de la base (cada entorno tiene las suyas). ip_hash: seudonimiza IPs para el antiabuso. order_token: deriva el token de consulta de los pedidos.';

-- 32 bytes de un generador criptográfico (pgcrypto/OpenSSL), propios de cada base: nunca están en el repositorio.
insert into private.app_secrets (name, version, value) values
  ('ip_hash', 1, extensions.gen_random_bytes(32)),
  ('order_token', 1, extensions.gen_random_bytes(32));

-- ---------------------------------------------------------------------------
-- Configuración de la tienda (una sola fila)
-- ---------------------------------------------------------------------------

create table public.store_settings (
  id                           boolean primary key default true,
  -- bloqueado hasta la Fase 5 (ver trigger store_settings_bloquear_checkout)
  checkout_enabled             boolean not null default false,
  reservation_minutes          integer not null default 30,
  max_units_per_product        integer not null default 5,
  max_units_per_order          integer not null default 20,
  max_pending_orders_per_email integer not null default 2,
  max_orders_per_ip_hour       integer not null default 5,
  -- intentos totales (creados, repetidos o rechazados) por IP y hora: frena el sondeo de stock y precios
  max_attempts_per_ip_hour     integer not null default 30,
  updated_at                   timestamptz not null default now(),

  constraint store_settings_singleton check (id),
  constraint store_settings_reservation_check check (reservation_minutes between 5 and 1440),
  constraint store_settings_units_product_check check (max_units_per_product between 1 and 100),
  constraint store_settings_units_order_check check (
    max_units_per_order between 1 and 500 and max_units_per_order >= max_units_per_product
  ),
  constraint store_settings_pending_email_check check (max_pending_orders_per_email between 1 and 20),
  constraint store_settings_orders_ip_check check (max_orders_per_ip_hour between 1 and 1000),
  constraint store_settings_attempts_ip_check check (
    max_attempts_per_ip_hour between 1 and 10000 and max_attempts_per_ip_hour >= max_orders_per_ip_hour
  )
);

comment on table public.store_settings is
  'Configuración de la tienda (fila única). Los límites los edita un administrador con admin_actualizar_limites(); checkout_enabled solo cambia por SQL de un superusuario (Fase 5).';

insert into public.store_settings (id) values (true);

create trigger store_settings_set_updated_at
  before update on public.store_settings
  for each row execute function public.set_updated_at();

-- checkout_enabled no se puede cambiar desde la API ni con service_role: solo postgres/supabase_admin
-- (migración o SQL Editor). La Fase 5 reemplaza este bloqueo por el procedimiento definitivo.
create function private.store_settings_bloquear_checkout()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.checkout_enabled is distinct from old.checkout_enabled
     and current_user not in ('postgres', 'supabase_admin') then
    raise exception 'checkout_enabled está bloqueado hasta la Fase 5' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger store_settings_bloquear_checkout
  before update on public.store_settings
  for each row execute function private.store_settings_bloquear_checkout();

-- ---------------------------------------------------------------------------
-- Pedidos
-- ---------------------------------------------------------------------------

create table public.orders (
  id                     uuid primary key default gen_random_uuid(),
  -- código legible para el comprador y el panel: STF-AAMM-XXXX (sin 0/O/1/I para dictarlo sin errores)
  code                   text not null,
  -- sha256 del token privado de consulta; el token nunca se guarda
  access_token_hash      bytea not null,
  -- versión de la clave order_token con la que se derivó (un reintento idempotente usa la misma)
  token_key_version      smallint not null,
  -- sha256 de la clave de idempotencia que generó el navegador; la clave tampoco se guarda
  idempotency_key_hash   bytea not null,
  -- sha256 del contenido normalizado del pedido: un reintento con la misma clave y otro contenido se rechaza
  request_fingerprint    bytea not null,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),

  -- comprador
  buyer_name             text not null,
  buyer_email            text not null,
  buyer_phone            text not null,
  buyer_document         text,

  -- dirección de entrega
  ship_street            text not null,
  ship_number            text not null,
  ship_unit              text,
  ship_city              text not null,
  ship_postal_code       text not null,
  ship_province_code     text not null references public.provinces (code) on delete restrict,
  ship_notes             text,

  -- envío: zona y tarifa tal como estaban al crear el pedido
  shipping_zone_id       uuid references public.shipping_zones (id) on delete set null,
  shipping_zone_name     text not null,
  shipping_rate_ars      numeric(12, 2) not null,
  shipping_free_from_ars numeric(12, 2),

  -- importes calculados por la base
  subtotal_ars           numeric(12, 2) not null,
  shipping_ars           numeric(12, 2) not null,
  total_ars              numeric(12, 2) not null,

  -- estados (ver transiciones en orders_validar_cambios)
  payment_status         text not null default 'pending',
  fulfillment_status     text not null default 'pending',
  resolution_status      text not null default 'none',
  resolution_reason      text,
  stock_state            text not null default 'reserved',

  reservation_expires_at timestamptz not null,
  paid_at                timestamptz,
  stock_released_at      timestamptz,
  cancelled_at           timestamptz,

  -- despacho
  dispatch_carrier       text,
  dispatch_tracking      text,
  dispatched_at          timestamptz,
  delivered_at           timestamptz,

  admin_notes            text,

  constraint orders_code_key unique (code),
  constraint orders_idempotency_key unique (idempotency_key_hash),
  constraint orders_code_check check (code ~ '^STF-[0-9]{4}-[2-9A-HJ-NP-Z]{4}$'),
  constraint orders_hashes_check check (
    octet_length(access_token_hash) = 32 and octet_length(idempotency_key_hash) = 32 and octet_length(request_fingerprint) = 32
  ),
  constraint orders_buyer_check check (
    char_length(buyer_name) between 2 and 120
    and char_length(buyer_email) between 3 and 254 and buyer_email = lower(buyer_email) and buyer_email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    and char_length(buyer_phone) between 6 and 30
    and (buyer_document is null or buyer_document ~ '^[0-9]{7,11}$')
  ),
  constraint orders_address_check check (
    char_length(ship_street) between 2 and 120
    and char_length(ship_number) between 1 and 10
    and (ship_unit is null or char_length(ship_unit) between 1 and 30)
    and char_length(ship_city) between 2 and 80
    and ship_postal_code ~ '^[A-Z]?[0-9]{4}[A-Z]{0,3}$'
    and (ship_notes is null or char_length(ship_notes) between 1 and 500)
  ),
  constraint orders_amounts_check check (
    subtotal_ars > 0 and shipping_ars >= 0 and shipping_rate_ars >= 0
    and (shipping_free_from_ars is null or shipping_free_from_ars > 0)
    and total_ars = subtotal_ars + shipping_ars
  ),
  constraint orders_payment_status_check check (payment_status in ('pending', 'approved', 'expired', 'cancelled')),
  constraint orders_fulfillment_status_check check (fulfillment_status in ('pending', 'preparing', 'shipped', 'delivered')),
  constraint orders_resolution_status_check check (resolution_status in ('none', 'pending', 'resolved')),
  constraint orders_resolution_reason_check check (
    (resolution_status = 'none') = (resolution_reason is null)
    and (resolution_reason is null or resolution_reason in ('stock_shortage', 'duplicate_payment', 'amount_mismatch'))
  ),
  constraint orders_stock_state_check check (stock_state in ('reserved', 'consumed', 'released', 'shortage')),

  -- invariantes entre estados: cualquier combinación incoherente es imposible de guardar
  -- pago pendiente ⇔ stock reservado
  constraint orders_pending_reserved_check check ((payment_status = 'pending') = (stock_state = 'reserved')),
  -- vencido o cancelado ⇒ el stock ya volvió
  constraint orders_released_check check (
    payment_status not in ('expired', 'cancelled') or (stock_state = 'released' and stock_released_at is not null)
  ),
  constraint orders_cancelled_at_check check ((payment_status = 'cancelled') = (cancelled_at is not null) or payment_status = 'approved'),
  -- aprobado ⇒ stock consumido o faltante (nunca reservado ni liberado)
  constraint orders_approved_check check (
    (payment_status = 'approved') = (paid_at is not null)
    and (payment_status <> 'approved' or stock_state in ('consumed', 'shortage'))
  ),
  -- un faltante de stock siempre queda pendiente de resolución
  constraint orders_shortage_check check (
    stock_state <> 'shortage' or (resolution_status = 'pending' and resolution_reason = 'stock_shortage')
  ),
  -- solo se prepara un pedido pagado con el stock consumido
  constraint orders_fulfillment_check check (
    fulfillment_status = 'pending' or (payment_status = 'approved' and stock_state = 'consumed')
  ),
  constraint orders_dispatch_check check (
    (fulfillment_status in ('shipped', 'delivered')) = (dispatched_at is not null)
    and (fulfillment_status = 'delivered') = (delivered_at is not null)
    and (dispatch_carrier is null or char_length(dispatch_carrier) between 1 and 80)
    and (dispatch_tracking is null or char_length(dispatch_tracking) between 1 and 120)
  ),
  constraint orders_admin_notes_check check (admin_notes is null or char_length(admin_notes) <= 2000)
);

comment on table public.orders is
  'Pedidos de la tienda. Solo se crean con crear_pedido() y solo cambian con las funciones de pedidos; nadie los escribe por la API.';
comment on column public.orders.stock_state is
  'reserved: unidades descontadas esperando pago. consumed: pago aprobado, unidades vendidas. released: unidades devueltas (exactamente una vez). shortage: pago aprobado sin stock para cubrirlo.';

create index orders_created_idx on public.orders (created_at desc);
create index orders_email_pending_idx on public.orders (buyer_email) where payment_status = 'pending';
create index orders_reservas_vencimiento_idx on public.orders (reservation_expires_at) where stock_state = 'reserved';
create index orders_resolucion_idx on public.orders (created_at) where resolution_status = 'pending';
create index orders_zone_idx on public.orders (shipping_zone_id);

create trigger orders_set_updated_at
  before update on public.orders
  for each row execute function public.set_updated_at();

-- Transiciones permitidas y columnas inmutables. Los CHECK de arriba validan cada estado por sí solo;
-- este trigger valida el paso de un estado al siguiente (aplica a todos, también a postgres).
create function private.orders_validar_cambios()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if (old.id, old.code, old.access_token_hash, old.token_key_version, old.idempotency_key_hash, old.request_fingerprint, old.created_at,
      old.buyer_name, old.buyer_email, old.buyer_phone, old.buyer_document,
      old.ship_street, old.ship_number, old.ship_unit, old.ship_city, old.ship_postal_code, old.ship_province_code, old.ship_notes,
      old.shipping_zone_name, old.shipping_rate_ars, old.shipping_free_from_ars,
      old.subtotal_ars, old.shipping_ars, old.total_ars, old.reservation_expires_at)
     is distinct from
     (new.id, new.code, new.access_token_hash, new.token_key_version, new.idempotency_key_hash, new.request_fingerprint, new.created_at,
      new.buyer_name, new.buyer_email, new.buyer_phone, new.buyer_document,
      new.ship_street, new.ship_number, new.ship_unit, new.ship_city, new.ship_postal_code, new.ship_province_code, new.ship_notes,
      new.shipping_zone_name, new.shipping_rate_ars, new.shipping_free_from_ars,
      new.subtotal_ars, new.shipping_ars, new.total_ars, new.reservation_expires_at) then
    raise exception 'Los datos e importes de un pedido no se pueden modificar' using errcode = 'SR002';
  end if;

  -- la zona solo puede desvincularse (on delete set null); el nombre y la tarifa históricos quedan
  if new.shipping_zone_id is distinct from old.shipping_zone_id and new.shipping_zone_id is not null then
    raise exception 'La zona de un pedido no se puede cambiar' using errcode = 'SR002';
  end if;

  if new.payment_status is distinct from old.payment_status and not (
       (old.payment_status = 'pending' and new.payment_status in ('approved', 'expired', 'cancelled'))
       -- pago acreditado después del vencimiento o de la cancelación
    or (old.payment_status in ('expired', 'cancelled') and new.payment_status = 'approved')
  ) then
    raise exception 'Transición de pago no permitida: % → %', old.payment_status, new.payment_status using errcode = 'SR002';
  end if;

  if new.stock_state is distinct from old.stock_state and not (
       (old.stock_state = 'reserved' and new.stock_state in ('consumed', 'released'))
    or (old.stock_state = 'released' and new.stock_state in ('consumed', 'shortage'))
    or (old.stock_state = 'shortage' and new.stock_state = 'consumed')
  ) then
    raise exception 'Transición de stock no permitida: % → %', old.stock_state, new.stock_state using errcode = 'SR002';
  end if;

  if new.fulfillment_status is distinct from old.fulfillment_status then
    if not (
         (old.fulfillment_status = 'pending' and new.fulfillment_status = 'preparing')
      or (old.fulfillment_status = 'preparing' and new.fulfillment_status in ('pending', 'shipped'))
      or (old.fulfillment_status = 'shipped' and new.fulfillment_status = 'delivered')
    ) then
      raise exception 'Transición de preparación no permitida: % → %', old.fulfillment_status, new.fulfillment_status using errcode = 'SR002';
    end if;
    if new.fulfillment_status <> 'pending' and new.resolution_status = 'pending' then
      raise exception 'El pedido tiene una resolución pendiente: no puede avanzar en la preparación' using errcode = 'SR002';
    end if;
  end if;

  if new.resolution_status is distinct from old.resolution_status and not (
       (old.resolution_status in ('none', 'resolved') and new.resolution_status = 'pending')
    or (old.resolution_status = 'pending' and new.resolution_status = 'resolved')
  ) then
    raise exception 'Transición de resolución no permitida: % → %', old.resolution_status, new.resolution_status using errcode = 'SR002';
  end if;

  return new;
end;
$$;

create trigger orders_validar_cambios
  before update on public.orders
  for each row execute function private.orders_validar_cambios();

-- ---------------------------------------------------------------------------
-- Artículos del pedido (precios y nombres históricos)
-- ---------------------------------------------------------------------------

create table public.order_items (
  id             uuid primary key default gen_random_uuid(),
  order_id       uuid not null references public.orders (id) on delete cascade,
  -- restrict: un producto vendido no se borra (el panel ofrece desactivarlo, ver src/lib/catalog/admin.ts)
  product_id     uuid not null references public.products (id) on delete restrict,
  sku            text not null,
  name           text not null,
  unit_price_ars numeric(12, 2) not null,
  quantity       integer not null,
  line_total_ars numeric(12, 2) not null,

  constraint order_items_product_key unique (order_id, product_id),
  constraint order_items_quantity_check check (quantity between 1 and 500),
  constraint order_items_price_check check (unit_price_ars >= 0),
  constraint order_items_total_check check (line_total_ars = unit_price_ars * quantity)
);

create index order_items_product_idx on public.order_items (product_id);

create function private.inmutable()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% es de solo inserción', tg_table_name using errcode = 'SR002';
end;
$$;

create trigger order_items_inmutable
  before update on public.order_items
  for each row execute function private.inmutable();

-- ---------------------------------------------------------------------------
-- Eventos del pedido (auditoría, sin datos personales)
-- ---------------------------------------------------------------------------

create table public.order_events (
  id            bigint generated always as identity primary key,
  order_id      uuid not null references public.orders (id) on delete cascade,
  created_at    timestamptz not null default now(),
  event_type    text not null,
  actor         text not null,
  actor_user_id uuid,
  -- id externo del pago (Fase 5: Mercado Pago). Junto con event_type, deduplica notificaciones repetidas.
  payment_ref   text,
  -- solo estados, cantidades e ids; nunca nombres, emails, teléfonos ni direcciones
  data          jsonb not null default '{}',

  constraint order_events_type_check check (event_type in (
    'created', 'reservation_expired', 'cancelled',
    'payment_approved', 'payment_approved_late', 'payment_rejected', 'payment_duplicate', 'payment_amount_mismatch',
    'stock_shortage', 'stock_shortage_resolved', 'resolution_resolved',
    'fulfillment_changed', 'notes_updated'
  )),
  constraint order_events_actor_check check (actor in ('checkout', 'system', 'admin', 'payment')),
  constraint order_events_admin_check check ((actor = 'admin') = (actor_user_id is not null)),
  constraint order_events_payment_ref_check check (payment_ref is null or payment_ref ~ '^[A-Za-z0-9_.:-]{1,64}$'),
  constraint order_events_data_check check (jsonb_typeof(data) = 'object')
);

create index order_events_order_idx on public.order_events (order_id, id);
create unique index order_events_payment_ref_key on public.order_events (payment_ref, event_type) where payment_ref is not null;

create trigger order_events_inmutable
  before update on public.order_events
  for each row execute function private.inmutable();

-- ---------------------------------------------------------------------------
-- Intentos de checkout (antiabuso)
-- ---------------------------------------------------------------------------
-- Registro mínimo: hash con clave secreta de la IP (nunca la IP), resultado y código de error.
-- Se purga a los 7 días con purgar_intentos_checkout().

create table public.checkout_attempts (
  id         bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  ip_hash    bytea not null,
  outcome    text not null,
  error_code text,
  order_id   uuid references public.orders (id) on delete set null,

  constraint checkout_attempts_ip_hash_check check (octet_length(ip_hash) = 32),
  constraint checkout_attempts_outcome_check check (outcome in ('created', 'replayed', 'rejected')),
  constraint checkout_attempts_error_check check ((outcome = 'rejected') = (error_code is not null))
);

create index checkout_attempts_ip_idx on public.checkout_attempts (ip_hash, created_at);
create index checkout_attempts_created_idx on public.checkout_attempts (created_at);

-- ---------------------------------------------------------------------------
-- Seguridad
-- ---------------------------------------------------------------------------
-- Nadie escribe estas tablas por la API: ni anon, ni authenticated, ni service_role. Todo pasa por
-- funciones security definer que validan permisos y transiciones. Los administradores solo leen
-- (RLS con is_admin()), y sin las columnas de hashes.

alter table public.store_settings enable row level security;
alter table public.orders enable row level security;
alter table public.order_items enable row level security;
alter table public.order_events enable row level security;
alter table public.checkout_attempts enable row level security;

revoke all on public.store_settings, public.orders, public.order_items, public.order_events, public.checkout_attempts
  from public, anon, authenticated, service_role;
revoke all on sequence public.order_events_id_seq, public.checkout_attempts_id_seq
  from public, anon, authenticated, service_role;

grant select on public.store_settings, public.order_items, public.order_events to authenticated;
grant select (
  id, code, created_at, updated_at,
  buyer_name, buyer_email, buyer_phone, buyer_document,
  ship_street, ship_number, ship_unit, ship_city, ship_postal_code, ship_province_code, ship_notes,
  shipping_zone_id, shipping_zone_name, shipping_rate_ars, shipping_free_from_ars,
  subtotal_ars, shipping_ars, total_ars,
  payment_status, fulfillment_status, resolution_status, resolution_reason, stock_state,
  reservation_expires_at, paid_at, stock_released_at, cancelled_at,
  dispatch_carrier, dispatch_tracking, dispatched_at, delivered_at, admin_notes
) on public.orders to authenticated;

create policy "store_settings: admin lee" on public.store_settings for select to authenticated using ((select public.is_admin()));
create policy "orders: admin lee" on public.orders for select to authenticated using ((select public.is_admin()));
create policy "order_items: admin lee" on public.order_items for select to authenticated using ((select public.is_admin()));
create policy "order_events: admin lee" on public.order_events for select to authenticated using ((select public.is_admin()));
-- checkout_attempts: RLS sin políticas y sin permisos: solo las funciones internas la usan.

revoke all on all tables in schema private from public, anon, authenticated, service_role;
revoke all on all functions in schema private from public, anon, authenticated, service_role;
