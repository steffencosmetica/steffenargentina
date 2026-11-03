# Administración de pedidos — Fase 4B.6

Administración de pedidos sobre `feat/catalogo-supabase`. No integra Mercado Pago ni habilita compras públicas.

La migración ya está aplicada en Cloud. La referencia UTF-8 fue regenerada y la auditoría final quedó aprobada: ver el [informe de cierre](admin-pedidos-cierre.md). El [registro de aplicación](admin-pedidos-publicacion.md) conserva el diagnóstico de la detención inicial.

## Rutas y componentes

- `/admin/pedidos`: listado, búsqueda por código/nombre/email, filtros de pago, preparación, resolución y fechas; páginas de 20 registros con orden `created_at DESC, id DESC`.
- `/admin/pedidos/[id]`: comprador, dirección, artículos e importes históricos, zona histórica, despacho, fechas e historial cronológico.
- `loading.tsx` y `error.tsx`: carga y error sin datos personales.
- `OrderControls.tsx`: confirmaciones, preparación, despacho, entrega, cancelación, resolución de faltantes y notas con guardado explícito.
- `CopyData`: copia de contacto y dirección con mensaje de éxito/error.
- Navegación incorporada en `AdminShell`; estilos responsive en `admin.css`.

Los indicadores son globales: pagados con stock consumido, por preparar y sin resolución pendiente; pedidos con resolución pendiente. Los filtros afectan la tabla y su conteo.

## Consultas y migración

`20261104120000_admin_pedidos.sql` agrega:

- `orders.admin_version`, incrementada por trigger en cada UPDATE, incluidos pagos y vencimientos.
- `admin_listar_pedidos(jsonb, integer)`: búsqueda literal, filtros, rango de días de Argentina, conteo, paginación e indicadores en una instantánea. Se invoca mediante POST RPC para evitar búsquedas personales en URLs de PostgREST.
- `admin_operar_pedido(uuid, integer, text, text, text, text, timestamptz)`: bloqueo de fila, comparación de versión y delegación a las funciones de Fase 4B.3. Una versión vieja devuelve `SR004` sin guardar ni insertar eventos.

El detalle consulta columnas explícitas de `orders`, `order_items`, `order_events` y el nombre de la provincia. Nunca selecciona tokens ni hashes. Los artículos se leen del pedido, no del catálogo actual.

La nueva migración se ejecutó con `psql` contra `supabase_db_steffen-web`. El primer intento con `migration up --local` usó por error un timestamp coincidente con la migración del carrito; se corrigió el nombre a una versión única antes de aplicarla. No había un desajuste previo del historial. Después se registró únicamente la nueva versión como aplicada con `migration repair --local --status applied 20261104120000`; no se modificaron migraciones anteriores ni el historial de Cloud.

## Operaciones y concurrencia

| Operación | Función existente |
|---|---|
| Preparar, volver a pendiente, despachar, entregar | `admin_actualizar_preparacion` |
| Cancelar reserva pendiente | `admin_cancelar_pedido` |
| Guardar notas | `admin_actualizar_notas` |
| Consumir stock repuesto y resolver faltante | `admin_resolver_faltante` |

Secuencia: `pending → preparing → shipped → delivered`; también se permite `preparing → pending`, como autoriza PostgreSQL. Preparación exige pago aprobado, stock consumido y ausencia de incidencias pendientes. El panel no escribe estados mediante UPDATE.

El despacho exige transportista y fecha válida (desde el pago hasta el momento actual). Seguimiento opcional, sin inventar enlaces externos. El navegador convierte la hora del dispositivo a ISO con zona horaria; el detalle presenta las fechas en hora argentina. La función existente registra la fecha de entrega al entregar.

Los cambios y eventos se confirman en la misma transacción. El ajuste de la fecha de despacho también está dentro de esa transacción. Los eventos de notas no copian su contenido. La versión puede avanzar más de una unidad durante el despacho; es un contador de cambios, no de operaciones.

Dos administradores que actúan sobre la misma versión no pueden sobrescribirse. Ante conflicto se pide recargar y revisar; el borrador de notas se conserva en el formulario hasta que el administrador recarga. La reserva se libera exactamente una vez conforme a la función existente.

## Incidencias y límites

Se muestran faltantes, pagos duplicados y montos incorrectos. Los dos últimos requieren revisión y posible reintegro en Fase 5. No existe una acción para aprobar pagos, simular reembolsos o cerrar incidencias financieras. No se usa `admin_marcar_resuelto` desde este panel. Un faltante sí puede resolverse transaccionalmente cuando vuelve a haber stock.

El esquema actual no tiene un estado independiente de reembolso: el panel indica la acción pendiente asociada a la incidencia, sin afirmar que un reintegro se haya realizado.

