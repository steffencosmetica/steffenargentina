# Fase 4B.6 — Informe complementario de validación

## Los dos fallos de la corrida 135/137

Ambos pertenecían a `e2e/pedidos.spec.ts`:

| Caso | Error observado | Causa |
|---|---|---|
| `pedidos: listado, búsqueda privada y paginación` | Se esperaba una URL que coincidiera con `/admin/login`; la URL seguía siendo `http://localhost:3100/admin/pedidos`. | El contexto que debía ser anónimo tenía la sesión administrativa heredada. |
| `pedidos: detalle histórico, notas y conflicto entre administradores` | El POST reenviado devolvió `200`; la aserción esperaba una redirección `303`, `307` o `308`. | El `APIRequestContext` asociado al contexto del navegador reenviaba las cookies administrativas aunque se quitara `cookie` de los headers capturados. |

El archivo declara `test.use({ storageState: ADMIN_STATE })`. Dentro de ese alcance, `browser.newContext()` sin sobrescribir `storageState` hereda los valores de contexto configurados por Playwright. Crear otro contexto no equivale a eliminar la identidad de prueba.

La causa es reproducible y no depende de un timeout ni de una carrera. Las repeticiones que habían pasado ya contenían la corrección `storageState: { cookies: [], origins: [] }`; no eran una repetición aleatoria del mismo código defectuoso.

## Reproducción controlada y correcciones

Los dos tests ahora comprueban ambos escenarios, sin introducir fallos intencionales en la suite:

1. Contexto implícito: contiene cookies de autenticación; puede abrir `/admin/pedidos` como administrador.
2. Contexto explícitamente vacío: no contiene cookies de autenticación; listado y detalle redirigen al login y no muestran al comprador ficticio.
3. POST con contexto implícito: reproduce el `200` histórico. Se reenvía una versión ya consumida; `SR004` impide otra escritura y se verifica que sigue existiendo un solo evento de notas.
4. El mismo POST con contexto explícitamente vacío: es rechazado mediante redirección antes de ejecutar la operación.

Además se corrigió una dependencia entre pruebas: los pedidos se creaban en `beforeAll` y se modificaban a lo largo del archivo. Se reemplazó por fixtures y limpieza **por test** (`beforeEach` / `afterEach`). Cada caso empieza con los mismos 26 pedidos; las notas, incidencias, cancelaciones y entregas de un caso no afectan al siguiente ni a las capturas.

La limpieza por test apaga el checkout mediante `finally`; el teardown global también lo apaga antes de limpiar datos. No se aumentaron timeouts, no se agregaron sleeps y no se habilitaron retries.

## Sincronización e interferencias

- La configuración general conserva `workers: 1`, `fullyParallel: false`, `retries: 0`, timeout por test de 45 segundos y aserciones de 10 segundos.
- El listener de captura del Server Action se registra antes del clic. Las transiciones esperan señales observables de la UI; no usan pausas fijas.
- La segunda página de notas conserva deliberadamente una versión vieja: el conflicto se verifica en PostgreSQL, no por demoras del navegador.
- pgTAP, Playwright y concurrencia comparten el stack local y deben ejecutarse como corridas separadas. En esta validación no se solaparon suites que modificaran datos. La consulta de metadatos de permisos ejecutada durante Playwright fue solo de lectura.
- El helper SQL sigue usando `psql` dentro del contenedor local; no se reintrodujo el CLI `db query` por consulta ni la restauración frágil de fixtures de las primeras corridas.

## Auditoría de la migración

Se revisó `20261104120000_admin_pedidos.sql` y se contrastó con el catálogo real de PostgreSQL local mediante `supabase/scripts/auditar_admin_pedidos.sql`.

| Funciones | PUBLIC | anon | authenticated | service_role |
|---|---|---|---|---|
| `admin_listar_pedidos`, `admin_operar_pedido` | Sin EXECUTE | Sin EXECUTE | EXECUTE + verificación `is_admin()` | Sin EXECUTE |
| RPC administrativas anteriores de pedidos | Sin EXECUTE | Sin EXECUTE | EXECUTE + verificación `is_admin()` | Sin EXECUTE |
| `private.orders_incrementar_version` | Sin EXECUTE | Sin EXECUTE | Sin EXECUTE | Sin EXECUTE |

Las RPC administrativas son `SECURITY DEFINER`, propiedad de `postgres`, con `search_path` vacío. El trigger de versión es invoker y privado. El esquema `private` no tiene USAGE para los roles de la API.

Las funciones definer comprueban `private.exigir_admin()` **antes** de consultar o bloquear un pedido. Esto es necesario porque el propietario puede omitir RLS. No se confía únicamente en la política de tabla para autorizar la RPC.

`orders`, `order_items` y `order_events` mantienen RLS habilitado y una política SELECT para `authenticated` condicionada por `is_admin()`. No se agregaron políticas de escritura ni permisos INSERT, UPDATE, DELETE o TRUNCATE para los roles de API. Los hashes siguen sin SELECT para `authenticated`; la nueva columna solo recibió SELECT bajo las políticas existentes.

### Versiones, atomicidad y compatibilidad

