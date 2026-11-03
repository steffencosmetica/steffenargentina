-- Fase 4B.4: cotización del carrito.
-- Lectura pura (stable, sin bloqueos ni escrituras): precios vigentes, estado de cada artículo y límites
-- públicos. La usa el servidor de Next con la clave publicable (no hace falta service_role).
--
-- Stock exacto: nunca se devuelve. Por artículo se informa un estado y max_quantity, el máximo comprable
-- acotado por max_units_per_product (con el límite inicial de 5, a lo sumo se sabe si hay 0…5 unidades,
-- lo mismo que se deduce probando cantidades; por encima del límite el stock queda oculto).
-- Importes como texto exacto ("12550.00"): el cliente los pasa a centavos sin pasar por float (src/lib/money.ts).
-- La validación definitiva sigue siendo crear_pedido() (bloqueos, stock real y límites al confirmar).

create function public.cotizar_carrito(p_items jsonb)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_cfg public.store_settings%rowtype;
  v_item jsonb;
  v_ids uuid[] := '{}';
  v_id uuid;
  v_qty integer;
  v_lines jsonb := '[]';
  v_prod record;
  v_status text;
  v_max integer;
  v_subtotal numeric(14, 2) := 0;
  v_units integer := 0;
  v_ok boolean := true;
begin
  if p_items is null or jsonb_typeof(p_items) <> 'array' or jsonb_array_length(p_items) > 50 then
    raise exception 'Artículos inválidos (arreglo de hasta 50)' using errcode = '22023';
  end if;

  -- configuración obligatoria: sin la fila o con límites inválidos no se cotiza (least() ignora NULL y
  -- max_quantity terminaría mostrando el stock exacto)
  select * into v_cfg from public.store_settings s where s.id;
  if not found
     or v_cfg.checkout_enabled is null
     or v_cfg.max_units_per_product is null or v_cfg.max_units_per_product < 1
     or v_cfg.max_units_per_order is null or v_cfg.max_units_per_order < 1 then
    raise exception 'Configuración de la tienda no disponible' using errcode = '55000';
  end if;

  for v_item in select value from jsonb_array_elements(p_items) loop
    if jsonb_typeof(v_item) <> 'object'
       or exists (select 1 from jsonb_object_keys(v_item) k where k not in ('product_id', 'quantity'))
       or jsonb_typeof(v_item -> 'product_id') is distinct from 'string'
       or (v_item ->> 'product_id') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
       or jsonb_typeof(v_item -> 'quantity') is distinct from 'number'
       or (v_item ->> 'quantity') !~ '^[0-9]{1,4}$'
       or (v_item ->> 'quantity')::integer < 1 then
      raise exception 'Artículo inválido' using errcode = '22023';
    end if;
    v_id := (v_item ->> 'product_id')::uuid;
    if v_id = any (v_ids) then
      raise exception 'Producto repetido' using errcode = '22023';
    end if;
    v_ids := v_ids || v_id;
    v_qty := (v_item ->> 'quantity')::integer;

    select p.id, p.sku, p.name, p.slug, p.price_ars, p.stock, p.availability,
           (p.is_active and c.is_active) as visible,
           (select i.storage_path from public.product_images i where i.product_id = p.id
             order by i.is_primary desc, i.sort_order, i.created_at limit 1) as image_path
      into v_prod
      from public.products p
      join public.categories c on c.id = p.category_id
     where p.id = v_id;

    if not found or not v_prod.visible then
      -- inexistente, inactivo o de una categoría inactiva: ningún dato comercial (ni nombre, ni precio);
      -- la respuesta es idéntica en los tres casos, así no se distingue un producto oculto de uno inexistente
      v_lines := v_lines || jsonb_build_object(
        'product_id', v_id, 'status', 'unavailable', 'quantity', v_qty,
        'name', null, 'slug', null, 'sku', null,
        'price_ars', null, 'image_path', null, 'availability', null, 'max_quantity', 0, 'line_total_ars', null);
      v_ok := false;
      continue;
    end if;

    v_max := least(greatest(coalesce(v_prod.stock, 0), 0), v_cfg.max_units_per_product);
    v_status := case
      when v_prod.stock <= 0 then 'out_of_stock'
      when v_qty > v_cfg.max_units_per_product then 'exceeds_limit'
      when v_qty > v_prod.stock then 'exceeds_stock'
      else 'ok'
    end;
    if v_status = 'ok' then
      v_subtotal := v_subtotal + v_prod.price_ars * v_qty;
      v_units := v_units + v_qty;
    else
      v_ok := false;
    end if;

    v_lines := v_lines || jsonb_build_object(
      'product_id', v_prod.id, 'status', v_status, 'quantity', v_qty,
      'name', v_prod.name, 'slug', v_prod.slug, 'sku', v_prod.sku,
      'price_ars', v_prod.price_ars::text, 'image_path', v_prod.image_path, 'availability', v_prod.availability,
      'max_quantity', v_max,
      'line_total_ars', case when v_status = 'ok' then (v_prod.price_ars * v_qty)::numeric(14, 2)::text end);
  end loop;

  return jsonb_build_object(
    'checkout_enabled', v_cfg.checkout_enabled,
    'limits', jsonb_build_object('max_units_per_product', v_cfg.max_units_per_product,
                                 'max_units_per_order', v_cfg.max_units_per_order),
    'items', v_lines,
    'units', v_units,
    'subtotal_ars', v_subtotal::text,
    'exceeds_order_limit', (select coalesce(sum((i ->> 'quantity')::integer), 0) from jsonb_array_elements(v_lines) i) > v_cfg.max_units_per_order,
    'can_checkout', v_ok and jsonb_array_length(v_lines) > 0
                    and (select coalesce(sum((i ->> 'quantity')::integer), 0) from jsonb_array_elements(v_lines) i) <= v_cfg.max_units_per_order
  );
end;
$$;

comment on function public.cotizar_carrito(jsonb) is
  'Cotización del carrito: precios vigentes, estado por artículo y límites públicos. Sin stock exacto (max_quantity está acotado por max_units_per_product). Solo lectura.';

revoke all on function public.cotizar_carrito(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.cotizar_carrito(jsonb) to anon, authenticated, service_role;
