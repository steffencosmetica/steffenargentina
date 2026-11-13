# Fase 5E — Comunicaciones, recuperación y Facturas C (local)

Fecha de trabajo: 12 de noviembre de 2026. Base aprobada: `2cac422cfafe44bf8b9e4c1ea9d8c8b179b03a93`, rama `feat/catalogo-supabase`.

## Alcance y aislamiento

La implementación inicial se realizó exclusivamente contra Supabase local (`steffen-web`, API 55321, PostgreSQL 55322). No se enviaron correos reales, no se emitieron comprobantes en ARCA y no se hicieron operaciones reales de Mercado Pago. La auditoría y publicación autorizadas posteriormente se documentan en [fase-5e-publicacion-controlada.md](fase-5e-publicacion-controlada.md).

`STEFFEN_ORDER_COMMS=1` requiere además el destino exacto de Supabase local y ausencia de Vercel. El envío de correos de pedidos requiere `MAIL_TRANSPORT=archivo` y un origen HTTP loopback canónico en `MAIL_LINK_BASE_URL`. Ausente el flag, la funcionalidad está apagada. Configurar credenciales no la habilita. Las páginas y APIs de recuperación también conservan los enclavamientos existentes de checkout y legales.

El transporte SMTP anterior de arrepentimiento se conserva. Para las comunicaciones nuevas hay un bloqueo adicional en `smtpTransport`: rechaza mensajes de tienda antes de llamar a SMTP. El worker sin el flag reclama exclusivamente comunicaciones anteriores. No se habilitó ningún proceso productivo.

## Auditoría y arquitectura reutilizada

Se revisaron las fases 4B.7 y 5B–5D, `orders`, `order_items`, `order_events`, `private.aplicar_pago()`, despacho administrativo, roles, RLS, seguimiento privado y `scripts/mail-worker.ts`.

Se reutilizan la única cola `public.revocation_messages`, sus intentos y eventos, el registro `private.mail_workers`, el ejecutor CLI, el drenaje posterior a la respuesta de Next y el monitor `/api/interno/comunicaciones`. No se incorporó otra cola ni otro servidor de correo.

La confirmación financiera y la reserva de 30 minutos mantienen sus reglas. `private.aplicar_pago()` no se reemplaza: un trigger sobre sus eventos registra el trabajo de correo dentro de la misma transacción. Si falla la persistencia del trabajo, la transición se revierte y el conciliador financiero puede recuperarla. El envío al proveedor sucede después del commit, nunca dentro de PostgreSQL.

Se detectó una particularidad de los eventos existentes: la acreditación tardía se registra antes de terminar de resolver stock y el wrapper de despacho fija la fecha real después del evento. Por eso el contenido correspondiente se prepara al reclamar el trabajo, consultando el estado final persistido. No se duplicó la lógica financiera.

## Migración nueva

`supabase/migrations/20261112120000_comunicaciones_facturacion.sql`. No se modificaron migraciones anteriores.

Amplía la cola existente con `order_id`, `business_key` único y los cuatro tipos nuevos. La restricción exige pedido para estos tipos y un índice parcial impide dos recuperaciones activas del mismo pedido.

Tablas privadas nuevas:

| Tabla | Finalidad |
| --- | --- |
| `order_message_data` | Snapshot comercial de la comunicación, sin token permanente ni datos personales innecesarios. |
| `order_access_tokens` | Únicamente hashes SHA-256 de tokens temporales y sesiones, vencimiento y uso. |
| `order_access_events` | Intentos de recuperación/canje/consulta, HMAC de IP y resultado. |
| `order_invoices` | Registro vigente del comprobante manual y de su envío declarado. |
| `order_office_events` | Historial administrativo con actor, motivo, valores anteriores y posteriores. |

No hay backfill que dispare correos históricos. No se modifican importes, precios, stock, reservas ni estados financieros para facturar o recuperar acceso.

## Eventos y plantillas

| Comunicación | Disparo autorizado | Idempotencia |
| --- | --- | --- |
| `pedido_recibido` | Evento `created` luego de persistir artículos y pedido. | `received:<order-id>` |
| `pago_confirmado` | `payment_approved` / `payment_approved_late` de la función financiera existente. | `paid:<order-id>` |
| `pedido_despachado` | Transición efectiva a `shipped`, confirmada por admin. | `dispatch:<order-id>` |
| `recuperacion_pedido` | Solicitud con código y email coincidentes, después de límites antiabuso. | UUID por solicitud válida; una activa por pedido. |

