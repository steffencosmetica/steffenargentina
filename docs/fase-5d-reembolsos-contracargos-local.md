# Fase 5D — Posventa financiera y física local

Implementación local de Fase 5D. Base: `4e72478b94d569d9dd5962f6522e79644d1b5a55`, rama `feat/catalogo-supabase`. Durante la implementación no se accedió a Supabase Cloud ni a Mercado Pago autenticado. El cierre autorizado posterior aplicó únicamente la migración 5D en Cloud, que registra 17 migraciones. La diferencia de ordinal interno se diagnosticó por lectura y se aceptó como no funcional, sin reconstruir tablas ni volver a aplicar la migración. Véase [auditoría de publicación](fase-5d-publicacion-controlada.md). El documento 5A que ya estaba sin seguimiento se conserva fuera de esta publicación.

## Alcance y aislamiento

La posventa requiere `NODE_ENV=development`, Supabase en `127.0.0.1:55321` o `localhost:55321`, `STEFFEN_MP_MODE=mock`, `STEFFEN_MP_RECONCILIATION=1`, `STEFFEN_MP_AFTER_SALES=1` y la clave de servidor del stack local. Vercel, producción y proxy externo la bloquean. Por defecto todos estos controles permanecen apagados. Un Access Token no activa nada; esta implementación no tiene cliente HTTP capaz de enviar reintegros reales.

Los flags solo se habilitan en el arnés de Playwright simulado. El worker no se instala ni arranca como servicio. Las pruebas usan pedidos ficticios, restauran checkout a false y borran sus fixtures.

## Auditoría previa e incompatibilidades

Se revisaron los documentos 5A–5C, los intentos, `private.aplicar_pago`, reservas, cancelación y despacho, roles, RLS, acciones del panel y el worker financiero. Se conservaron las 16 migraciones anteriores y las funciones comerciales originales.

El catálogo dispone de cambios de stock absoluto con versión, pero no de un movimiento de recepción de devoluciones con identificador idempotente. No se lo reutiliza para sumar stock: queda pendiente esa integración con inventario/ERP. El simulador 5C identifica una transacción acreditada por order; no representa todas las estructuras multitransacción del proveedor. Se impide inferir transacciones adicionales: el constructor de payload acepta una lista verificada y selecciona una explícitamente para un parcial, pero la ejecución local solo ofrece la transacción que el simulador acredita.

## Migración y modelo

Nueva migración: `20261110140000_posventa_pagos.sql`, exclusivamente local. Crea:

| Tabla privada | Responsabilidad |
| --- | --- |
| `refund_requests` | Intención administrativa, motivo, administrador, importe en centavos, snapshot de transacciones, clave de formulario, clave del proveedor, concesión y resultado |
| `mock_refunds` | Ledger remoto simulado, independiente de la persistencia de la respuesta local; clave nula para un reintegro externo |
| `observed_refunds` | Evidencia confirmada observada, vínculo opcional a intención local |
| `mock_chargebacks` | Recurso remoto simulado de casos, vendedor, moneda, entorno, revisión e impacto |
| `chargeback_cases` | Casos consultados y validados, resolución, plazo y documentación |
| `physical_returns` | Unidades por artículo vendido, recepción, inspección, condición, aptas/no aptas y observaciones |
| `after_sales_events` | Auditoría separada, acumulativa y sin reemplazar acreditaciones históricas |
| `after_sales_polls` | Consulta periódica recuperable, concesión, backoff y errores observables |

Agrega únicamente `refund_balance_cents` al recurso simulado existente para probar saldo insuficiente del vendedor. Las tablas tienen RLS y ningún permiso directo para anon, authenticated o service_role. Los accesos pasan por RPC SECURITY DEFINER con `search_path=''`. Las RPC administrativas exigen `private.exigir_admin()`; enviar/observar el proveedor simulado y reclamar polling solo están concedidos a service_role. No se cambian permisos financieros anteriores.

Restricciones: clave de formulario única, clave del proveedor única, un solo reintegro solicitado/en proceso/desconocido por pedido, identificación única del reintegro remoto, centavos positivos y acotados, estados válidos, fechas terminales coherentes, concesión completa y controles físicos. Hay índices por pedido, administrador/fecha, trabajos pendientes y disputas abiertas/plazo.

## Flujo administrativo

En `/admin/pedidos/[id]` se muestran importe acreditado verificable, suma confirmada de reintegros, saldo financiero, historial local y externo, devoluciones, contracargos y alertas. El total histórico del pedido conserva su sección original.

