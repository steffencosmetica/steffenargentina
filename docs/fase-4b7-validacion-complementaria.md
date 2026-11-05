# Fase 4B.7 — validación complementaria

Fecha de cierre de validación: 04/11/2026.

Este informe complementa `fase-4b7-informe.md`. La autorización posterior permite activar temporalmente checkout **solo en las pruebas locales**. Las exclusiones del informe inicial corresponden a la autorización anterior y se cierran con esta ejecución. Los documentos legales continúan como borradores; aprobar pruebas no equivale a aprobar textos ni políticas comerciales.

## 1. Destino y aislamiento

Antes de probar se verificaron el contenedor `/supabase_db_steffen-web`, su mapeo PostgreSQL al puerto 55322, la API `http://127.0.0.1:55321`, la conexión a `127.0.0.1:55322`, base `postgres`, rol `postgres` y checkout inicialmente apagado.

`e2e/local.ts` valida el hostname local y ejecuta psql dentro de ese contenedor. Las claves de prueba se obtienen del estado del stack local, sin imprimirlas; no se usan credenciales de Cloud ni el login global. Playwright sobrescribe URL y claves con los valores locales. La concurrencia usa el mismo contenedor y API fijos. pgTAP informó conexión a la base local.

Las suites de base se ejecutaron secuencialmente: pgTAP, concurrencia y luego Playwright, para no mezclar fixtures. Se usó la activación existente de los tests (`setLocalCheckout` y sus fixtures SQL locales), con restauración y limpieza al terminar. No se alteraron reglas de negocio ni se aumentaron timeouts o reintentos. Se actualizó únicamente el recorrido de teclado esperado por la prueba de accesibilidad para cubrir los dos enlaces nuevos, como se detalla abajo.

## 2. Resultados

| Ejecución | Resultado |
| --- | --- |
| `npm run db:test` | **649/649**, diez archivos; incluye las **252/252** comprobaciones anteriormente excluidas |
| `npm run test:concurrency` | **15/15**, conexiones y carreras reales |
| `npm run test:e2e`, sin exclusiones | **148/148**, incluidas las **21/21** antes excluidas y las dos pruebas nuevas de entrega/duplicados; cero omitidas |
| `npx tsc --noEmit` | Aprobado después de ampliar las pruebas |
| Build de producción contra Supabase local | Aprobado por `npm run build` dentro del servidor Playwright |
| `git diff --check` | Sin errores |

Las advertencias pgTAP por división por cero, falla de liberación y clave ausente proceden de escenarios de fallo deliberados: sus comprobaciones y rollback pasaron. No se interpretaron las advertencias como éxitos sin comprobar el resultado TAP.

La primera corrida general de Playwright terminó con **144 aprobadas, una fallida y tres no ejecutadas**. Detectó un fallo reproducible en `checkout.spec.ts`, «accesibilidad: etiquetas, autocompletado, teclado y anuncios»: esperaba foco en `ck-submit` tras un Tab desde la casilla, pero ahora lo recibe el enlace de términos. No era un problema de sincronización. La suite serial omitió sus tres pruebas responsive posteriores. Se conservó el recorrido completo de compra por teclado y se añadieron comprobaciones obligatorias de foco, href y apertura en otra pestaña para Términos y Privacidad, antes de verificar el foco y Enter en Confirmar. No se removieron las comprobaciones previas ni se quitó accesibilidad a los enlaces para hacer pasar el test. La evidencia inicial está en `artifacts/4b7/complementaria/fallo-inicial-accesibilidad.md`; la repetición general se informa en la tabla definitiva.

La concurrencia comprobó última unidad, idempotencia SQL y HTTP, varios productos sin deadlocks, compras frente a vencimientos, cancelación/liberación exactamente una vez, pagos duplicados o tardíos, límites antiabuso y versiones de notas entre administradores. Las notificaciones de pago son simuladas exclusivamente en local; no se utilizó una pasarela ni se realizaron pagos reales.

## 3. Auditoría del arrepentimiento

### Recorrido completo y persistencia

1. La persona abre `/arrepentimiento` desde el acceso destacado, sin cuenta ni sesión.
2. Informa referencia de compra y email. No se exige motivo, domicilio, contraseña, documento o tarjeta.
3. El navegador genera UUID de idempotencia; el servidor valida y llama a `registrar_arrepentimiento` con la clave del servidor local y una IP de origen confiable.
4. La función genera código `ARR-` con UUID aleatorio, protegido por UNIQUE. Guarda código, fecha del servidor, referencia, email, estado `recibida`, versión, clave técnica y HMAC de IP.
5. Inserción e historial se confirman juntos. La respuesta contiene únicamente código y fecha, sin consultar ni confirmar que la compra exista.
6. La web muestra la constancia, mueve el foco y permite imprimir/guardar. La bandeja administrativa permite gestionar y consultar el historial con sesión autorizada.