Los eventos duplicados no crean otro correo comercial. Una consulta, el retorno del navegador, una notificación sin verificar o la conciliación repetida no generan acreditaciones ni nuevos correos.

`src/lib/mail/order-templates.ts` produce HTML responsive y texto plano: fondo claro, texto oscuro, acento dorado, sin imágenes externas ni publicidad. Todo texto interpolado se escapa. Los importes se validan como centavos enteros, incluyendo subtotal, envío, total y cada línea histórica. Se rechazan sumas inconsistentes.

Pedido recibido indica expresamente pendiente de pago al registrar la compra; no promete preparación. Pago confirmado informa entre 1 y 3 días hábiles después de acreditar, sin incluir transporte. Si hay faltante, cancelación con incidencia, reembolso o disputa relevante al preparar el correo, se informa revisión individual y contacto sin prometer preparación o entrega.

Contacto: `info@steffenargentina.com.ar`, lunes a viernes de 8 a 16, Argentina. Andreani es el valor predeterminado al registrar despacho y se admiten otros transportistas. El seguimiento es un número literal; no se inventan enlaces de transporte.

### Correcciones de despacho

Se requiere admin, versión vigente, motivo y confirmación explícita. La función bloquea las filas de comunicaciones antes de comprobar concesiones, evitando una carrera con el reclamo del worker. Durante un envío activo rechaza la corrección.

Una comunicación nunca intentada se sustituye por los datos corregidos y queda vencida en el historial. Si hubo un intento —incluso ambiguo—, aceptación o rebote, se genera un evento explícito de corrección con otro identificador. La redacción indica «Actualizamos los datos de despacho». No se reescribe ni se borra la evidencia del correo anterior. Dos correcciones con la misma versión no se ejecutan dos veces.

Las fechas de despacho y de envío manual se convierten en el navegador desde la zona horaria del dispositivo a ISO UTC; PostgreSQL valida el instante y la interfaz lo presenta en hora argentina.

## Entrega, reintentos e idempotencia

Se conservan backoff, máximo de intentos, estado fallido, alertas, intervención administrativa y métricas de 4B.7. Los fallos permanentes de correos comerciales pueden generar una alerta interna; no se depende exclusivamente de logs. El panel del pedido muestra estado, intentos, errores clasificados y acciones administrativas permitidas. El monitor anterior incluye la cola ampliada.

Las concesiones son de 120 segundos por defecto (rango existente: 30–900). Cada reclamo tiene UUID nuevo. Antes de enviar un correo de tienda se valida la concesión; al registrar resultado PostgreSQL vuelve a comprobar identidad, estado y vigencia. Un trabajador vencido no finaliza el trabajo de otro.

El proveedor simulado publica cada mensaje de tienda una sola vez por ID: escribe un archivo temporal completo y lo enlaza atómicamente al destino estable `tienda-<id>.json`. Dos procesos concurrentes o un reinicio después de entregar pero antes de persistir el resultado recuperan la misma entrega. La concesión se comprueba nuevamente antes de publicar el archivo. Los archivos `CAIDA` y `RECHAZO` simulan fallos temporales y permanentes. Los tipos anteriores conservan su comportamiento. Un reintento del mismo ID recupera la aceptación anterior, no simula una nueva entrega ni la lectura del destinatario; el simulador no reproduce rebotes SMTP reales.

**Límite real:** SMTP no ofrece una transacción conjunta con PostgreSQL ni garantiza deduplicación por `Message-ID`. No se declara entrega exactamente una vez con Zoho. Los correos nuevos permanecen bloqueados para SMTP hasta resolver y probar la política de resultados ambiguos o un proveedor con idempotencia verificable. La infraestructura SMTP previa no se elimina ni se habilita aquí.

## Recuperación privada sin registro

Página `/pedido/recuperar`; APIs POST `/api/pedido/recuperar`, `/api/pedido/acceso` y `/api/pedido/recuperado`.