- `admin_operar_pedido` bloquea la fila con `FOR UPDATE` y compara `admin_version` contra la versión recibida **después** de obtener el bloqueo. Una versión vieja produce `SR004` sin cambiar datos ni eventos.
- El trigger incrementa la versión en cada UPDATE, incluidos los realizados por funciones antiguas, pagos y liberaciones de stock. Un error de transición revierte también el incremento; se probó explícitamente.
- El despacho puede incrementar dos veces el contador (transición y fecha operativa), dentro de una sola transacción. La versión es un contador de cambios, no de operaciones, y no se exige que avance exactamente una unidad.
- Las firmas, grants y cuerpos de las funciones anteriores no se modificaron. Una llamada antigua de notas o preparación sigue funcionando e invalida los formularios versionados abiertos.
- Las RPC históricas conservan su contrato sin argumento de versión; no se les atribuye control optimista retroactivo. El panel usa la RPC nueva para editar y operar con versión.

### Transiciones de stock

La nueva migración no escribe stock ni cambia `payment_status`. Delega en las funciones existentes y conserva los CHECK y el trigger `orders_validar_cambios`:

- Reserva: `reserved → released` por cancelación/vencimiento; se devuelve stock una sola vez.
- Pago: `reserved → consumed`; pago tardío `released → consumed` o `shortage`, según disponibilidad.
- Faltante repuesto: `shortage → consumed`, con descuento transaccional.
- Preparación: exige pago aprobado, stock consumido y ausencia de resolución pendiente. No se puede saltar de preparación a entrega.

No se encontró una corrección necesaria en la migración. No se creó ni aplicó ninguna migración adicional durante esta revisión y no se tocaron migraciones anteriores.

## Pruebas adicionales de seguridad

`supabase/tests/database/admin_pedidos_seguridad.test.sql` agrega 83 comprobaciones. Usa `SET LOCAL ROLE authenticated` con el UUID de un usuario **sin** entrada en `admin_users`, en lugar de comprobar solamente los grants desde `postgres`:

- SELECT devuelve cero pedidos, artículos y eventos por RLS.
- Las columnas secretas y el UPDATE directo producen `42501`.
- Las dos RPC nuevas y las operaciones administrativas anteriores producen `42501`.
- Los rechazos no cambian versiones ni insertan eventos.
- Un administrador conserva las funciones antiguas de notas, preparación y cancelación.
- Cancelar dos veces por la API anterior devuelve el stock exactamente una vez.
- Una escritura antigua convierte un intento versionado viejo en `SR004`.
- Anon carece tanto de lectura de pedidos como de EXECUTE administrativo.

Las pruebas existentes de pedidos, pagos simulados, reservas, liberaciones y concurrencia siguen formando parte de la validación; no se sustituyeron por las pruebas nuevas.

## Resultados definitivos

| Verificación | Resultado |
|---|---|
| `npm run test:e2e` general completa | **137/137 aprobadas en 4,9 minutos**, incluidos los dos casos históricos y la reproducción controlada de su causa |
| Fallos / omitidos / retries en esa corrida | **0 / 0 / 0** |
| Build de producción usado por Playwright | Aprobado con URL y claves del stack local |
| `npm run db:test` | **591/591**, en 9 archivos; 83 comprobaciones nuevas de seguridad y compatibilidad |
| `npm run test:concurrency`, después de Playwright | **15/15**, sin fallos ni omisiones, en 67,6 segundos; incluye la carrera real entre administradores |
| `npm test` | **107/107** |
| `npx tsc --noEmit` | Sin errores |
| Consulta de ACL, RLS y triggers del esquema local | Coincide con la migración y la matriz documentada |
| `git diff --check` | Aprobado |

La suite completa incluye regresiones de catálogo, stock, envíos, carrito, checkout, navegación y acceso no autorizado. No se reemplazó la confirmación general por la suma de corridas parciales.

El reporte HTML de esta corrida está disponible localmente en `playwright-report/index.html`. Las capturas de pedidos a 390, 768 y 1440 px se regeneraron con fixtures independientes.

La consulta final, ejecutada después de que terminó concurrencia, devolvió:

```json
{"checkout_enabled": false, "orders": 0, "attempts": 0}
```

`attempts` corresponde a `public.checkout_attempts`. No quedan pedidos ni intentos ficticios en la base local.

Git sigue en `feat/catalogo-supabase`, HEAD `17d0d94e03e848fa3d08205b36faad87d1f5acb4`, con los cambios pendientes de revisión. `playwright.config.ts` y las tres migraciones anteriores de esquema, funciones y concurrencia de stock no tienen diferencias respecto de HEAD.

Cambios propios de esta revisión: aislamiento y diagnóstico en `e2e/pedidos.spec.ts`, apagado garantizado en `e2e/global-teardown.ts`, 83 pruebas SQL adicionales, script de auditoría de solo lectura y actualización de los informes. No hubo cambios de aplicación ni alteraciones adicionales del esquema.

## Alcance

Solo Supabase local y pedidos ficticios. Sin commit, push, deploy, cambios en Cloud ni avance a Fase 4B.7.
