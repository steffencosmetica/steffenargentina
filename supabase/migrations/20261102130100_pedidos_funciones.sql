-- Fase 4B.3 (2 de 2): creación transaccional de pedidos, reservas, vencimientos, pagos simulados,
-- operaciones del panel y consulta privada por token.
--
-- Convenciones
--   * Todas las funciones: search_path vacío, nombres calificados, sin SQL dinámico.
--   * Rechazos de negocio de crear_pedido(): SQLSTATE SR001, MESSAGE = código estable
--     (checkout_disabled, invalid_input, ...), DETAIL = jsonb. Se convierten en {status: 'rejected'}.
--   * Transición o modificación no permitida: SR002 (lo lanza el trigger orders_validar_cambios).
--   * Operaciones del panel sobre un pedido en un estado que no corresponde: 55000.
--
-- Orden de bloqueo (evita deadlocks): cada función toma los bloqueos en este orden y nunca vuelve atrás.
--   1. advisory(IP) → advisory(clave) → advisory(email)   solo crear_pedido; nadie más los usa
--   2. filas de orders                                     con SKIP LOCKED cuando son varias (nunca espera)
--   3. filas de products, por id ascendente, TODAS antes de modificar cualquiera (private.bloquear_productos)
--   Quien modifica stock de varios pedidos (vencimiento, liberación oportunista) bloquea primero la unión de
--   sus productos ordenada: así nunca toma P3 y después P1 mientras otro toma P1 y después P3.

-- ---------------------------------------------------------------------------
-- Claves HMAC (separadas por finalidad y versionadas)
-- ---------------------------------------------------------------------------

create function private.clave_activa(p_name text, out version smallint, out value bytea)
language sql
stable
set search_path = ''
as $$
  select s.version, s.value from private.app_secrets s where s.name = p_name and s.active;
$$;

create function private.clave(p_name text, p_version smallint)
returns bytea
language sql
stable
set search_path = ''
as $$
  select s.value from private.app_secrets s where s.name = p_name and s.version = p_version;
$$;

-- HMAC-SHA256 de la IP con la clave ip_hash: permite contar intentos por IP sin guardarla.
-- IPv6 se agrupa por /64 (lo que recibe normalmente un mismo cliente).
-- Sin clave activa falla de forma controlada (55000): nunca se calcula un hash sin secreto.
create function private.hash_ip(p_ip inet)
returns bytea
language plpgsql
stable
set search_path = ''
as $$
declare
  v_key bytea := (private.clave_activa('ip_hash')).value;
begin
  if v_key is null then
    raise exception 'Falta la clave activa ip_hash' using errcode = '55000';
  end if;
  return extensions.hmac(
    convert_to('stf-ip:v1:' || case when family(p_ip) = 6 then host(network(set_masklen(p_ip, 64))) || '/64' else host(p_ip) end, 'UTF8'),
    v_key,
    'sha256'
  );
end;
$$;

-- Token de consulta: HMAC (clave order_token) del id del pedido y la clave de idempotencia. Solo se puede
-- recalcular conociendo la clave de idempotencia (que la base guarda únicamente como hash), así un
-- reintento idempotente devuelve el mismo token sin que el token quede guardado en ningún lado.
create function private.token_pedido(p_order_id uuid, p_idempotency_key text, p_key_version smallint)
returns text
language plpgsql
stable
set search_path = ''
as $$
declare
  v_key bytea := private.clave('order_token', p_key_version);
begin
  if v_key is null then
    raise exception 'Falta la versión % de la clave order_token', p_key_version using errcode = '55000';
  end if;
  return rtrim(translate(encode(extensions.hmac(
    convert_to('stf-order-token:v1:' || p_order_id::text || ':' || p_idempotency_key, 'UTF8'), v_key, 'sha256'
  ), 'base64'), '+/', '-_'), '=');
end;
$$;

-- Bloquea productos en orden de id ascendente (sin duplicados). Toda función que vaya a modificar el stock
-- de más de un producto lo llama ANTES de tocar cualquiera.
create function private.bloquear_productos(p_ids uuid[])
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
begin
  for v_id in select distinct x from unnest(p_ids) x where x is not null order by 1 loop
    perform 1 from public.products p where p.id = v_id for update;
  end loop;
end;
$$;

-- Código STF-AAMM-XXXX. 32 símbolos → cada byte aleatorio % 32 es uniforme (256 = 8 × 32).
create function private.codigo_pedido()
returns text
language plpgsql
volatile
set search_path = ''
as $$
declare
  v_alfabeto constant text := '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
  v_bytes bytea := extensions.gen_random_bytes(4);
  v_sufijo text := '';