1. Código y email se normalizan y validan en servidor. La respuesta es siempre genérica para asociaciones válidas o inexistentes.
2. PostgreSQL verifica la asociación y limita solicitudes: 5/h por HMAC de IP, cooldown de 5 minutos y máximo de 3 trabajos/h por pedido. Se usa advisory lock y unicidad para solicitudes concurrentes.
3. Al reclamar el trabajo se generan 32 bytes criptográficos, se guarda solo el hash y se envía el token temporal en un fragmento `#t=`. Vence en 15 minutos.
4. La página elimina el fragmento y requiere pulsar «Ver mi pedido» para canjearlo. No canjea automáticamente por la mera visita de un escáner de enlaces.
5. El canje se serializa por comunicación, marca usados todos sus tokens hermanos y crea una sesión aleatoria de 30 minutos. Solo su hash queda en la base.
6. La sesión se entrega como cookie HttpOnly, SameSite Strict, limitada a `/api/pedido`; Secure cuando el origen es HTTPS. La respuesta solo devuelve el código. «Cerrar acceso privado» revoca su hash en PostgreSQL y elimina la cookie; una copia anterior tampoco vuelve a funcionar. La ruta POST `/api/pedido/salir` exige mismo origen y queda apagada con el resto de recuperación.
7. El seguimiento recuperado usa la misma vista y DTO del seguimiento original. La sesión sirve para consultar ese pedido; no devuelve el token permanente, no permite copiarlo y no habilita pagos mediante esa credencial temporal.

Canjes limitados a 20/h y consultas a 120/h por HMAC de IP. Se registran usos y fallos. Expirados, usados, manipulados o vinculados a otro pedido fallan sin revelar datos. Si un trabajo ambiguo de recuperación ya no tiene tokens vigentes y no existe concesión activa, una nueva solicitud puede sustituirlo; no queda bloqueado indefinidamente.

Los tokens no aparecen en paths, queries, Referer, logs, analytics ni snapshots de la cola. Las páginas son dinámicas, no-store, noindex y no-referrer; fuentes locales, sin analytics o recursos de terceros en este flujo. Las APIs exigen JSON del mismo origen y acotan el cuerpo real (512/1024 bytes). Se conserva el circuito original de token privado permanente y su autorización.

Los archivos de captura contienen deliberadamente el email de prueba y el acceso temporal para inspección local: están ignorados por Git, no son logs operativos ni deben copiarse a un entorno compartido.

## Facturas C y envío manual

Sección «Comunicaciones y Factura C» en `/admin/pedidos/[id]`, exclusivamente para administradores autorizados en servidor y RPC.

Sin comprobante se muestra pendiente de emisión. Para registrar uno se requiere punto de venta, número realmente emitido, fecha, importe en centavos, moneda ARS, motivo y confirmación. Se normalizan punto de venta a cinco dígitos y número a ocho, rechazando cero, formatos inválidos, fechas futuras, importes fuera de rango y duplicados globales de tipo/punto/número. No se asignan números, CAE ni validez fiscal.

Emitida y envío pendiente son estados distintos. Registrar un comprobante no envía nada. El envío del PDF desde Zoho se declara aparte, con admin, destinatario, estado, fecha y observaciones; solo el estado `sent` conserva una fecha de envío efectiva. Un fallo o gestión pendiente no se presenta como enviado.

Las correcciones requieren versión vigente, motivo y confirmación; preservan los valores anteriores en eventos. Corregir el registro no corrige ARCA y deja pendiente revisar el envío. La interfaz permite examinar antes/después, actor y motivo. No existe emisión ARCA, carga/generación de PDF, adjunto ni tipo de email automático de factura en esta fase.

Se permite registrar un comprobante real ya existente aunque el pedido esté impago o cancelado, pero se muestra revisión fiscal pendiente. Bloquear u ocultar un documento existente por su estado comercial destruiría trazabilidad. Esto no autoriza emitir comprobantes sobre pedidos impagos.

Reembolsos parciales/totales, contracargos, devolución física, incidencias, diferencia de importe o destinatario disparan un aviso administrativo de revisión. No eliminan ni alteran silenciosamente el comprobante. No se automatizan notas de crédito ni se presume una obligación fiscal específica: debe validarse individualmente con el responsable fiscal.