No se cambia el estado financiero de un pedido, no se libera stock y no se realizan reembolsos al recibir o cerrar solicitudes. La evaluación de compra, identidad y procedencia es manual; recibir una solicitud no supone aceptar o rechazar su procedencia.

### Entrega y fallos: alcance real

La entrega implementada es la **respuesta inmediata en la propia web**. No existe correo automático, cola de notificaciones, reenvío persistente ni acuse de lectura del consumidor. La fecha de recepción en base no demuestra que la pantalla haya llegado a mostrarse.

- Si falla antes de registrar, la interfaz muestra error y no inventa una constancia.
- Si la base confirma pero la respuesta se pierde, el registro permanece. Reintentar con los mismos datos, en el mismo formulario y con la misma IP conserva la clave y recupera el mismo código, sin otro registro ni evento.
- Si se recarga o abandona la página, la clave solo en memoria se pierde. Un envío posterior con otra clave puede crear otra solicitud; no hay recuperación pública por email o referencia, para evitar revelar datos.
- Un cambio de IP durante el reintento con la misma clave es rechazado: la función exige la huella original. Cambiar datos con esa clave también es rechazado, sin revelar el registro previo.
- La constancia puede imprimirse/guardarse desde el navegador; no se guarda automáticamente en el dispositivo ni se envía por email.

**Pendiente operativo antes de publicar:** designar responsable y procedimiento de revisión de la bandeja, contacto y entrega alternativa del código cuando haya fallado la respuesta. El sistema actual no garantiza por sí solo la comunicación alternativa dentro del plazo legal si la persona no recupera la respuesta web. Debe aprobarse y verificarse ese procedimiento; no se declara implementada una automatización inexistente.

Las pruebas de respuesta perdida después del commit, servicio inaccesible antes de recibir y diez reenvíos simultáneos con la misma clave pasaron en ambas corridas generales. Se comprobó un único registro y evento al recuperar la respuesta perdida, ningún registro ni constancia ficticia ante el servicio inaccesible y un único código persistido para los diez reenvíos.

### Validaciones y abuso

Se verifican JSON y origen, límite de 4096 bytes aun con cuerpo transmitido por fragmentos, estructura de datos, referencia de 3–100 caracteres sin controles, email de hasta 254 caracteres, UUID y honeypot. SQL vuelve a validar datos. Los parámetros no se concatenan como SQL.

El límite persistente es cinco solicitudes nuevas por huella de IP por hora, con locks para carreras reales. Se agrupa IPv6 conforme a la función existente. El reintento válido de la misma clave recupera el código incluso al alcanzar el límite. La IP original no se almacena en las tablas nuevas; se guarda HMAC. El honeypot es complementario, no una prueba infalible de humanidad. No se implementó CAPTCHA externo ni se afirma protección absoluta contra bots distribuidos. Se ofrece contacto institucional como alternativa.

En Vercel se toma IP del proxy previsto. Sin IP confiable o clave de servidor se responde 503. Un despliegue futuro con otro proxy requiere configurar y validar la confianza de cabeceras antes de publicar.

### Duplicados

La idempotencia se aplica a la clave, no a la coincidencia de referencia y email. Mismos datos/clave/IP devuelven el mismo código; distinto contenido o IP con esa clave no devuelve información privada. Claves nuevas pueden originar varias solicitudes para la misma compra, sujetas al límite. Deben reconciliarse manualmente sin ejecutar dos devoluciones o reembolsos; no se deduplica automáticamente por compra ni se toca el pedido.

### Permisos y privacidad

- RLS activa en solicitudes e historial; lectura limitada a `is_admin()`.
- Anon no puede leer las tablas ni ejecutar las RPC nuevas.
- Authenticated no administrador obtiene cero filas por RLS y no puede gestionar; la función administrativa verifica autorización antes de consultar existencia.
- Recepción SQL reservada al servidor; no hay escritura directa de tablas para anon, authenticated o service_role.
- Grants de lectura administrativa no incluyen huella de IP ni clave de idempotencia. La gestión usa sesión y `requireAdmin()`.
- Las funciones definer tienen `search_path` vacío y no tienen EXECUTE de PUBLIC.
- La respuesta pública no incluye referencia, email, direcciones o datos de pedidos; no hay endpoint público de consulta de solicitudes.
- Respuestas `no-store` y `no-referrer`; sin datos personales en URLs, metadata ni logs del endpoint. El historial no duplica el contacto.
- Cambios de estado y eventos son transaccionales, con versión optimista; una versión obsoleta no sobrescribe otra gestión.

## 4. Páginas e integración