begin
  for i in 0..3 loop
    v_sufijo := v_sufijo || substr(v_alfabeto, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  return 'STF-' || to_char(now() at time zone 'America/Argentina/Buenos_Aires', 'YYMM') || '-' || v_sufijo;
end;
$$;

create function private.rechazar(p_code text, p_detail jsonb default '{}')
returns void
language plpgsql
set search_path = ''
as $$
begin
  raise exception '%', p_code using errcode = 'SR001', detail = p_detail::text;
end;
$$;

-- Texto opcional de un objeto jsonb: recortado y con espacios internos colapsados; null si falta o está vacío.
-- Si el valor existe y no es un string, lo marca como inválido devolviendo un valor imposible (control char).
create function private.json_texto(p_obj jsonb, p_key text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when p_obj -> p_key is null or jsonb_typeof(p_obj -> p_key) = 'null' then null
    when jsonb_typeof(p_obj -> p_key) <> 'string' then chr(1)
    else nullif(btrim(regexp_replace(p_obj ->> p_key, '[[:space:]]+', ' ', 'g')), '')
  end;
$$;

-- Valida y normaliza los datos del comprador, la dirección y los artículos.
-- Devuelve {buyer, shipping, items} normalizado o rechaza con invalid_input y la lista de campos.
create function private.normalizar_checkout(p_buyer jsonb, p_shipping jsonb, p_items jsonb)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_errores text[] := '{}';
  v_name text; v_email text; v_phone text; v_document text;
  v_street text; v_number text; v_unit text; v_city text; v_postal text; v_province text; v_notes text;
  v_items jsonb := '[]';
  v_item jsonb;
  v_ids uuid[] := '{}';
  v_id uuid;
begin
  if p_buyer is null or jsonb_typeof(p_buyer) <> 'object' then
    perform private.rechazar('invalid_input', jsonb_build_object('fields', jsonb_build_array('buyer')));
  end if;
  if p_shipping is null or jsonb_typeof(p_shipping) <> 'object' then
    perform private.rechazar('invalid_input', jsonb_build_object('fields', jsonb_build_array('shipping')));
  end if;
  if p_items is null or jsonb_typeof(p_items) <> 'array' then
    perform private.rechazar('invalid_input', jsonb_build_object('fields', jsonb_build_array('items')));
  end if;

  -- claves desconocidas: error de integración, se rechazan en lugar de ignorarse
  if exists (select 1 from jsonb_object_keys(p_buyer) k where k not in ('name', 'email', 'phone', 'document')) then
    v_errores := array_append(v_errores, 'buyer');
  end if;
  if exists (select 1 from jsonb_object_keys(p_shipping) k
              where k not in ('street', 'number', 'unit', 'city', 'postal_code', 'province_code', 'notes')) then
    v_errores := array_append(v_errores, 'shipping');
  end if;

  v_name := private.json_texto(p_buyer, 'name');
  v_email := lower(private.json_texto(p_buyer, 'email'));
  v_phone := private.json_texto(p_buyer, 'phone');
  v_document := regexp_replace(private.json_texto(p_buyer, 'document'), '[.[:space:]-]', '', 'g');
  v_street := private.json_texto(p_shipping, 'street');
  v_number := upper(private.json_texto(p_shipping, 'number'));
  v_unit := private.json_texto(p_shipping, 'unit');
  v_city := private.json_texto(p_shipping, 'city');
  v_postal := upper(replace(private.json_texto(p_shipping, 'postal_code'), ' ', ''));
  v_province := private.json_texto(p_shipping, 'province_code');
  v_notes := private.json_texto(p_shipping, 'notes');

  if v_name is null or char_length(v_name) not between 2 and 120 or v_name ~ '[[:cntrl:]]' then v_errores := array_append(v_errores, 'buyer.name'); end if;
  if v_email is null or char_length(v_email) > 254 or v_email !~ '^[^@[:space:][:cntrl:]]+@[^@[:space:][:cntrl:]]+\.[^@[:space:][:cntrl:]]+$' then
    v_errores := array_append(v_errores, 'buyer.email');
  end if;
  if v_phone is null or v_phone !~ '^\+?[0-9 ()-]{6,30}$' or char_length(regexp_replace(v_phone, '[^0-9]', '', 'g')) < 6 then
    v_errores := array_append(v_errores, 'buyer.phone');
  end if;
  if v_document is not null and v_document !~ '^[0-9]{7,11}$' then v_errores := array_append(v_errores, 'buyer.document'); end if;
  if v_street is null or char_length(v_street) not between 2 and 120 or v_street ~ '[[:cntrl:]]' then v_errores := array_append(v_errores, 'shipping.street'); end if;
  if v_number is null or v_number !~ '^[0-9A-Z/ -]{1,10}$' then v_errores := array_append(v_errores, 'shipping.number'); end if;
  if v_unit is not null and (char_length(v_unit) > 30 or v_unit ~ '[[:cntrl:]]') then v_errores := array_append(v_errores, 'shipping.unit'); end if;
  if v_city is null or char_length(v_city) not between 2 and 80 or v_city ~ '[[:cntrl:]]' then v_errores := array_append(v_errores, 'shipping.city'); end if;
  if v_postal is null or v_postal !~ '^[A-Z]?[0-9]{4}[A-Z]{0,3}$' then v_errores := array_append(v_errores, 'shipping.postal_code'); end if;
  if v_province is null or not exists (select 1 from public.provinces p where p.code = v_province) then
    v_errores := array_append(v_errores, 'shipping.province_code');
  end if;
  if v_notes is not null and (char_length(v_notes) > 500 or v_notes ~ '[[:cntrl:]]') then v_errores := array_append(v_errores, 'shipping.notes'); end if;

  -- artículos: 1 a 50 líneas {product_id: uuid, quantity: entero}, sin productos repetidos
  if jsonb_array_length(p_items) not between 1 and 50 then
    v_errores := array_append(v_errores, 'items');
  else
    for v_item in select value from jsonb_array_elements(p_items) loop
      if jsonb_typeof(v_item) <> 'object'
         or exists (select 1 from jsonb_object_keys(v_item) k where k not in ('product_id', 'quantity'))
         or jsonb_typeof(v_item -> 'product_id') is distinct from 'string'
         or (v_item ->> 'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
         or jsonb_typeof(v_item -> 'quantity') is distinct from 'number'
         or (v_item ->> 'quantity') !~ '^[0-9]{1,4}$'
         or (v_item ->> 'quantity')::integer < 1 then
        v_errores := array_append(v_errores, 'items');
        exit;
      end if;
      v_id := (v_item ->> 'product_id')::uuid;
      if v_id = any (v_ids) then
        v_errores := array_append(v_errores, 'items.duplicate');
        exit;
      end if;
      v_ids := v_ids || v_id;
      v_items := v_items || jsonb_build_object('product_id', v_id, 'quantity', (v_item ->> 'quantity')::integer);
    end loop;
  end if;

  if cardinality(v_errores) > 0 then
    perform private.rechazar('invalid_input', jsonb_build_object('fields', to_jsonb(v_errores)));
  end if;

  return jsonb_build_object(
    'buyer', jsonb_build_object('name', v_name, 'email', v_email, 'phone', v_phone, 'document', v_document),
    'shipping', jsonb_build_object('street', v_street, 'number', v_number, 'unit', v_unit, 'city', v_city,
                                   'postal_code', v_postal, 'province_code', v_province, 'notes', v_notes),
    -- ordenados por producto: mismo contenido ⇒ misma huella, y mismo orden de bloqueo
    'items', (select jsonb_agg(i order by (i ->> 'product_id')::uuid) from jsonb_array_elements(v_items) i)
  );
end;
$$;

-- Descuenta (reserva o vuelve a reservar) las unidades de un pedido existente. Bloquea todos sus productos
-- en orden de id antes de mirar el stock. Todo o nada: devuelve false sin tocar nada si alguno no alcanza.
create function private.descontar_stock_pedido(p_order_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_item record;
begin
  perform private.bloquear_productos(array(select oi.product_id from public.order_items oi where oi.order_id = p_order_id));
  if exists (select 1 from public.order_items oi join public.products p on p.id = oi.product_id
              where oi.order_id = p_order_id and p.stock < oi.quantity) then
    return false;
  end if;
  for v_item in select oi.product_id, oi.quantity from public.order_items oi where oi.order_id = p_order_id order by oi.product_id loop
    update public.products p set stock = p.stock - v_item.quantity where p.id = v_item.product_id;
  end loop;
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Liberación de reservas
-- ---------------------------------------------------------------------------

-- Devuelve el stock de UN pedido cuya fila y productos ya bloqueó el llamador. Vuelve a leer el estado:
-- si ya no está reservado (otro lo liberó o lo cobró), no hace nada y devuelve false. Así cada reserva se
-- libera exactamente una vez, sin importar cuántos procesos lo intenten.
create function private.liberar_pedido_bloqueado(p_order_id uuid, p_motivo text, p_actor text, p_actor_user_id uuid, p_via text)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
  v_item record;
  v_units integer := 0;
begin
  select * into v_order from public.orders o where o.id = p_order_id;
  if not found or v_order.stock_state <> 'reserved' then
    return false;
  end if;
  if p_motivo = 'expired' and v_order.reservation_expires_at > now() then
    return false;
  end if;

  for v_item in select oi.product_id, oi.quantity from public.order_items oi where oi.order_id = p_order_id order by oi.product_id loop
    update public.products p set stock = p.stock + v_item.quantity where p.id = v_item.product_id;
    v_units := v_units + v_item.quantity;
  end loop;

  update public.orders o
     set stock_state = 'released',
         stock_released_at = now(),
         payment_status = p_motivo,
         cancelled_at = case when p_motivo = 'cancelled' then now() end
   where o.id = p_order_id;

  insert into public.order_events (order_id, event_type, actor, actor_user_id, data)
  values (p_order_id, case when p_motivo = 'expired' then 'reservation_expired' else 'cancelled' end,
          p_actor, p_actor_user_id, jsonb_build_object('units_released', v_units, 'via', p_via));
  return true;
end;
$$;

-- Libera varios pedidos vencidos que el llamador ya bloqueó (FOR UPDATE SKIP LOCKED).
--   1. bloquea la unión de sus productos en orden de id (antes de modificar ninguno);
--   2. libera cada pedido en su propio subbloque: si uno falla (dato corrupto, trigger, etc.) se deshace
--      solo ese pedido, se informa con WARNING y los demás se liberan igual. El fallido sigue reservado y
--      vencido: lo reintenta la ejecución siguiente y lo muestra la consulta de monitoreo.
create function private.liberar_vencidos_bloqueados(p_order_ids uuid[], p_via text)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  v_id uuid;
  v_liberados integer := 0;
begin
  if coalesce(cardinality(p_order_ids), 0) = 0 then
    return 0;
  end if;
  perform private.bloquear_productos(array(select oi.product_id from public.order_items oi where oi.order_id = any (p_order_ids)));
  for v_id in select x from unnest(p_order_ids) x order by 1 loop
    begin
      if private.liberar_pedido_bloqueado(v_id, 'expired', 'system', null, p_via) then
        v_liberados := v_liberados + 1;
      end if;
    exception when others then
      raise warning 'No se pudo liberar la reserva del pedido %: % (%)', v_id, sqlerrm, sqlstate;
    end;
  end loop;
  return v_liberados;
end;
$$;

-- Libera un pedido (cancelación del panel). Bloquea el pedido, después sus productos en orden.
create function private.liberar_reserva(p_order_id uuid, p_motivo text, p_actor text, p_actor_user_id uuid default null)
returns boolean
language plpgsql
set search_path = ''
as $$
begin
  if p_motivo not in ('expired', 'cancelled') then
    raise exception 'Motivo inválido' using errcode = '22023';
  end if;
  perform 1 from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'El pedido no existe' using errcode = 'P0002';
  end if;
  perform private.bloquear_productos(array(select oi.product_id from public.order_items oi where oi.order_id = p_order_id));
  return private.liberar_pedido_bloqueado(p_order_id, p_motivo, p_actor, p_actor_user_id, p_actor);
end;
$$;

-- Tarea programada (pg_cron, cada minuto; ver supabase/scripts/pg_cron_pedidos.sql).
-- Toma hasta p_limite pedidos vencidos con SKIP LOCKED (dos ejecuciones simultáneas, una cancelación o un
-- pago en curso nunca procesan el mismo pedido) y los libera juntos. Si se acumularon más (pg_cron detenido),
-- cada ejecución avanza p_limite; además crear_pedido libera de forma oportunista los que la afectan.
create function public.liberar_reservas_vencidas(p_limite integer default 200)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_ids uuid[];
begin
  if p_limite is null or p_limite not between 1 and 1000 then
    raise exception 'Límite inválido (1 a 1000)' using errcode = '22023';
  end if;
  select array_agg(s.id) into v_ids
    from (select o.id from public.orders o
           where o.stock_state = 'reserved' and o.reservation_expires_at <= now()
           order by o.reservation_expires_at
           limit p_limite
             for update skip locked) s;
  return private.liberar_vencidos_bloqueados(v_ids, 'job');
end;
$$;

-- ---------------------------------------------------------------------------
-- crear_pedido()
-- ---------------------------------------------------------------------------
-- Lo llama SOLO el servidor de Next (service_role), que obtiene la IP del proxy de confianza
-- (ver supabase/docs/pedidos.md). Devuelve jsonb:
--   {status: 'created'|'replayed', order_id, code, token, subtotal_ars, shipping_ars, total_ars, reservation_expires_at}
--   {status: 'rejected', error: <código>, detail: {...}}
-- Cualquier solicitud con IP queda registrada en checkout_attempts, también las que fallan por un error
-- inesperado: crear_pedido nunca aborta la transacción por algo que dependa de lo que mande el cliente.

create function private.crear_pedido_tx(
  p_idempotency_key text,
  p_key_hash bytea,
  p_ip_hash bytea,
  p_cfg public.store_settings,
  p_buyer jsonb,
  p_shipping jsonb,
  p_items jsonb,
  p_expected_total_ars numeric
)
returns jsonb
language plpgsql
set search_path = ''
as $$
declare
  v_cfg public.store_settings := p_cfg;
  v_norm jsonb;
  v_fingerprint bytea;
  v_existing public.orders%rowtype;
  v_item jsonb;
  v_qty integer;
  v_total_units integer := 0;
  v_requested uuid[];
  v_vencidos uuid[];
  v_prod record;
  v_missing jsonb := '[]';
  v_unavailable jsonb := '[]';
  v_insufficient jsonb := '[]';
  v_lines jsonb := '[]';
  v_subtotal numeric(12, 2) := 0;
  v_quote record;
  v_total numeric(12, 2);
  v_order_id uuid := gen_random_uuid();
  v_code text;
  v_token_key smallint;
  v_token text;
  v_expires timestamptz;
  v_count integer;
  v_constraint text;
begin
  -- 1. checkout habilitado
  if not coalesce(v_cfg.checkout_enabled, false) then
    perform private.rechazar('checkout_disabled');
  end if;

  -- 2. datos del comprador y artículos
  v_norm := private.normalizar_checkout(p_buyer, p_shipping, p_items);
  if p_expected_total_ars is null or p_expected_total_ars <= 0 or p_expected_total_ars > 9999999999.99
     or p_expected_total_ars <> round(p_expected_total_ars, 2) then
    perform private.rechazar('invalid_input', jsonb_build_object('fields', jsonb_build_array('expected_total')));
  end if;

  -- 3. límites de cantidades
  for v_item in select value from jsonb_array_elements(v_norm -> 'items') loop
    v_qty := (v_item ->> 'quantity')::integer;
    if v_qty > v_cfg.max_units_per_product then
      perform private.rechazar('quantity_limit', jsonb_build_object('max_units_per_product', v_cfg.max_units_per_product,
                                                                     'product_id', v_item -> 'product_id'));
    end if;
    v_total_units := v_total_units + v_qty;
  end loop;
  if v_total_units > v_cfg.max_units_per_order then
    perform private.rechazar('quantity_limit', jsonb_build_object('max_units_per_order', v_cfg.max_units_per_order));
  end if;

  -- 4. idempotencia (IP y clave ya bloqueadas por crear_pedido: un solo pedido por clave a la vez)
  v_fingerprint := sha256(convert_to(jsonb_build_object('order', v_norm, 'expected_total', p_expected_total_ars::text)::text, 'UTF8'));
  select * into v_existing from public.orders o where o.idempotency_key_hash = p_key_hash;
  if found then
    if v_existing.request_fingerprint <> v_fingerprint then
      -- no se devuelve nada del pedido existente
      perform private.rechazar('idempotency_conflict');
    end if;
    return jsonb_build_object(
      'status', 'replayed',
      'order_id', v_existing.id,
      'code', v_existing.code,
      'token', private.token_pedido(v_existing.id, p_idempotency_key, v_existing.token_key_version),
      'subtotal_ars', v_existing.subtotal_ars,
      'shipping_ars', v_existing.shipping_ars,
      'total_ars', v_existing.total_ars,
      'reservation_expires_at', v_existing.reservation_expires_at
    );
  end if;

  -- 5. antiabuso. El límite de intentos por IP ya lo aplicó crear_pedido; acá: pedidos por IP y pedidos
  --    pendientes por email, serializados con advisory lock del email (la IP ya está bloqueada).
  perform pg_advisory_xact_lock(hashtextextended('stf:pedido:email:' || (v_norm #>> '{buyer,email}'), 0));
  select count(*) into v_count from public.checkout_attempts a
   where a.ip_hash = p_ip_hash and a.outcome = 'created' and a.created_at > now() - interval '1 hour';
  if v_count >= v_cfg.max_orders_per_ip_hour then
    perform private.rechazar('too_many_orders');
  end if;
  select count(*) into v_count from public.orders o
   where o.buyer_email = v_norm #>> '{buyer,email}' and o.payment_status = 'pending';
  if v_count >= v_cfg.max_pending_orders_per_email then
    perform private.rechazar('too_many_pending_orders', jsonb_build_object('max', v_cfg.max_pending_orders_per_email));
  end if;

  -- 6. liberación oportunista: si pg_cron no corrió, las reservas vencidas de estos productos vuelven al
  --    stock antes de verificarlo. Pedidos con SKIP LOCKED (nunca espera); después se bloquean JUNTOS, en
  --    orden de id, los productos pedidos y los de esos pedidos vencidos.
  v_requested := array(select (i ->> 'product_id')::uuid from jsonb_array_elements(v_norm -> 'items') i);
  select array_agg(s.id) into v_vencidos
    from (select o.id from public.orders o
           where o.stock_state = 'reserved' and o.reservation_expires_at <= now()
             and exists (select 1 from public.order_items oi where oi.order_id = o.id and oi.product_id = any (v_requested))
           order by o.reservation_expires_at
           limit 50
             for update skip locked) s;
  perform private.bloquear_productos(
    v_requested || array(select oi.product_id from public.order_items oi where oi.order_id = any (coalesce(v_vencidos, '{}')))
  );
  perform private.liberar_vencidos_bloqueados(v_vencidos, 'checkout');

  -- 7-9. productos (ya bloqueados): activo, categoría activa, stock y precio de la base
  for v_item in select value from jsonb_array_elements(v_norm -> 'items') loop
    v_qty := (v_item ->> 'quantity')::integer;
    select p.id, p.sku, p.name, p.price_ars, p.stock, p.is_active, c.is_active as category_active
      into v_prod
      from public.products p
      join public.categories c on c.id = p.category_id
     where p.id = (v_item ->> 'product_id')::uuid
       for update of p;
    if not found then
      v_missing := v_missing || (v_item -> 'product_id');
    elsif not (v_prod.is_active and v_prod.category_active) then
      v_unavailable := v_unavailable || (v_item -> 'product_id');
    elsif v_prod.stock < v_qty then
      -- no se informa cuántas unidades hay: el stock exacto es privado (Fase 4B.1)
      v_insufficient := v_insufficient || (v_item -> 'product_id');
    else
      v_lines := v_lines || jsonb_build_object('product_id', v_prod.id, 'sku', v_prod.sku, 'name', v_prod.name,
                                               'unit_price_ars', v_prod.price_ars, 'quantity', v_qty);
      v_subtotal := v_subtotal + v_prod.price_ars * v_qty;
    end if;
  end loop;
  if jsonb_array_length(v_missing) > 0 or jsonb_array_length(v_unavailable) > 0 then
    perform private.rechazar('product_unavailable', jsonb_build_object('product_ids', v_missing || v_unavailable));
  end if;
  if jsonb_array_length(v_insufficient) > 0 then
    perform private.rechazar('insufficient_stock', jsonb_build_object('product_ids', v_insufficient));
  end if;
  if v_subtotal <= 0 then
    perform private.rechazar('invalid_input', jsonb_build_object('fields', jsonb_build_array('items')));
  end if;

  -- 10. envío con la lógica de 4B.2, sobre el subtotal calculado por la base
  select * into v_quote from public.cotizar_envio(v_norm #>> '{shipping,province_code}', v_subtotal);
  if not v_quote.has_coverage then
    perform private.rechazar('no_shipping_coverage', jsonb_build_object('province_code', v_norm #>> '{shipping,province_code}'));
  end if;

  -- 11. el total tiene que coincidir con el que vio y aceptó el comprador
  v_total := v_subtotal + v_quote.cost_ars;
  if v_total <> p_expected_total_ars then
    perform private.rechazar('total_mismatch', jsonb_build_object(
      'subtotal_ars', v_subtotal, 'shipping_ars', v_quote.cost_ars, 'total_ars', v_total));
  end if;

  -- 12. reservar: descontar el stock (filas bloqueadas; el CHECK stock >= 0 es la última barrera)
  for v_item in select value from jsonb_array_elements(v_lines) loop
    update public.products p set stock = p.stock - (v_item ->> 'quantity')::integer
     where p.id = (v_item ->> 'product_id')::uuid;
  end loop;

  -- 13-14. pedido, artículos y evento
  v_expires := now() + make_interval(mins => v_cfg.reservation_minutes);
  v_token_key := (private.clave_activa('order_token')).version;
  v_token := private.token_pedido(v_order_id, p_idempotency_key, v_token_key);
  for i in 1..10 loop
    v_code := private.codigo_pedido();
    begin
      insert into public.orders (
        id, code, access_token_hash, token_key_version, idempotency_key_hash, request_fingerprint,
        buyer_name, buyer_email, buyer_phone, buyer_document,
        ship_street, ship_number, ship_unit, ship_city, ship_postal_code, ship_province_code, ship_notes,
        shipping_zone_id, shipping_zone_name, shipping_rate_ars, shipping_free_from_ars,
        subtotal_ars, shipping_ars, total_ars, reservation_expires_at
      ) values (
        v_order_id, v_code, sha256(convert_to(v_token, 'UTF8')), v_token_key, p_key_hash, v_fingerprint,
        v_norm #>> '{buyer,name}', v_norm #>> '{buyer,email}', v_norm #>> '{buyer,phone}', v_norm #>> '{buyer,document}',
        v_norm #>> '{shipping,street}', v_norm #>> '{shipping,number}', v_norm #>> '{shipping,unit}', v_norm #>> '{shipping,city}',
        v_norm #>> '{shipping,postal_code}', v_norm #>> '{shipping,province_code}', v_norm #>> '{shipping,notes}',
        v_quote.zone_id, v_quote.zone_name, v_quote.rate_ars, v_quote.free_from_ars,
        v_subtotal, v_quote.cost_ars, v_total, v_expires
      );
      exit;
    exception when unique_violation then
      -- solo se reintenta la colisión del código aleatorio; cualquier otra violación se propaga
      get stacked diagnostics v_constraint = constraint_name;
      if v_constraint is distinct from 'orders_code_key' or i = 10 then
        raise;
      end if;
    end;
  end loop;

  insert into public.order_items (order_id, product_id, sku, name, unit_price_ars, quantity, line_total_ars)
  select v_order_id, (l ->> 'product_id')::uuid, l ->> 'sku', l ->> 'name', (l ->> 'unit_price_ars')::numeric,
         (l ->> 'quantity')::integer, (l ->> 'unit_price_ars')::numeric * (l ->> 'quantity')::integer
    from jsonb_array_elements(v_lines) l;

  insert into public.order_events (order_id, event_type, actor, data)
  values (v_order_id, 'created', 'checkout', jsonb_build_object(
    'items', jsonb_array_length(v_lines), 'units', v_total_units, 'total_ars', v_total,
    'reservation_minutes', v_cfg.reservation_minutes));

  -- 15. código y token (el token solo viaja en esta respuesta)
  return jsonb_build_object(
    'status', 'created',
    'order_id', v_order_id,
    'code', v_code,
    'token', v_token,
    'subtotal_ars', v_subtotal,
    'shipping_ars', v_quote.cost_ars,
    'total_ars', v_total,
    'reservation_expires_at', v_expires
  );
end;
$$;

create function public.crear_pedido(
  p_idempotency_key text,
  p_buyer jsonb,
  p_shipping jsonb,
  p_items jsonb,
  p_expected_total_ars numeric,
  p_client_ip inet
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_cfg public.store_settings;
  v_key_hash bytea;
  v_ip_hash bytea;
  v_attempts integer;
  v_result jsonb;
  v_error text;
  v_detail text;
begin
  -- La IP la pone el servidor (proxy de confianza), nunca el comprador: si falta es un error de
  -- integración del servidor, no un intento. Es lo único que aborta sin registrar.
  if p_client_ip is null then
    raise exception 'Falta la IP del cliente' using errcode = '22023';
  end if;
  v_ip_hash := private.hash_ip(p_client_ip);

  -- El bloqueo de la IP se toma acá, fuera del subbloque, para que dure hasta el commit: el conteo de
  -- intentos y el registro de este intento quedan serializados por IP (ráfagas simultáneas incluidas).
  perform pg_advisory_xact_lock(hashtextextended('stf:pedido:ip:' || encode(v_ip_hash, 'hex'), 0));
  select * into v_cfg from public.store_settings s where s.id;

  select count(*) into v_attempts from public.checkout_attempts a
   where a.ip_hash = v_ip_hash and a.created_at > now() - interval '1 hour';

  if v_attempts >= v_cfg.max_attempts_per_ip_hour then
    -- no se hace ningún trabajo más: ni validar, ni bloquear productos
    v_result := jsonb_build_object('status', 'rejected', 'error', 'too_many_attempts', 'detail', '{}'::jsonb);
  elsif p_idempotency_key is null or p_idempotency_key !~ '^[A-Za-z0-9_-]{32,128}$' then
    v_result := jsonb_build_object('status', 'rejected', 'error', 'invalid_input',
                                   'detail', jsonb_build_object('fields', jsonb_build_array('idempotency_key')));
  else
    v_key_hash := sha256(convert_to(p_idempotency_key, 'UTF8'));
    -- doble clic y reintentos: las solicitudes con la misma clave se ejecutan de a una; la segunda espera
    -- a que la primera confirme y entonces encuentra el pedido (READ COMMITTED).
    perform pg_advisory_xact_lock(hashtextextended('stf:pedido:clave:' || encode(v_key_hash, 'hex'), 0));

    -- subbloque = savepoint: ante cualquier error se deshace TODO lo que hizo crear_pedido_tx (stock,
    -- pedido, artículos, liberaciones oportunistas) y solo queda registrado el intento.
    begin
      v_result := private.crear_pedido_tx(p_idempotency_key, v_key_hash, v_ip_hash, v_cfg, p_buyer, p_shipping, p_items, p_expected_total_ars);
    exception
      when sqlstate 'SR001' then
        get stacked diagnostics v_error = message_text, v_detail = pg_exception_detail;
        v_result := jsonb_build_object('status', 'rejected', 'error', v_error, 'detail', coalesce(nullif(v_detail, '')::jsonb, '{}'));
      when others then
        -- error inesperado (dato que rompe un cast, bug, deadlock): no se le muestra el mensaje al cliente;
        -- queda en el log de Postgres sin los datos del comprador ni la clave.
        raise warning 'crear_pedido: error inesperado % (%)', sqlstate, sqlerrm;
        v_result := jsonb_build_object('status', 'rejected', 'error', 'internal_error', 'detail', jsonb_build_object('sqlstate', sqlstate));
    end;
  end if;

  insert into public.checkout_attempts (ip_hash, outcome, error_code, order_id)
  values (
    v_ip_hash,
    v_result ->> 'status',
    case when v_result ->> 'status' = 'rejected' then v_result ->> 'error' end,
    case when v_result ->> 'status' = 'created' then (v_result ->> 'order_id')::uuid end
  );

  return v_result;
end;
$$;

comment on function public.crear_pedido(text, jsonb, jsonb, jsonb, numeric, inet) is
  'Crea un pedido y reserva su stock en una sola transacción. Solo service_role (servidor de Next). Ver supabase/docs/pedidos.md.';

comment on function public.liberar_reservas_vencidas(integer) is
  'Libera el stock de los pedidos con la reserva vencida y sin pago. Idempotente y segura bajo concurrencia. La ejecuta pg_cron.';

-- Purga de intentos de checkout viejos (retención mínima para el antiabuso).
create function public.purgar_intentos_checkout(p_dias integer default 7)
returns integer
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_borrados integer;
begin
  if p_dias is null or p_dias not between 1 and 90 then
    raise exception 'Días inválidos (1 a 90)' using errcode = '22023';
  end if;
  delete from public.checkout_attempts a where a.created_at < now() - make_interval(days => p_dias);
  get diagnostics v_borrados = row_count;
  return v_borrados;
end;
$$;

-- ---------------------------------------------------------------------------
-- Pagos (interno). En la Fase 5 lo invocará el webhook de Mercado Pago a través de un contenedor
-- público; ahora solo lo usan las pruebas (rol postgres) para simular resultados de pago.
-- ---------------------------------------------------------------------------
-- Resultado: approved | approved_late | approved_shortage | duplicate | amount_mismatch |
--            rejected_recorded | already_applied

create function private.aplicar_pago(p_order_id uuid, p_payment_ref text, p_status text, p_amount_ars numeric)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  if p_payment_ref is null or p_payment_ref !~ '^[A-Za-z0-9_.:-]{1,64}$' then
    raise exception 'Referencia de pago inválida' using errcode = '22023';
  end if;
  if p_status is null or p_status not in ('approved', 'rejected') then
    raise exception 'Estado de pago inválido' using errcode = '22023';
  end if;
  if p_amount_ars is null or p_amount_ars < 0 then
    raise exception 'Importe inválido' using errcode = '22023';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'El pedido no existe' using errcode = 'P0002';
  end if;

  -- notificación repetida del mismo pago: no hace nada (la fila del pedido está bloqueada, así que
  -- dos notificaciones simultáneas se ven en orden; el índice único es la barrera final)
  if exists (select 1 from public.order_events e where e.payment_ref = p_payment_ref
              and e.event_type in ('payment_approved', 'payment_approved_late', 'payment_duplicate', 'payment_amount_mismatch')) then
    return 'already_applied';
  end if;

  if p_status = 'rejected' then
    if exists (select 1 from public.order_events e where e.payment_ref = p_payment_ref and e.event_type = 'payment_rejected') then
      return 'already_applied';
    end if;
    insert into public.order_events (order_id, event_type, actor, payment_ref) values (p_order_id, 'payment_rejected', 'payment', p_payment_ref);
    return 'rejected_recorded';
  end if;

  if p_amount_ars <> v_order.total_ars then
    update public.orders o
       set resolution_status = 'pending',
           resolution_reason = case when o.resolution_status = 'pending' then o.resolution_reason else 'amount_mismatch' end
     where o.id = p_order_id;
    insert into public.order_events (order_id, event_type, actor, payment_ref, data)
    values (p_order_id, 'payment_amount_mismatch', 'payment', p_payment_ref,
            jsonb_build_object('amount_ars', p_amount_ars, 'total_ars', v_order.total_ars));
    return 'amount_mismatch';
  end if;

  -- segundo pago aprobado para un pedido ya cobrado: no cambia el stock; queda para reintegrar
  if v_order.payment_status = 'approved' then
    update public.orders o
       set resolution_status = 'pending',
           resolution_reason = case when o.resolution_status = 'pending' then o.resolution_reason else 'duplicate_payment' end
     where o.id = p_order_id;
    insert into public.order_events (order_id, event_type, actor, payment_ref, data)
    values (p_order_id, 'payment_duplicate', 'payment', p_payment_ref, jsonb_build_object('amount_ars', p_amount_ars));
    return 'duplicate';
  end if;

  -- pago a tiempo (aunque la reserva haya vencido, si todavía no se liberó las unidades siguen apartadas)
  if v_order.stock_state = 'reserved' then
    update public.orders o
       set payment_status = 'approved', stock_state = 'consumed', paid_at = now()
     where o.id = p_order_id;
    insert into public.order_events (order_id, event_type, actor, payment_ref, data)
    values (p_order_id, 'payment_approved', 'payment', p_payment_ref, jsonb_build_object('amount_ars', p_amount_ars));
    return 'approved';
  end if;

  -- pago después del vencimiento o la cancelación: el stock ya volvió; se intenta reservarlo de nuevo
  insert into public.order_events (order_id, event_type, actor, payment_ref, data)
  values (p_order_id, 'payment_approved_late', 'payment', p_payment_ref,
          jsonb_build_object('amount_ars', p_amount_ars, 'previous_status', v_order.payment_status));
  if private.descontar_stock_pedido(p_order_id) then
    update public.orders o
       set payment_status = 'approved', stock_state = 'consumed', paid_at = now()
     where o.id = p_order_id;
    return 'approved_late';
  end if;

  update public.orders o
     set payment_status = 'approved', stock_state = 'shortage', paid_at = now(),
         resolution_status = 'pending', resolution_reason = 'stock_shortage'
   where o.id = p_order_id;
  insert into public.order_events (order_id, event_type, actor) values (p_order_id, 'stock_shortage', 'system');
  return 'approved_shortage';
end;
$$;

-- ---------------------------------------------------------------------------
-- Operaciones del panel (solo administradores). Ninguna permite marcar un pedido como pagado
-- ni cambiar importes: el pago solo entra por aplicar_pago().
-- ---------------------------------------------------------------------------

create function private.exigir_admin()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Solo los administradores pueden operar pedidos' using errcode = '42501';
  end if;
  return auth.uid();
end;
$$;

-- Cancela un pedido sin pagar y devuelve su stock (exactamente una vez, aunque compita con el vencimiento).
create function public.admin_cancelar_pedido(p_order_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.exigir_admin();
begin
  if p_order_id is null then
    raise exception 'Pedido inválido' using errcode = '22023';
  end if;
  if not private.liberar_reserva(p_order_id, 'cancelled', 'admin', v_admin) then
    raise exception 'El pedido ya no tiene una reserva activa (pagado, vencido o cancelado)' using errcode = '55000';
  end if;
end;
$$;

-- Estado de preparación y datos de despacho.
create function public.admin_actualizar_preparacion(
  p_order_id uuid,
  p_status text,
  p_carrier text default null,
  p_tracking text default null
)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.exigir_admin();
  v_order public.orders%rowtype;
  v_carrier text := nullif(btrim(p_carrier), '');
  v_tracking text := nullif(btrim(p_tracking), '');
begin
  if p_order_id is null or p_status is null or p_status not in ('pending', 'preparing', 'shipped', 'delivered') then
    raise exception 'Datos inválidos' using errcode = '22023';
  end if;
  if (v_carrier is not null and (char_length(v_carrier) > 80 or v_carrier ~ '[[:cntrl:]]'))
     or (v_tracking is not null and (char_length(v_tracking) > 120 or v_tracking ~ '[[:cntrl:]]')) then
    raise exception 'Datos de despacho inválidos' using errcode = '22023';
  end if;

  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'El pedido no existe' using errcode = 'P0002';
  end if;
  if v_order.payment_status <> 'approved' or v_order.stock_state <> 'consumed' then
    raise exception 'Solo se prepara un pedido pagado y con stock' using errcode = '55000';
  end if;
  if v_order.resolution_status = 'pending' then
    raise exception 'El pedido tiene una resolución pendiente' using errcode = '55000';
  end if;
  if p_status = v_order.fulfillment_status then
    return;
  end if;
  if p_status = 'shipped' and v_carrier is null then
    raise exception 'Indicá el transporte para despachar' using errcode = '22023';
  end if;

  -- la transición en sí la valida orders_validar_cambios (SR002)
  update public.orders o
     set fulfillment_status = p_status,
         dispatch_carrier = case when p_status = 'shipped' then v_carrier else o.dispatch_carrier end,
         dispatch_tracking = case when p_status = 'shipped' then v_tracking else o.dispatch_tracking end,
         dispatched_at = case when p_status = 'shipped' then now() when p_status in ('pending', 'preparing') then null else o.dispatched_at end,
         delivered_at = case when p_status = 'delivered' then now() else null end
   where o.id = p_order_id;

  insert into public.order_events (order_id, event_type, actor, actor_user_id, data)
  values (p_order_id, 'fulfillment_changed', 'admin', v_admin,
          jsonb_build_object('from', v_order.fulfillment_status, 'to', p_status));
end;
$$;

-- Notas internas (el contenido no se copia al evento).
create function public.admin_actualizar_notas(p_order_id uuid, p_notes text)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.exigir_admin();
  v_notes text := nullif(btrim(p_notes), '');
begin
  if p_order_id is null or (v_notes is not null and char_length(v_notes) > 2000) then
    raise exception 'Datos inválidos' using errcode = '22023';
  end if;
  update public.orders o set admin_notes = v_notes where o.id = p_order_id;
  if not found then
    raise exception 'El pedido no existe' using errcode = 'P0002';
  end if;
  insert into public.order_events (order_id, event_type, actor, actor_user_id) values (p_order_id, 'notes_updated', 'admin', v_admin);
end;
$$;

-- Pedido pagado sin stock: cuando vuelve a haber unidades, el administrador lo resuelve consumiéndolas.
create function public.admin_resolver_faltante(p_order_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.exigir_admin();
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'El pedido no existe' using errcode = 'P0002';
  end if;
  if v_order.stock_state <> 'shortage' then
    raise exception 'El pedido no tiene faltante de stock' using errcode = '55000';
  end if;
  if not private.descontar_stock_pedido(p_order_id) then
    raise exception 'Todavía no hay stock suficiente para cubrir el pedido' using errcode = '55000';
  end if;
  update public.orders o set stock_state = 'consumed', resolution_status = 'resolved' where o.id = p_order_id;
  insert into public.order_events (order_id, event_type, actor, actor_user_id) values (p_order_id, 'stock_shortage_resolved', 'admin', v_admin);
end;
$$;

-- Cierra una resolución que no es de stock (pago duplicado reintegrado, importe revisado).
create function public.admin_marcar_resuelto(p_order_id uuid)
returns void
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_admin uuid := private.exigir_admin();
  v_order public.orders%rowtype;
begin
  select * into v_order from public.orders o where o.id = p_order_id for update;
  if not found then
    raise exception 'El pedido no existe' using errcode = 'P0002';
  end if;
  if v_order.resolution_status <> 'pending' then
    raise exception 'El pedido no tiene una resolución pendiente' using errcode = '55000';
  end if;
  if v_order.stock_state = 'shortage' then
    raise exception 'Un faltante de stock se resuelve con admin_resolver_faltante' using errcode = '55000';
  end if;
  update public.orders o set resolution_status = 'resolved' where o.id = p_order_id;
  insert into public.order_events (order_id, event_type, actor, actor_user_id, data)
  values (p_order_id, 'resolution_resolved', 'admin', v_admin, jsonb_build_object('reason', v_order.resolution_reason));
end;
$$;

-- Límites antiabuso y duración de la reserva. checkout_enabled no se toca desde acá.
create function public.admin_actualizar_limites(
  p_reservation_minutes integer,
  p_max_units_per_product integer,
  p_max_units_per_order integer,
  p_max_pending_orders_per_email integer,
  p_max_orders_per_ip_hour integer,
  p_max_attempts_per_ip_hour integer
)
returns public.store_settings
language plpgsql
volatile
security definer
set search_path = ''
as $$
declare
  v_row public.store_settings%rowtype;
begin
  perform private.exigir_admin();
  if p_reservation_minutes is null or p_max_units_per_product is null or p_max_units_per_order is null
     or p_max_pending_orders_per_email is null or p_max_orders_per_ip_hour is null or p_max_attempts_per_ip_hour is null then
    raise exception 'Todos los límites son obligatorios' using errcode = '22023';
  end if;
  -- los rangos los validan los CHECK de store_settings (23514)
  update public.store_settings s
     set reservation_minutes = p_reservation_minutes,
         max_units_per_product = p_max_units_per_product,
         max_units_per_order = p_max_units_per_order,
         max_pending_orders_per_email = p_max_pending_orders_per_email,
         max_orders_per_ip_hour = p_max_orders_per_ip_hour,
         max_attempts_per_ip_hour = p_max_attempts_per_ip_hour
   where s.id
  returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- Lecturas públicas
-- ---------------------------------------------------------------------------

-- Lo que el futuro checkout necesita saber de la configuración (sin límites antiabuso internos).
create function public.configuracion_checkout()
returns table (checkout_enabled boolean, reservation_minutes integer, max_units_per_product integer, max_units_per_order integer)
language sql
stable
security definer
set search_path = ''
as $$
  select s.checkout_enabled, s.reservation_minutes, s.max_units_per_product, s.max_units_per_order
    from public.store_settings s where s.id;
$$;

-- Seguimiento privado por código + token, para la futura página del comprador.
-- Sin nombre, email, teléfono, documento, calle ni notas: solo estado, artículos, importes y destino general.
-- Ante código o token incorrectos devuelve null (no distingue cuál falló). Solo service_role (servidor).
create function public.consultar_pedido(p_code text, p_token text)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_order public.orders%rowtype;
begin
  if p_code is null or p_token is null or p_code !~ '^STF-[0-9]{4}-[2-9A-HJ-NP-Z]{4}$' or p_token !~ '^[A-Za-z0-9_-]{43}$' then
    return null;
  end if;
  select * into v_order from public.orders o where o.code = p_code;
  if not found or v_order.access_token_hash <> sha256(convert_to(p_token, 'UTF8')) then
    return null;
  end if;

  return jsonb_build_object(
    'code', v_order.code,
    'created_at', v_order.created_at,
    'payment_status', v_order.payment_status,
    'fulfillment_status', v_order.fulfillment_status,
    'needs_attention', v_order.resolution_status = 'pending',
    'reservation_expires_at', case when v_order.stock_state = 'reserved' then v_order.reservation_expires_at end,
    'subtotal_ars', v_order.subtotal_ars,
    'shipping_ars', v_order.shipping_ars,
    'total_ars', v_order.total_ars,
    'destination', jsonb_build_object(
      'city', v_order.ship_city,
      'province', (select p.name from public.provinces p where p.code = v_order.ship_province_code)
    ),
    'dispatch', case when v_order.dispatched_at is null then null else jsonb_build_object(
      'carrier', v_order.dispatch_carrier, 'tracking', v_order.dispatch_tracking,
      'dispatched_at', v_order.dispatched_at, 'delivered_at', v_order.delivered_at) end,
    'items', (select jsonb_agg(jsonb_build_object(
                'sku', oi.sku, 'name', oi.name, 'unit_price_ars', oi.unit_price_ars,
                'quantity', oi.quantity, 'line_total_ars', oi.line_total_ars) order by oi.name, oi.sku)
                from public.order_items oi where oi.order_id = v_order.id)
  );
end;
$$;

-- ---------------------------------------------------------------------------
-- Permisos de ejecución (Supabase otorga EXECUTE a anon y authenticated por defecto en public)
-- ---------------------------------------------------------------------------

revoke all on all functions in schema private from public, anon, authenticated, service_role;

revoke all on function public.crear_pedido(text, jsonb, jsonb, jsonb, numeric, inet) from public, anon, authenticated, service_role;
grant execute on function public.crear_pedido(text, jsonb, jsonb, jsonb, numeric, inet) to service_role;

revoke all on function public.liberar_reservas_vencidas(integer) from public, anon, authenticated, service_role;
grant execute on function public.liberar_reservas_vencidas(integer) to service_role;

revoke all on function public.purgar_intentos_checkout(integer) from public, anon, authenticated, service_role;
grant execute on function public.purgar_intentos_checkout(integer) to service_role;

revoke all on function public.admin_cancelar_pedido(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_actualizar_preparacion(uuid, text, text, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_actualizar_notas(uuid, text) from public, anon, authenticated, service_role;
revoke all on function public.admin_resolver_faltante(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_marcar_resuelto(uuid) from public, anon, authenticated, service_role;
revoke all on function public.admin_actualizar_limites(integer, integer, integer, integer, integer, integer) from public, anon, authenticated, service_role;
grant execute on function public.admin_cancelar_pedido(uuid) to authenticated;
grant execute on function public.admin_actualizar_preparacion(uuid, text, text, text) to authenticated;
grant execute on function public.admin_actualizar_notas(uuid, text) to authenticated;
grant execute on function public.admin_resolver_faltante(uuid) to authenticated;
grant execute on function public.admin_marcar_resuelto(uuid) to authenticated;
grant execute on function public.admin_actualizar_limites(integer, integer, integer, integer, integer, integer) to authenticated;

revoke all on function public.configuracion_checkout() from public, anon, authenticated, service_role;
grant execute on function public.configuracion_checkout() to anon, authenticated, service_role;

revoke all on function public.consultar_pedido(text, text) from public, anon, authenticated, service_role;
-- solo el servidor: la página de seguimiento se renderiza en el servidor, así el token no viaja del navegador
-- a la API de Supabase (ni queda en sus logs o en una URL de PostgREST)
grant execute on function public.consultar_pedido(text, text) to service_role;
