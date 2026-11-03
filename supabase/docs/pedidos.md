# Pedidos, reservas de stock y concurrencia (Fase 4B.3)

Infraestructura de base de datos para el futuro checkout. **No** habilita compras: `store_settings.checkout_enabled`
queda en `false` y bloqueado hasta la Fase 5. No hay carrito, pantallas de checkout ni Mercado Pago.

| Migración | Contenido |
|---|---|
| `20261102130000_pedidos_esquema.sql` | Esquema `private` y claves HMAC, `store_settings`, `orders`, `order_items`, `order_events`, `checkout_attempts`, invariantes (CHECK), trigger de transiciones, RLS y permisos |
| `20261102130100_pedidos_funciones.sql` | `crear_pedido()`, liberación y vencimiento, pagos (interno), operaciones del panel, consulta por token, permisos `EXECUTE` |
| `20261102130200_productos_stock_concurrencia.sql` | `products.stock_version`, trigger de control optimista del stock, `admin_product_stock()` con la versión |

Pruebas: `supabase/tests/database/pedidos.test.sql` (pgTAP, `npm run db:test`),
`supabase/tests/concurrency/pedidos.concurrency.test.ts` (conexiones simultáneas reales, `npm run test:concurrency`) y
`e2e/stock-concurrencia.spec.ts` (panel real contra reservas, `npm run test:e2e`).

---

## 1. Modelo

```
store_settings (fila única)

provinces ◄── orders ──► shipping_zones (on delete set null; nombre y tarifa se copian al pedido)
                │
                ├──< order_items ──► products (on delete restrict: un producto vendido no se borra)
                ├──< order_events
                └──< checkout_attempts (order_id, on delete set null)
```

- **`products.stock` es el stock disponible para vender.** Una reserva lo descuenta.
- **`products.stock_version`** aumenta en 1 con cada cambio de stock (panel, reserva, liberación, pago tardío).
- `orders` guarda los datos del comprador y la dirección (necesarios para despachar), la zona y tarifa
  históricas, y los importes calculados por la base. Los importes y datos son **inmutables** después de crear
  el pedido (trigger `orders_validar_cambios`, SQLSTATE `SR002`), aun para `postgres`.
- El token de consulta, la clave de idempotencia y la huella del contenido se guardan **solo como sha256**.
- `order_items` y `order_events` son de solo inserción.
- `order_events.data` guarda solo estados, cantidades, importes e ids. Nunca nombres, emails, teléfonos ni direcciones.
- `checkout_attempts` guarda un HMAC de la IP, el resultado y el código de error. Nunca la IP. Se purga a los 7 días.

## 2. Estados

| Columna | Transiciones |
|---|---|
| `payment_status` | `pending` → `approved` · `expired` · `cancelled`; `expired`/`cancelled` → `approved` (pago tardío) |
| `stock_state` | `reserved` → `consumed` · `released`; `released` → `consumed` · `shortage`; `shortage` → `consumed` |
| `fulfillment_status` | `pending` → `preparing` → `shipped` → `delivered` (y `preparing` → `pending`) |
| `resolution_status` | `none` → `pending` → `resolved` (→ `pending` si aparece otro problema) |

`resolution_reason`: `stock_shortage`, `duplicate_payment`, `amount_mismatch`.

Invariantes (CHECK): pago `pending` ⇔ stock `reserved`; `expired`/`cancelled` ⇒ `released`; `approved` ⇒
`consumed` o `shortage` con `paid_at`; `shortage` ⇒ resolución `pending` por `stock_shortage`; preparación
distinta de `pending` ⇒ pagado y `consumed`. El trigger además impide avanzar la preparación con una resolución
pendiente. **Un pedido pagado sin stock no puede prepararse ni despacharse** (ni desde el panel ni por SQL).

Escenarios verificados (pgTAP): pago antes de vencer, pago rechazado, reserva vencida, pago tardío con y sin stock,
pago duplicado, notificación repetida, importe distinto, pago sobre un pedido **cancelado** con y sin stock.