## Seguridad y privacidad

- Páginas, consultas y Server Actions verifican `requireAdmin()`; el layout mantiene además `requireAdminPage()`.
- Funciones `SECURITY DEFINER` con `search_path` vacío y `private.exigir_admin()` / `is_admin()`. RLS y permisos existentes conservados.
- Sin `service_role` para la administración; las acciones usan la sesión autenticada.
- Búsqueda mediante POST; filtros en cookie HttpOnly, SameSite Strict, con duración de una hora y alcance `/admin/pedidos`. La URL solo lleva el número de página.
- Metadata estática y `noindex`; proxy con `private, no-store` y `no-referrer`.
- Errores de pedidos sanitizados; no se registran objetos de error de la base ni contenido personal.
- No se alteró `payment_status` desde el panel ni se crearon rutas públicas con datos de compradores.

## Validación

- Unitarias y auditorías de Server Actions: `npm test`.
- TypeScript: `npx tsc --noEmit`.
- pgTAP: `npm run db:test`; incluye `admin_pedidos.test.sql` y las regresiones anteriores.
- Concurrencia real: `npm run test:concurrency`; incluye dos conexiones administrativas que compiten por la misma versión.
- Playwright y build de producción local: `npm run test:e2e`.
- Capturas: `artifacts/pedidos-{listado,detalle}-{390,768,1440}.png`.
- Bundle público: `node scripts/audit-local-build.ts` (clave del stack local, nunca impresa).

Las pruebas usan únicamente el stack de `127.0.0.1:55321/55322` y pedidos ficticios. Los fixtures están en `supabase/tests/fixtures/admin-pedidos.inc`; la extensión evita que pgTAP los ejecute como una suite independiente.

La migración de esta fase ya está aplicada en Cloud y no debe volver a ejecutarse. Las pruebas que crean pedidos o modifican stock usan exclusivamente Supabase local.

## Resultados y problemas corregidos

- TypeScript: sin errores.
- Unitarias: 107/107.
- pgTAP: 591/591, incluidas 83 comprobaciones adicionales de seguridad y compatibilidad, ejecutadas sin otra suite que modifique la base.
- Concurrencia real: 15/15, incluida la carrera entre dos administradores.
- Playwright general definitivo: **137/137**, sin fallos, omisiones ni retries, en una corrida completa de 4,9 minutos. Se reprodujo la herencia de sesión y se verificaron los contextos vacíos corregidos dentro de esa corrida. Los fixtures de pedidos están aislados por test. Ver el [informe complementario](admin-pedidos-validacion.md).
- Build de producción con configuración local: aprobado por las corridas de Playwright.
- Playwright con carrito y checkout apagados: 8/8.
- Auditoría de bundles: 38 assets públicos en cada build (compras visibles solo localmente / compras apagadas), sin la clave secreta local.
- Revisión responsive: 390, 768 y 1440 px, sin desbordes; se corrigió el estiramiento de las tarjetas de operaciones en desktop.

Otros problemas de verificación corregidos: timestamp duplicado al nombrar la migración nueva, inclusión accidental de fixtures como suite pgTAP, codificación de textos de pruebas, nombre accesible de los filtros y fallas del CLI `db query` que impedían restaurar fixtures. El helper local usa ahora `docker exec ... psql`, igual que la suite de concurrencia. Una corrida de pgTAP que se lanzó en paralelo con concurrencia fue descartada y repetida por separado.

Las limitaciones funcionales son las previstas para esta fase: sin confirmación manual de pagos, sin reembolsos y sin resolución administrativa de incidencias financieras que dependan de Mercado Pago.

| Ancho | Listado | Detalle |
|---|---|---|
| 390 px | `artifacts/pedidos-listado-390.png` | `artifacts/pedidos-detalle-390.png` |
| 768 px | `artifacts/pedidos-listado-768.png` | `artifacts/pedidos-detalle-768.png` |
| 1440 px | `artifacts/pedidos-listado-1440.png` | `artifacts/pedidos-detalle-1440.png` |

Estas capturas son evidencia local y se excluyen de Git.

## Referencia histórica al cierre de la validación local

- Supabase local: `checkout_enabled = false`, `orders = 0`, `checkout_attempts = 0`.
- Git: rama `feat/catalogo-supabase`, HEAD `17d0d94e03e848fa3d08205b36faad87d1f5acb4`.
- 9 archivos existentes modificados y 24 archivos nuevos, incluidas las 6 capturas y los archivos de la validación complementaria.
- `git diff --check`: aprobado.
- Sin commit, push ni deploy; sin cambios en Cloud, `main`, ERP o Portal Profesional.
- Fase 4B.7 no iniciada.