El administrador elige total del saldo o parcial, selecciona la transacción en el parcial, informa motivo y revisa un resumen. Solo entonces aparece el envío con casilla de confirmación obligatoria. PostgreSQL vuelve a comprobar autorización, recurso remoto, saldo esperado y bloqueos; alterar un campo del navegador no evita estas comprobaciones.

Se registra la intención antes del envío, se reclama por 30 segundos y se usa la clave persistida. El acuse del simulador no confirma el reintegro: una consulta separada observa el ledger. Los estados son `requested`, `processing`, `confirmed`, `rejected` y `unknown`. Un timeout, 409, fallo de PostgreSQL o respuesta incompleta conserva una intención recuperable y bloquea otra incompatible.

Hay límites serializados por administrador: 12 solicitudes/hora y 24 reclamaciones/hora. Next Server Actions conserva sus verificaciones de origen/CSRF; todas las acciones nuevas verifican sesión y administrador en servidor. Las claves del proveedor y las concesiones se excluyen de los datos enviados al componente cliente. No hay proxy hacia URLs arbitrarias.

En faltantes de stock se exige declarar el contacto previo con el comprador y se audita esa declaración; no se envía correo real. Después del despacho se muestra la gestión individual por motivo. No se exige devolución física para ejecutar todo reintegro. Las solicitudes de arrepentimiento conservan su circuito original.

## Proveedor y documentación oficial

Consultado el 11/11/2026:

- [Reembolsos y cancelaciones Orders API](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/refunds-cancellations).
- [Referencia de reembolso](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro/refund-order/post).
- [Notificaciones de contracargos](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/chargebacks/notifications).
- [Gestión de contracargos](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/chargebacks/manage).

El constructor prepara POST `/v1/orders/{order_id}/refund`: para total, omitir completamente el body; para parcial, `transactions: [{id, amount}]`, seleccionando una transacción. El importe es una cadena decimal exacta. No se inventa un importe para el total ni se distribuye automáticamente un parcial entre transacciones. Se prepara una clave X-Idempotency-Key estable, no una clave por llamada.

La documentación contempla parciales sucesivos, saldo disponible del vendedor y límite temporal de reintegro de 180 días. Se bloquean operaciones locales fuera de ese plazo. Los 409 por clave reutilizada, reintegro previo o procesamiento no autorizan crear una nueva intención: se debe consultar el resultado.

El adaptador server-only `refund-provider.ts` usa RPC autenticadas del simulador y timeouts de cuatro segundos. `refund-flow.ts` garantiza consulta independiente incluso ante error de envío; solo reconoce confirmed/rejected como terminales. El constructor usa centavos enteros y rechaza montos fraccionarios, inseguros, superiores al saldo o transacciones duplicadas/desconocidas. PostgreSQL usa bigint/numeric, incluyendo envío histórico dentro del monto pagado.

La implementación no verifica la semántica real de un total vacío después de parciales ni la forma real del historial de refunds de una order. Esa validación externa es obligatoria antes de sustituir el simulador. Ninguna respuesta real fue fabricada ni se envió una solicitud al proveedor.

## Idempotencia y recuperación

El orden de bloqueo es pedido antes de intención/recurso y permite serializar administradores distintos. Una concesión vencida se renueva con UUID diferente, conservando provider_key. El proceso anterior no puede enviar ni finalizar con un fencing token viejo. El envío simulado vuelve a comprobar concesión, transacción, saldo, estado y disputas bajo bloqueo; una clave ya registrada devuelve el resultado anterior.

Si el movimiento remoto ocurrió y no se guardó la respuesta, webhook, polling o una recuperación administrativa pueden encontrarlo por su clave persistida. Un webhook que llega primero confirma la intención por evidencia; la respuesta tardía no duplica el asiento. Si no hay evidencia concluyente, permanece bloqueada y visible. Una concesión de envío expirada sin evidencia se clasifica como resultado desconocido al observarse. El trabajador solo consulta; nunca decide un reintegro comercial nuevo ni cambia su clave.

Los parciales confirmados reducen el saldo acumulado. El siguiente total usa el saldo restante. Los reintegros externos se registran sin inventar administrador o solicitud local y reducen la disponibilidad para otra solicitud. Cambios incompatibles de identidad o importe de una evidencia histórica generan incidencias; no reemplazan el registro anterior.

## Devoluciones físicas e inventario

Estados: solicitada → coordinada → recibida → inspeccionada → resuelta. Se valida la suma de devoluciones por artículo contra cantidades vendidas. Las transiciones repetidas son idempotentes y una inspección repetida no puede cambiar las cantidades ya aceptadas.