**El panel no puede marcar un pedido como pagado**: ni `authenticated` ni `service_role` tienen `UPDATE` sobre
`orders`, y ninguna función pública cambia `payment_status` a `approved`. El pago solo entra por
`private.aplicar_pago()`, que no es ejecutable desde la API.

## 3. `crear_pedido()`

```sql
public.crear_pedido(p_idempotency_key text, p_buyer jsonb, p_shipping jsonb, p_items jsonb,
                    p_expected_total_ars numeric, p_client_ip inet) returns jsonb
```

Solo `service_role` (el servidor de Next). El navegador **no** puede llamarla: si pudiera, elegiría la IP.

1. Falta la IP → `22023` (error de integración del servidor, el único que no se registra: la IP no la controla el comprador).
2. `pg_advisory_xact_lock(IP)` **fuera** del subbloque: dura hasta el commit, así el conteo de intentos y el
   registro de este intento quedan serializados por IP, también en ráfagas simultáneas.
3. Intentos de la IP en la última hora ≥ límite → `too_many_attempts` **sin hacer ningún trabajo**.
4. Clave de idempotencia mal formada → `invalid_input` (`idempotency_key`).
5. `pg_advisory_xact_lock(clave)` y subbloque (savepoint) con `private.crear_pedido_tx`: checkout habilitado →
   validación → límites de unidades → idempotencia → advisory del email → pedidos por IP y pendientes por email →
   **liberación oportunista** de reservas vencidas de esos productos → bloqueo de productos en orden → activo,
   categoría, stock, precio → `cotizar_envio()` → total aceptado → descuento → pedido, artículos y evento.
6. **Cualquier** error dentro del subbloque deshace todo lo que hizo (stock, pedido, liberaciones) y se devuelve
   `rejected`: los de negocio (`SR001`) con su código, los inesperados como `internal_error` (solo el SQLSTATE; el
   mensaje va al log de Postgres como WARNING, sin datos del comprador ni la clave).
7. Se registra el intento en `checkout_attempts` y la transacción **se confirma**: el registro de rechazos no
   depende de que PostgreSQL conserve INSERT de una transacción revertida, porque la transacción no se revierte.

Respuesta: `{status: 'created'|'replayed', order_id, code, token, subtotal_ars, shipping_ars, total_ars, reservation_expires_at}`
o `{status: 'rejected', error, detail}`. Códigos: `checkout_disabled`, `invalid_input` (`detail.fields`),
`quantity_limit`, `idempotency_conflict`, `too_many_attempts`, `too_many_orders`, `too_many_pending_orders`,
`product_unavailable`, `insufficient_stock` (sin informar el stock exacto), `no_shipping_coverage`,
`total_mismatch` (`detail` con el total vigente), `internal_error`. `src/lib/orders/errors.ts` los interpreta.

## 4. Tokens, claves e idempotencia

| Aspecto | Implementación |
|---|---|
| Clave de idempotencia | La genera el navegador con `crypto.randomUUID()` (CSPRNG, 122 bits) una vez por checkout. Formato exigido `[A-Za-z0-9_-]{32,128}`. Se guarda solo `sha256`. |
| Misma clave, otro contenido | `idempotency_conflict`, sin código, token ni datos del pedido existente. |
| Token de consulta | `base64url(HMAC-SHA256(clave order_token vN, 'stf-order-token:v1:' ‖ order_id ‖ ':' ‖ clave_idempotencia))`, 256 bits. Se guarda `sha256(token)` y `token_key_version`. |
| Reintentos | Recalculan el mismo token con la versión de clave guardada en el pedido (también después de rotar). |
| Separación de claves | `private.app_secrets`: `ip_hash` y `order_token`, distintas, 32 bytes de `gen_random_bytes` (OpenSSL), generadas en cada base, nunca en el repositorio; además prefijos de dominio distintos en cada HMAC. |
| Acceso a pedidos ajenos | El código `STF-AAMM-XXXX` no alcanza: la consulta exige el token (256 bits) y compara contra el hash. Un token válido no abre otro pedido. La consulta es **solo `service_role`**: el navegador no puede probar tokens contra la API. |
| Filtraciones | El token solo viaja en la respuesta de `crear_pedido`. Ningún error ni evento incluye la clave o el token. La futura página de seguimiento debe recibir el token fuera de la URL de la página (fragmento `#` leído en el cliente y enviado por POST, o cookie `HttpOnly`) y con `Referrer-Policy: no-referrer`; el servidor no debe loguearlo. |