Referencias de contexto: [ARCA — Facturación de monotributistas](https://arca.gob.ar/monotributo/ayuda/facturacion.asp), [ARCA — Puntos de venta](https://serviciosweb.arca.gob.ar/genericos/guiasPasoPaso/VerGuia.aspx?id=135). Este registro administrativo no sustituye el comprobante emitido ni asesoramiento fiscal.

## Seguridad y permisos

Todas las tablas privadas nuevas tienen RLS y carecen de permisos directos para `anon`, `authenticated` y `service_role`, incluidas secuencias. Las funciones privadas no tienen ejecución pública. Solo `service_role` puede acceder a las RPC estrechas de cola, recuperación y consulta temporal. Las funciones administrativas se conceden a `authenticated`, pero exigen `private.exigir_admin()` internamente; service_role no sustituye ese control.

Cada Server Action exige `requireAdmin()`; el control de origen de Next se conserva. Las RPC validan además datos, versión, confirmación y motivo, evitando repetir un POST económico o administrativo consumido. No se expone la cola directamente al comprador, ni facturas o datos personales en el DTO público. React y plantillas escapan el contenido. Las acciones no operan como proxy de SMTP, Mercado Pago o ARCA.

## Archivos principales

- Migración y pgTAP: `supabase/migrations/20261112120000_comunicaciones_facturacion.sql`, `supabase/tests/database/comunicaciones_facturacion.test.sql`.
- Correo reutilizado: `scripts/mail-worker.ts`, `src/lib/mail/{server,worker,templates,transports}.ts`; nuevos `order-config.ts`, `order-templates.ts`, `order-mail.test.ts`.
- Recuperación: `src/app/(tienda)/pedido/recuperar/page.tsx`, `src/components/checkout/OrderRecovery.tsx`, tres APIs y `src/lib/orders/recovery-server.ts`; seguimiento existente ampliado.
- Administración: `src/lib/orders/office.ts`, `office-model.ts`, `src/components/admin/OrderOfficePanel.tsx`, página y actions de pedidos, transportista predeterminado.
- Tipos, `.env.example`, etiquetas del monitor y pruebas unitarias, de concurrencia y Playwright ampliadas. Configuraciones e2e siempre locales y con transportes explícitos.

## Pruebas y evidencia

Las suites completas se ejecutan secuencialmente para no compartir fixtures activos de PostgreSQL. No se eliminaron ni debilitaron pruebas anteriores. Registro local de ejecución: `artifacts/fase-5e/release-tests/` (ignorado, sin credenciales).

| Verificación | Resultado |
| --- | --- |
| TypeScript | Aprobado. |
| Build productivo | Aprobado en builds general, funcionalidades apagadas y Traefik, siempre con Supabase local. |
| Unitarias y auditorías estáticas | 173/173, incluida la auditoría final. |
| pgTAP completo | 1.009/1.009, 15 archivos, incluida revocación. |
| Concurrencia real completa | 24/24; repetición específica de 5E también aprobada después de ajustes finales. |
| Playwright general | 170/170. |
| Mercado Pago simulado | 28/28, desktop y mobile. |
| Funcionalidades apagadas | 10/10; sección administrativa nueva oculta y las tres APIs de recuperación responden 404. |
| Traefik real local | 8/8. |
| Bundles públicos | 44 assets por build general/apagado/proxy, sin claves de servidor, SMTP, monitor, webhook o proxy. |
| Vistas previas | Seis HTML y seis textos generados sin base ni envío; doce capturas 390/1440 sin desbordes. |
| SQL completo de migración | Compilado desde estructuras previas dentro de transacción local terminada con ROLLBACK. |

Las pruebas específicas detectaron y permitieron corregir una referencia PL/pgSQL ambigua al guardar el snapshot de despacho y la interpretación de fechas locales de envío manual en el servidor. Se añadió serialización entre corrección de despacho y reclamo de correo, auditoría del vencimiento de recuperaciones ambiguas y validación del día fiscal argentino. Las suites afectadas se repitieron después de las correcciones.

Capturas locales, no versionadas: `artifacts/fase-5e/screenshots/`, incluyendo `pedido-recibido-390.png`, `pago-confirmado-1440.png`, `pago-con-incidencia-390.png`, `recuperacion-mobile.png` y `factura-c-mobile.png`. Las plantillas se inspeccionaron visualmente en Chromium sin acceso de red. Las capturas de una página administrativa completa pueden incluir el encabezado fijo del navegador de pruebas.

Supabase local al cerrar fixtures: saludable, 18 migraciones, última `20261112120000`; checkout deshabilitado; cero pedidos, intentos de pago, solicitudes de reembolso, facturas, mensajes de pedido o tokens de acceso. Cinco eventos técnicos de recuperación fallida de pruebas permanecen como auditoría, sin pedido asociado. Todas las tablas privadas nuevas tienen RLS y no permiten acceso directo de anon/authenticated/service_role; pg_cron ausente. No se dejaron procesos autónomos de envío o financieros activos fuera de los ciclos controlados de prueba.

Git conserva `feat/catalogo-supabase` y HEAD `2cac422cfafe44bf8b9e4c1ea9d8c8b179b03a93`, con cambios locales de 5E sin commit, push ni deploy. Se preservó el archivo preexistente no versionado `docs/fase-5a-mercadopago-arquitectura.md`; no forma parte de los cambios implementados de 5E. Logs, capturas, previews y herramientas de auditoría generadas permanecen ignorados.

Para reproducir las comprobaciones: `npm run typecheck`, `npm test`, `npm run db:test`, `npm run test:concurrency`, `npm run test:e2e`, `npm run test:e2e:pago-local`, `npm run test:e2e:carrito-apagado`, `npm run test:e2e:proxy`; luego `node scripts/audit-local-build.ts` sobre cada build. Las configuraciones de Playwright fijan Supabase local y sus transportes, sin heredar destinos Cloud o SMTP. El build de producción de las suites general/apagada/Traefik también verifica TypeScript.

Para inspección manual de plantillas se pueden abrir los JSON generados en `.mail-capturas-e2e/` tras la prueba de un pedido. `html` y `text` contienen las dos alternativas del mensaje. Para un ciclo manual, preparar un archivo de entorno **local ignorado** con Supabase local, la clave obtenida del stack local, `STEFFEN_ORDER_COMMS=1`, `MAIL_TRANSPORT=archivo`, `MAIL_CAPTURE_DIR`, `MAIL_FROM` institucional y `MAIL_LINK_BASE_URL=http://localhost:<puerto>`; ejecutar el worker existente con `node --env-file=<archivo-local> scripts/mail-worker.ts --once`. No copiar credenciales de Cloud o SMTP a ese archivo.

Cobertura nueva: importes y escape HTML; plantilla normal y con incidencia; despacho/corrección; flags; idempotencia del proveedor; caída/reintento; aceptación con resultado perdido y reinicio; versiones y concesiones; facturación/manual-envío/auditoría/permisos; rollback de transición financiera si falla persistir el trabajo; pago tardío sin stock; revisión por reembolso/contracargo; recuperación correcta/incorrecta/inexistente/manipulada/vencida/usada/ajena; ráfagas, cuerpo acotado, CSRF y ausencia de tokens en requests URL. Concurrencia real: dos reclamos, renovación y fencing, solicitudes/canjes simultáneos y administradores con la misma versión.

### Vistas previas sin base de datos

`npm run mail:preview` genera seis ejemplos ficticios en `.mail-capturas/previews/`, cada uno en HTML y texto plano. Se pueden abrir directamente en el navegador. El script no lee credenciales, no accede a PostgreSQL y no crea un transporte de envío. Incluye caso normal, incidencia, despacho, corrección y recuperación; su token de muestra no está vinculado a ningún pedido.

## Pendientes para VPS y Zoho

No está autorizada la activación real. Antes requiere resolver la ambigüedad SMTP indicada, aprobación explícita, dominio/casilla institucional, SPF/DKIM/DMARC, remitente y Reply-To verificados, credenciales dedicadas fuera de Git, prueba de entrega/rebotes y compatibilidad responsive en clientes de correo reales.

Requiere HTTPS aislado, origen canónico validado, proxy confiable para IP, controles antiabuso externos/Turnstile cuando corresponda, secretos propios, worker único o réplicas con concesiones, reinicio supervisado y monitor externo por un canal independiente del correo. No se habilita pg_cron ni procesos en Vercel.

Debe definirse conservación/borrado de datos personales y capturas, limpieza de hashes y eventos temporales, alertas operativas con responsables y validación fiscal del circuito de comprobantes/correcciones/posibles notas de crédito. Comprobar escáneres de enlaces y cookies en navegadores reales. La recuperación temporal es de consulta; una eventual autorización de pago con sesión recuperada requiere diseño y pruebas separados.

El cierre local original conservó HEAD y rama iniciales sin publicar. La continuación con autorización expresa, migración Cloud y publicación de la rama se registra en el informe de publicación separado. No se habilitan ventas, SMTP, Mercado Pago, ARCA, cron ni workers reales.