Se registran fechas, condición sellado/abierto/usado/dañado/mixto, aptas y no aptas. Abierto, usado o dañado no admite unidades aptas. Recibir o inspeccionar no modifica el saldo financiero. Reembolsar no modifica estas fechas ni implica recepción. Ninguna función nueva modifica productos, reservas o movimientos de inventario. El panel advierte que la reincorporación requiere la integración administrativa pendiente.

## Contracargos y conciliación

Se reutiliza el receptor firmado de 5C para `order.charged_back` y las consultas autenticadas del simulador. El body de la notificación no alimenta importes ni estados financieros. Después de verificar la order, el observador consulta los casos simulados y comprueba vendedor local, ARS, entorno no productivo, transacción, importe y revisión. Las revisiones antiguas no reabren casos resueltos. Se auditan apertura, cambios, ganancia/pérdida e impacto confirmado.

El panel muestra casos abiertos ordenados por vencimiento, documentación pendiente, próximos a vencer en 48 horas y vencidos. Las notas y referencias internas a evidencia quedan auditadas. No se cargan archivos al proveedor ni se acepta una disputa automáticamente. Un caso abierto o perdido bloquea el envío de un reintegro; si existe un reintegro externo y contracargo sobre el mismo pago, hay incidencia visible de solapamiento. El impacto del caso no se suma otra vez como reintegro.

La documentación distingue las notificaciones de Order y el tópico independiente de Chargebacks. Esta fase local utiliza la notificación de Order y polling para descubrir el caso: no expone ni afirma compatibilidad productiva con el tópico independiente. La integración real deberá consultar GET `/v1/chargebacks/{id}` con vendedor y credenciales de prueba autorizadas, normalizar documentación/plazo/resolución y validar la vinculación a las transacciones de la order. No se infiere que toda falta de cobertura sea una disputa perdida.

`after_sales_polls` se crea al registrarse una acreditación y se integra con `payment-worker.ts` únicamente si el flag 5D está activo. También observa las orders ya acreditadas del simulador. Sus RPC reclaman con SKIP LOCKED y concesión de 30 segundos, finalizan con el mismo fencing token y programan una consulta cada 15 minutos. Un error produce backoff de 30 segundos hasta una hora, conserva el trabajo y cuenta fallos; diez errores no eliminan el trabajo. `--health` agrega contadores de degradados, reintegros desconocidos y disputas. Las alertas financieras también quedan en el panel y el ledger; no dependen solo de logs. El worker de correo sigue separado.

La confirmación inicial continúa en `private.aplicar_pago()` mediante 5C. Posventa no vuelve a invocarla para un refund o chargeback ni degrada `orders.payment_status` aprobado. Preparación y despacho conservan su estado. Los pagos de pedidos cancelados sin acreditación local histórica siguen bloqueados como incidencia de 5C: el administrador no puede convertirlos manualmente en una acreditación para reintegrarlos.

## Pruebas y evidencias

| Verificación | Resultado |
| --- | --- |
| TypeScript | Aprobado |
| Build productivo de Playwright general y build final aislado local | Aprobados |
| Unitarias y auditorías estáticas | 160 aprobadas |
| pgTAP completo | 938 aprobadas, 14 archivos; 86 nuevas de posventa |
| Concurrencia real | 23 aprobadas, incluidas dos sesiones administrativas y dos conciliadores |
| Playwright general | 167 aprobadas |
| Playwright Mercado Pago simulado | 26 aprobadas, desktop y mobile |
| Funcionalidades apagadas | 10 aprobadas, incluido bloqueo de posventa aun con flags mock en producción |
| Traefik | 8 aprobadas |
| Secretos en assets públicos | 43 assets por build general, apagado y proxy aprobados, incluida firma simulada y ausencia de RPC financieras privilegiadas |

Se verificó la migración completa reconstruyendo únicamente sus tablas locales vacías y funciones nuevas en una transacción; las 16 migraciones previas permanecen sin modificaciones. El script temporal de esa comprobación está en una ruta ignorada y no forma parte de la publicación.

La concurrencia específica 5D se repitió sobre el esquema final y aprobó nuevamente. Lectura final de Supabase local: PostgreSQL healthy, 17 migraciones, última `20261110140000`, checkout deshabilitado, cero pedidos, intentos, trabajos financieros, solicitudes/reembolsos, casos, devoluciones y polls. RLS y ausencia de permisos directos verificadas; `private.aplicar_pago` sigue privada. `pg_cron` ausente y cero procesos `payment-worker` activos. El catálogo local queda sin productos tras la limpieza de fixtures; no se copiaron datos de Cloud.