### Rotación de claves

```sql
-- token: los pedidos existentes siguen funcionando (se verifican contra el hash; los reintentos usan su versión)
begin;
update private.app_secrets set active = false where name = 'order_token';
insert into private.app_secrets (name, version, value)
values ('order_token', (select max(version) + 1 from private.app_secrets where name = 'order_token'), extensions.gen_random_bytes(32));
commit;
-- no borrar versiones viejas: solo se necesitan para reintentos, pero borrarlas los haría fallar.

-- IP: igual con name = 'ip_hash'. Efecto: los contadores por IP de la última hora vuelven a cero (hacerlo en horario tranquilo).
```

## 5. Reservas, vencimientos y recuperación

| Evento | Stock | Estados |
|---|---|---|
| Crear pedido | − cantidad | `pending` / `reserved` |
| Pago aprobado (reserva vigente o vencida pero no liberada) | sin cambio | `approved` / `consumed` |
| Vencimiento (tarea o liberación oportunista) | + cantidad, una vez | `expired` / `released` |
| Cancelación del panel | + cantidad, una vez | `cancelled` / `released` |
| Pago tardío (vencido o cancelado) con stock | − cantidad (todo o nada) | `approved` / `consumed` |
| Pago tardío sin stock | sin cambio (nunca negativo) | `approved` / `shortage`, resolución `stock_shortage` |
| `admin_resolver_faltante` con stock repuesto | − cantidad | `consumed`, resolución `resolved` |

**Exactamente una vez**: la liberación bloquea el pedido y vuelve a leer `stock_state`; solo libera si sigue `reserved`.

**Sin pg_cron**:
- *Liberación oportunista*: cada `crear_pedido` libera primero las reservas vencidas (hasta 50) que contienen
  alguno de los productos pedidos. Una compra nunca se rechaza por stock retenido por una reserva vencida.
- *Acumuladas*: `liberar_reservas_vencidas(200)` avanza por lotes; si pg_cron estuvo detenido, cada ejecución
  libera 200 más (probado con 250 acumuladas: 100, 100, 50, 0). A mano: repetir hasta que devuelva 0.
- *Falla durante el proceso*: cada pedido se libera en su propio subbloque. Si uno falla, se deshace solo ese
  pedido (sin cambios parciales), se emite un WARNING y los demás se liberan igual; el fallido queda reservado y
  vencido y lo reintenta la ejecución siguiente. Si se corta la transacción completa (timeout, caída), no se
  confirma nada y la siguiente ejecución retoma desde el mismo estado.
- Monitoreo: `select count(*) from public.orders where stock_state = 'reserved' and reservation_expires_at < now() - interval '10 minutes';` debe ser 0.

### Orden de bloqueo (sin deadlocks)

```
1. advisory(IP) → advisory(clave) → advisory(email)   solo crear_pedido; nadie más los usa
2. filas de orders                                     varias: con SKIP LOCKED (nunca espera)
3. filas de products, por id ascendente, TODAS antes de modificar cualquiera (private.bloquear_productos)
```

Quien libera varios pedidos bloquea primero **la unión** de sus productos ordenada. La versión anterior liberaba
de a un pedido y producía deadlocks reales contra compras de varios productos (1 a 16 por corrida en la prueba
"vencimientos de pedidos con productos distintos"); con el orden global: 0.