| Página | Resumen del borrador |
| --- | --- |
| `/terminos-y-condiciones` | Identificación pendiente, alcance, productos, precios ARS, stock, compra, confirmación, pagos futuros, envío y atención |
| `/politica-de-privacidad` | Datos reales, finalidades, proveedores, almacenamiento, conservación y derechos; sin prometer borrado automático |
| `/envios-y-entregas` | Cobertura y tarifa configuradas, gratuidad condicionada, preparación y transporte manual; sin operadores o plazos inventados |
| `/cambios-y-devoluciones` | Arrepentimiento, defectos, errores de envío y cambios voluntarios pendientes; sin prohibición general por cosméticos abiertos |
| `/arrepentimiento` | Información y recepción pública sin registro, constancia y contacto alternativo |

Footer compartido: cuatro enlaces legales, sin duplicar el acceso destacado al arrepentimiento. Checkout: enlaces a términos y privacidad, casilla desmarcada y aceptación explícita; no se almacena consentimiento ficticio. La recepción de arrepentimiento no depende de que el checkout esté habilitado. Las páginas están marcadas **borrador pendiente de aprobación**, con `noindex`; no son documentos definitivos aprobados.

## 5. Confirmaciones necesarias antes de publicar

- Identidad legal del vendedor y responsable de datos, CUIT, domicilios y relación con la marca.
- Canales institucionales para compras/reclamos/privacidad, área responsable, horarios, reemplazos y operación de solicitudes, especialmente respuesta perdida.
- Cobertura, tarifas, umbrales y plazos reales de envíos; operadores y coordinación de devoluciones.
- Si se ofrecen cambios voluntarios: plazos, condiciones y costos sin limitar obligaciones legales.
- Facturación, condición impositiva, comprobantes y datos necesarios.
- Proveedores/regiones y transferencias de datos; conservación y procedimiento de supresión.
- Revisión profesional y aprobación expresa de los cinco borradores, incluida interpretación sobre apertura, uso o consumo efectivo y comunicación del código.

Detalle y fuentes: `docs/legal-pendientes.md`. Ninguna de estas decisiones se dio por aprobada durante las pruebas.

## 6. Migraciones y archivos

Única migración de la fase: `supabase/migrations/20261105120000_arrepentimiento.sql`, aplicada previamente solo en local. Esta validación no crea ni vuelve a aplicar migraciones y no modifica las anteriores.

En esta continuación se añaden pruebas a `e2e/legal.spec.ts`, se amplía el recorrido accesible en `e2e/checkout.spec.ts` y se actualizan `docs/fase-4b7-informe.md`, `docs/legal-pendientes.md` y este informe de auditoría. No se modifica código de negocio para conseguir que pasen las pruebas pendientes.

Archivos de implementación ya presentes: grupo `src/app/(legal)`, API `src/app/api/arrepentimiento`, bandeja y acciones `src/app/(admin)/admin/(panel)/arrepentimientos`, componentes `src/components/legal` y `RevocationManagement`, `src/lib/legal`, CSS legal, integración de SiteShell/SiteFooter/CheckoutForm/AdminShell, rutas administrativas, tipos Supabase, configuración de cabeceras, prueba SQL y limpieza e2e. El listado exacto final está en el estado de Git de la entrega.

## 7. Cierre

Después de terminar Playwright y su limpieza se ejecutó una transacción explícita `BEGIN READ ONLY` en el contenedor local y se confirmaron los siguientes valores:

| Comprobación | Estado final |
| --- | --- |
| `checkout_enabled` | **false** |
| Pedidos / artículos / eventos de pedido | **0 / 0 / 0** |
| Intentos de checkout | **0** |
| Solicitudes de arrepentimiento / eventos | **0 / 0** |
| RLS en pedidos, solicitudes e historial de solicitudes | **Activa** |
| pg_cron | **Ausente** |
| Migración `20261105120000` en local | **Registrada**, sin volver a aplicarla |

Evidencia local: [estado final de Supabase](../artifacts/4b7/complementaria/estado-final-local.json) y [listado exacto de archivos modificados/nuevos](../artifacts/4b7/complementaria/git-status-final.txt). Esos archivos de evidencia están ignorados por Git. La consulta final no efectuó escrituras; no fue necesaria limpieza adicional a los mecanismos de las suites.

Todas las pruebas antes excluidas pudieron ejecutarse de manera segura en local y están aprobadas en la repetición definitiva. No queda una exclusión técnica pendiente de esas suites. Sí permanecen las confirmaciones fiscales, comerciales, legales y operativas de los apartados anteriores; en particular, no se declara garantizada la entrega alternativa del código ante una respuesta web perdida.

Sin cambios en Cloud, commit, push ni deploy. Rama `feat/catalogo-supabase`, commit de partida `95a9e0f`; cambios de 4B.7 siguen sin commit. No se avanza a 4B.8.