Git conserva la rama `feat/catalogo-supabase` y HEAD `4e72478b94d569d9dd5962f6522e79644d1b5a55`. Los cambios 5D están sin commit. El documento 5A sin seguimiento era preexistente y se conserva. No se ejecutaron commit, push, deploy ni cambios en Cloud.

Cobertura nueva: payload total sin body y parcial exacto, múltiples transacciones en constructor, límites de saldo, parciales sucesivos y total restante, doble clic, administradores concurrentes, concesión vencida, fencing, fallo entre envío y persistencia, consulta tras timeout/red/409, saldo insuficiente del vendedor, reembolso externo, permisos y RLS, estados de devolución, cantidades acumuladas y cero reincorporación, disputa abierta/ganada/perdida, vendedor/importe inconsistentes, revisión antigua, documentación faltante y solapamiento financiero.

Los tests de regresión conservan checkout, acreditación tardía con/sin stock, cancelación, reservas, correo simulado y protecciones existentes. Las suites que comparten PostgreSQL deben ejecutarse secuencialmente. No se aumentaron timeouts ni eliminaron pruebas previas. Se corrigió un selector nuevo de inspección para usar el nombre accesible del combobox. La prueba de fallo real de persistencia detectó que el formulario se desmontaba al bloquearse una intención y perdía su mensaje de resultado pendiente: el aviso ahora depende del historial durable. También se comprueba que una inconsistencia de order no borre el importe acreditado histórico y que las incidencias sigan visibles después de cien eventos adicionales.

Capturas responsive locales generadas por Playwright: `posventa-reintegros.png` y `posventa-devolucion-contracargo.png` en los directorios de cada proyecto desktop/mobile dentro de `test-results-pago-local`. Son datos ficticios y artefactos ignorados por Git.

Una corrida inicial de concurrencia coincidió con Playwright sobre la misma base y sus fixtures se interfirieron; ese resultado no se usa como validación. Se repitió aisladamente y aprobó 23/23. Las corridas que detectaron el selector de inspección y el aviso perdido también se repitieron después de corregirlos. La tabla informa las últimas comprobaciones, no oculta esos hallazgos.

## Límites pendientes para staging

1. Mantener bloqueada toda activación real: vigencia de order frente a reserva de 30 minutos, recuperación de claves/409 y búsqueda siguen condicionadas por las pruebas externas de 5B/5C.
2. Validar cuentas y aplicación de prueba, transacciones múltiples, saldo e historial real de refunds, total después de parciales, estados diferidos, timeout después de aceptación y respuestas 409 reales. El simulador prueba consistencia local, no reproduce un banco ni garantiza tiempos de liquidación.
3. Implementar y probar el transporte HTTP real y la consulta de Chargebacks, incluido tópico independiente, firma, payloads reales y resolución documentada. Actualmente no existe una ruta de activación real.
4. Mantener el HTTPS y PostgreSQL de staging aislados de Steffen Cloud. No registrar un webhook de producción. No instalar cron ni procesos en Vercel.
5. Diseñar movimiento explícito de recepción apta con inventario/ERP y protección contra doble reincorporación. Hasta entonces solo hay registro físico.
6. La presentación de evidencia, aceptación de disputas y resolución comercial/legal requieren gestión individual. No hay envío automático ni sustitución/espera impuesta al comprador.
7. La devolución de pagos recibidos sobre pedidos cancelados sin acreditación histórica local y pagos duplicados adicionales requiere ampliar la evidencia por transacción antes de permitir ejecución desde el panel. Se mantiene el bloqueo seguro y la incidencia de 5C.

## Archivos

- Modelo/migración y pgTAP: `supabase/migrations/20261110140000_posventa_pagos.sql`, `supabase/tests/database/posventa_pagos.test.sql`.
- Servicios y modelos: `src/lib/orders/after-sales{,-model,-config,-reconciliation}.ts`, `refund-provider.ts`, `refund-flow.ts`, pruebas unitarias correspondientes y tipos de Supabase.
- Panel: `AfterSalesPanel.tsx`, listado, detalle y acciones de pedidos; estilos administrativos.
- Ejecución y pruebas: `scripts/payment-worker.ts`, `e2e/checkout.spec.ts`, `playwright.pago-local.config.ts`, concurrencia de pedidos y auditorías de Server Actions/secretos.
- Configuración/documentación: `.env.example` y este documento. Los scripts temporales de reconstrucción local y capturas permanecen en rutas ignoradas.