### pg_cron

`supabase/scripts/pg_cron_pedidos.sql` (manual, **no** es migración): `stf-liberar-reservas-vencidas` cada minuto
(`liberar_reservas_vencidas(200)`) y `stf-purgar-intentos-checkout` diario. `pg_cron_pedidos_baja.sql` los
desprograma. **No está activado en Cloud.**

## 6. Concurrencia entre el panel y las reservas

El panel guarda el stock como valor absoluto. Sin control, un administrador con el formulario abierto (20) podía
pisar una reserva hecha mientras tanto (17 → 20). Solución en la base (`20261102130200_productos_stock_concurrencia.sql`):

- Para cambiar `stock` desde la API (`authenticated`, `service_role`, `anon`) hay que enviar
  `stock_version = versión leída + 1`. Si se omite o quedó vieja, el trigger `products_control_stock` rechaza el
  UPDATE con `SR003` (`detail`: stock y versión actuales) y **no se guarda nada** (el formulario completo va en un
  solo UPDATE: todo o nada).
- El UPDATE espera el bloqueo de fila de `crear_pedido` (`FOR UPDATE`) y el trigger compara contra la fila ya
  confirmada: coordinado con las reservas, sin bloqueos visuales.
- Aplica a toda vía: formulario completo, edición rápida, cualquier código futuro o una llamada directa a la API.
  Un incremento relativo (`stock = stock + 5`) ni siquiera se puede escribir porque el panel no lee `stock` por SELECT.
- Reenviar el mismo valor (doble clic) no es un cambio y no pisa nada.
- El panel (`src/lib/catalog/admin.ts`) lee stock y versión juntos con `admin_product_stock()` y envía la versión
  en un campo oculto. Ante un conflicto muestra *"El stock cambió mientras editabas… Ahora hay N unidades
  disponibles. Revisá el valor y volvé a guardar."* y recarga el campo con el valor y la versión actuales.
- El SQL Editor (`postgres`) puede corregir el stock sin versión; la versión igual avanza, así un panel abierto lo detecta.

Nota de uso: el formulario completo envía siempre el stock, así que si hubo una venta mientras se editaba otro dato
(por ejemplo, la descripción), también da conflicto; el campo de stock se recarga y basta con guardar de nuevo.

## 7. Seguridad, credenciales y permisos

- RLS en las 5 tablas nuevas. `checkout_attempts` sin políticas ni permisos.
- `anon`, `authenticated` y `service_role` no tienen `INSERT/UPDATE/DELETE/TRUNCATE` en ninguna tabla nueva.
- Administradores: `SELECT` de pedidos (sin columnas de hashes), artículos, eventos y configuración.
- Funciones `SECURITY DEFINER`: `search_path = ''`, nombres calificados, sin SQL dinámico, argumentos validados.

| Función | anon | authenticated | service_role |
|---|---|---|---|
| `crear_pedido`, `consultar_pedido` | – | – | ✓ |
| `liberar_reservas_vencidas`, `purgar_intentos_checkout` | – | – | ✓ (y pg_cron como postgres) |
| `admin_*` de pedidos y `admin_product_stock` | – | ✓ + `is_admin()` | – / ✓ |
| `configuracion_checkout` | ✓ | ✓ | ✓ |
| `private.*` (incluido `aplicar_pago`) | – | – | – (esquema no expuesto) |

**service_role**: por diseño de Supabase es una clave de servidor con `BYPASSRLS`. En este flujo solo se usa para
`crear_pedido` y `consultar_pedido`. Aun con ella: no escribe tablas de pedidos, no ejecuta funciones privadas,
no habilita el checkout y no cambia stock sin versión. Debe vivir solo en el servidor (`SUPABASE_SECRET_KEY`,
nunca `NEXT_PUBLIC_`). `src/lib/orders/secrets.audit.test.ts` impide variables secretas `NEXT_PUBLIC_` y secretos en
componentes de cliente; además se revisa el build de producción buscando las claves locales en `.next/static`.

**Límite de confianza**: la IP la obtiene el servidor de Next del proxy (`trustedClientIp`) y la base solo acepta
`inet`; los datos del comprador los valida la base (`normalizar_checkout`) aunque el servidor ya lo haya hecho; la
identidad del panel la verifica `is_admin()` en cada función.

## 8. Antiabuso

| Control | Por defecto |
|---|---|
| Unidades por producto / por pedido | 5 / 20 |
| Pedidos pendientes por email (sin distinguir mayúsculas) | 2 |
| Pedidos creados por IP y hora | 5 |
| Intentos (creados, repetidos o rechazados, **incluidos errores**) por IP y hora | 30 |
| Frecuencia de cotización | en el borde (Vercel Firewall): `cotizar_envio` es una lectura sin estado |

Todos editables con `admin_actualizar_limites`. IPv6 se agrupa por /64.

**IP**: en Vercel (`VERCEL=1`) se usa `x-real-ip` (respaldo `x-vercel-forwarded-for`), que el borde escribe
reemplazando lo que mande el cliente. Sin proxy conocido no hay IP confiable; en `next dev` se usa `LOCAL_DEV_IP`.
Otro proxy (por ejemplo Cloudflare) requiere un modo nuevo que lea solo su header y verifique el origen.

**Turnstile** (pendiente, requiere credenciales): en la Server Action del checkout, antes de `crear_pedido`, verificar
el token con `TURNSTILE_SECRET_KEY` (solo servidor). Si falla, no se llama a la base.

## 9. Despliegue

### Quién usa la base de Cloud

Solo los despliegues de `feat/catalogo-supabase` (Preview). `main` y `feat/nextjs-migracion` (Production) no tienen
código de Supabase ni del panel: la migración no los afecta.

### Orden coordinado (minimiza la ventana sin edición de stock)

1. Commit local con migraciones y código juntos; todas las suites en verde.
2. Referencia previa de Cloud (productos y stock, categorías, usuarios y administradores, políticas, permisos de
   columnas, funciones, historial de migraciones). Respaldo (Backups / PITR).
3. `supabase db push --linked --dry-run`: deben aparecer **solo** `20261102130000`, `20261102130100` y `20261102130200`,
   en ese orden (la tercera usa el esquema `private` que crea la primera). Cualquier otra → detenerse.
4. `supabase db push --linked` y verificación inmediata (sección 10).
5. Push de la rama **inmediatamente**: Vercel construye el Preview nuevo en pocos minutos.
   Ventana: entre 4 y el Preview nuevo, el panel de los Preview viejos no puede **guardar stock** (falla con error,
   sin corromper nada); la tienda, las fichas, el resto del panel y los envíos funcionan igual.
6. Verificar el Preview nuevo (commit correcto, Ready, stock exacto visible, edición de stock con versión).

`checkout_enabled` queda en `false`; no se ejecuta `pg_cron_pedidos.sql`; no se crean pedidos en Cloud.

## 10. Verificación posterior en Cloud (solo lectura)

```sql
select checkout_enabled from public.store_settings;                                   -- false
select count(*) from public.orders;                                                   -- 0
select count(*) from public.checkout_attempts;                                        -- 0
select name, version, active, octet_length(value) from private.app_secrets order by 1, 2;  -- ip_hash 1 / order_token 1, 32 bytes, activos
select count(*) from public.products where stock_version <> 0;                        -- 0 recién migrado
select has_function_privilege('anon', 'public.crear_pedido(text, jsonb, jsonb, jsonb, numeric, inet)', 'execute');   -- false
select has_function_privilege('anon', 'public.consultar_pedido(text, text)', 'execute');                            -- false
select has_schema_privilege('service_role', 'private', 'usage');                                                     -- false
select extname from pg_extension where extname = 'pg_cron';                                                          -- sin filas
```

Más la comparación de productos, stock, categorías, usuarios, políticas y permisos con la referencia previa.

## 11. Rollback y recuperación

### Qué es reversible sin migración y qué no

| Operación | Reversible | Cómo |
|---|---|---|
| Activar/desactivar el trigger `products_control_stock` | Sí, inmediato | `alter table public.products disable|enable trigger products_control_stock;` |
| Permisos (`grant`/`revoke`) y cuerpos de funciones | Sí | Con una migración correctiva nueva (no editando las aplicadas) |
| Rotar claves HMAC | Sí | Ver "Rotación de claves" |
| Quitar columnas (`stock_version`) o tablas de pedidos | **No** sin pérdida de datos | Solo con migración correctiva, y nunca con pedidos reales |
| Editar `supabase_migrations.schema_migrations` | Solo como último recurso | Debe quedar coherente con los archivos de `supabase/migrations/` |

### Si el código nuevo del panel no puede editar el stock

Mientras el checkout esté deshabilitado **no existen reservas**, así que el control de versión no protege nada
todavía y se puede relajar sin riesgo:

1. Corregir el stock puntual desde el SQL Editor (`postgres` puede sin versión; la versión igual avanza).
2. Si hace falta que el panel viejo vuelva a editar: `alter table public.products disable trigger products_control_stock;`
   El panel viejo y el nuevo funcionan (el nuevo envía `stock_version`, que sin trigger se guarda tal cual).
3. Corregir, desplegar y volver a activar: `alter table public.products enable trigger products_control_stock;`
   (antes de habilitar el checkout en la Fase 5 es **obligatorio** que esté activo).

### Si el deploy de Vercel falla después de aplicar las migraciones

Las migraciones son aditivas: la tienda pública no cambia (lee `availability`, igual que antes) y el panel funciona
salvo el guardado de stock en los Preview viejos. Opciones, de menor a mayor impacto:
1. Reintentar el deploy (redeploy del mismo commit) o corregir y hacer push.
2. Mientras tanto, ajustar stock por SQL Editor o desactivar temporalmente el trigger (punto anterior).
3. No revertir migraciones por un problema de deploy.

### Pedidos reales (Fase 5 en adelante)

- Nunca `drop` de `orders`, `order_items`, `order_events` ni `checkout_attempts`; nunca `delete` de pedidos.
- Antes de cualquier migración que los toque: respaldo (PITR) y `pg_dump --data-only -t public.orders -t public.order_items -t public.order_events`
  guardado fuera del repositorio (contiene datos personales).
- Correcciones siempre hacia adelante con migraciones nuevas; el historial no se edita.

### Rollback total (solo sin pedidos reales y verificando dependencias)

Primero confirmar `select count(*) from public.orders` = 0 y que ningún código desplegado use las funciones nuevas.

```sql
begin;
drop trigger products_control_stock on public.products;
drop function public.admin_product_stock(uuid[]);
-- recrear admin_product_stock(uuid[]) returns table (id uuid, stock integer) como en 20261101120000 (con sus grants)
alter table public.products drop column stock_version;
drop function if exists public.crear_pedido(text, jsonb, jsonb, jsonb, numeric, inet), public.liberar_reservas_vencidas(integer),
  public.purgar_intentos_checkout(integer), public.admin_cancelar_pedido(uuid), public.admin_actualizar_preparacion(uuid, text, text, text),
  public.admin_actualizar_notas(uuid, text), public.admin_resolver_faltante(uuid), public.admin_marcar_resuelto(uuid),
  public.admin_actualizar_limites(integer, integer, integer, integer, integer, integer), public.configuracion_checkout(),
  public.consultar_pedido(text, text);
drop table public.checkout_attempts, public.order_events, public.order_items, public.orders, public.store_settings;
drop schema private cascade;
delete from supabase_migrations.schema_migrations where version in ('20261102130000', '20261102130100', '20261102130200');
commit;
```

Después, revertir el commit en Git y desplegar el código anterior, para que archivos, base y código coincidan.
