# Fase 5E — Auditoría final y publicación controlada

Base aprobada: `2cac422cfafe44bf8b9e4c1ea9d8c8b179b03a93`. Única rama autorizada: `feat/catalogo-supabase`. Proyecto Supabase: `zzxlghpopmccwsaqbsko`, Steffen Web tienda. Fecha: 12 de noviembre de 2026.

## Resultado de la auditoría funcional

Se revisaron trigger de eventos, snapshots, cola 4B.7 ampliada, reclamo, concesiones, resultado, plantillas, recuperación, roles administrativos, facturación y correcciones de despacho. Pedido recibido se encola solo al crear; pago confirmado solo desde los eventos de acreditación transaccional existentes; despacho solo después de la transición manual efectiva. Las claves de evento únicas evitan duplicados y las filas se reclaman con `FOR UPDATE SKIP LOCKED`.

El registro del correo es parte de la transacción del evento comercial; SMTP nunca se ejecuta en PostgreSQL. Una caída conserva el trabajo. Cada resultado exige la concesión vigente y el UUID actual; una concesión vencida no finaliza ni sobrescribe el trabajo de otro. Los fallos permanentes siguen visibles en cola, panel y monitor. Las incidencias financieras suprimen las promesas de preparación y despacho. La deduplicación del simulador se probó con concurrencia y resultado persistido perdido; no se extrapola a SMTP.

Facturas: autorización de admin en Server Actions y RPC, confirmación, motivo, versiones y auditoría antes/después. Se registran únicamente los datos de comprobantes manuales: tipo C, punto de venta, número, fecha, ARS e importe contrastado con el total histórico. Duplicados incompatibles se rechazan; diferencias de importe, pago, devolución, reembolso o disputa generan revisión fiscal. Emitida y enviada son estados separados. Declarar el envío no genera SMTP o PDF. Reembolsos y contracargos conservan las facturas y su historial; no hay ARCA ni notas de crédito automáticas.

Despacho y correcciones: se valida fecha efectiva, transportista y seguimiento, sin enlaces inventados. Las correcciones se serializan frente al reclamo de correo, rechazan una concesión activa y producen evento diferenciado cuando el correo anterior pudo haberse enviado. No modifican stock, pagos ni importes.

## Correcciones y seguridad de recuperación

Se añadió cierre explícito de la sesión privada: RPC `revocar_acceso_pedido`, accesible solo por service_role, y POST `/api/pedido/salir` con origen verificado. El cierre marca el hash de sesión revocado (`used_at`) y elimina la cookie con el mismo path. El seguimiento exige sesión no usada y no vencida: reproducir una cookie anterior devuelve 404. La revocación no altera pedidos ni pagos. Se añadió cobertura pgTAP, CSRF, navegador y funcionalidad apagada.

Se conservan 32 bytes aleatorios, hash SHA-256, token de 15 minutos, canje atómico de un uso y sesión de consulta de 30 minutos, vinculada exclusivamente al pedido. Se revisaron anti-enumeración, rate limiting, IP mediante HMAC, canjes concurrentes, pedido ajeno, cookies HttpOnly/SameSite Strict/Secure en HTTPS, no-store, noindex y no-referrer. El fragmento se elimina antes del canje; no hay tokens permanentes en emails, Referer, analytics o recursos de terceros. El circuito de arrepentimiento anterior conserva sus pruebas completas.

Para recuperación simulada hay una sola solicitud activa por pedido, cooldown de cinco minutos, tres solicitudes por hora y ocho intentos por trabajo por defecto. No es una generación ilimitada de accesos. Los hashes hermanos de un mismo trabajo se consumen juntos en forma atómica; una recuperación ambigua sin hashes vigentes puede vencer y dar lugar a una nueva solicitud auditada. Esta estrategia de deduplicación en archivos no habilita SMTP real.

Además se reforzó `mailConfigFromEnv`: SMTP es rechazado en Vercel incluso si accidentalmente se configuran flag de envío y credenciales. Para pedidos, el transporte SMTP mantiene su bloqueo adicional independiente. Las opciones nuevas continúan exigiendo destino local y ausencia de Vercel.

## SMTP ambiguo: evidencia y bloqueo

Se añadió y probó un modelo de diagnóstico puro `smtp-evidence.ts`. No ejecuta SMTP ni representa una integración con Zoho.

| Evidencia | Interpretación |
| --- | --- |
| Respuesta final 250 y un destinatario aceptado | Aceptación confirmada por SMTP; no lectura ni entrega final al comprador. |
| Rechazo 5xx conocido | Fallo definitivo de ese intento; errores de autenticación se tratan como configuración recuperable. |
| Rechazo temporal 4xx o fallo previo a DATA conocido | Fallo temporal conocido. |
| Desconexión después de DATA, falta de respuesta final o aceptación que no pudo persistirse | Incierto: el proveedor podría haber aceptado el mensaje. |

`Message-ID` es referencia de correlación, no idempotencia demostrada del proveedor. La cola SMTP anterior es al menos una vez; su clasificador histórico de reintentos no basta para habilitar los tipos nuevos en producción. **SMTP de pedidos permanece bloqueado y MAIL_ALLOW_REAL_SEND no se habilitó.** No se modificaron variables remotas, credenciales ni trabajadores.

Mecanismos oficiales investigados:

- [Zoho Mail — Delivery Logs](https://www.zoho.com/mail/help/adminconsole/log-reports.html): búsqueda administrativa por Message-ID, remitente, destinatario y rango temporal, con estado y detalles. Disponibilidad real en la cuenta no probada.
- [Zoho Mail — Get SMTP Logs](https://www.zoho.com/mail/help/api/get-smtp-logs.html): consulta autenticada con permisos de organización y criterio Message-ID. La página específica documenta POST; no se ejecutó. El índice de APIs presenta diferencias de verbo: se debe verificar el contrato y habilitación de la cuenta antes de implementar una integración.
- [ZeptoMail/CPaaS — Specific Email Details](https://www.zoho.com/cpaas/help/api/get-specific-email-log.html): consulta mediante referencia de proveedor, con request_id/client_reference y estado. Es un producto distinto de Zoho Mail; no se presume contratado. Si la referencia se perdió, esta consulta por sí sola no prueba cómo recuperarla.

Procedimiento diseñado para una futura activación autorizada:

1. Persistir evidencia mínima del intento y clasificar la incertidumbre; suspender reintentos automáticos de ese envío. No generar nuevas claves o accesos como reacción automática al timeout.
2. Consultar logs autenticados o pedir revisión al responsable autorizado, correlacionando referencia, destinatario, fecha e intento. No guardar cuerpos o credenciales en logs operativos.
3. Con evidencia positiva de aceptación, registrar esa evidencia sin reenviar. Una búsqueda sin resultados no demuestra rechazo: puede haber demora, permisos o retención limitada.
4. Si no se puede resolver, mantener incidencia visible. Cualquier reenvío requiere decisión explícita, motivo, actor y nuevo evento de comunicación, aceptando y documentando el riesgo residual; no un retry silencioso.
5. Para recuperación, esperar el vencimiento o revocar controladamente los hashes anteriores antes de emitir un nuevo acceso autorizado, respetando los límites. No enviar enlaces adicionales automáticamente por una respuesta incierta.

Este procedimiento necesita una integración externa, estados durables y acciones administrativas específicas antes de activarse; no está implementado como trabajador SMTP real. La publicación del código y esquema no resuelve ni activa esa integración.

## Plantillas y pruebas

`npm run mail:preview`: seis ejemplos ficticios, HTML y texto, sin conexión a base ni envío. Los datos ficticios están en el script de preview y pruebas; los templates usan snapshots persistidos. Se inspeccionaron lectura, ortografía, importes/envío, estados, escape y ausencia de enlaces privados permanentes. Doce capturas 390/1440 sin desbordes en `artifacts/fase-5e/screenshots/`, ignoradas por Git.

| Suite completa | Resultado |
| --- | --- |
| TypeScript | Aprobado |
| Builds productivos general/apagado/Traefik | Aprobados, exclusivamente Supabase local |
| Unitarias y auditorías estáticas | 173/173 |
| pgTAP | 1.009/1.009, 15 archivos |
| Concurrencia real | 24/24 |
| Playwright general | 170/170 |
| Mercado Pago simulado, desktop y mobile | 28/28 |
| Funcionalidades apagadas | 10/10 |
| Traefik real local | 8/8 |
| Secretos y bundles | 44 assets por build general/apagado/proxy, sin filtraciones detectadas |
| SQL de migración completo | Compilado desde estructuras previas en transacción local con ROLLBACK |

Ninguna prueba anterior se eliminó ni debilitó. Logs locales ignorados: `artifacts/fase-5e/release-tests/`.

## Preflight y aplicación Cloud

Credenciales aisladas existentes de Steffen Tienda, sin `supabase login` ni cambios de credenciales globales. Identificación API exacta `zzxlghpopmccwsaqbsko`, Steffen Web tienda, `ACTIVE_HEALTHY`. PostgreSQL usó TLS `verify-full`, CA explícita y host certificado `db.zzxlghpopmccwsaqbsko.supabase.co`. Snapshots en transacción repeatable read, read only; TLS y modo lectura comprobados por PostgreSQL.

Las 17 migraciones y sus huellas de statements coinciden con la referencia posterior a 5D. Esquema, permisos y datos comerciales también coinciden. Para comparar con local se conserva únicamente la normalización ordinal ya aceptada en 5D de `private.mock_checkout_orders.refund_balance_cents`; no se modifica Cloud ni se ignoran otras diferencias.

Dry-run exacto, repetido inmediatamente antes de escribir:

```json
{"upToDate":false,"dryRun":true,"migrations":["20261112120000_comunicaciones_facturacion.sql"],"seeds":[],"roles":[],"message":"Finished supabase db push."}
```

Aplicada exclusivamente `20261112120000_comunicaciones_facturacion.sql`. SHA-256: `09563fbc957f1e83481e9ac0310e4cd290514ce84fb93cddb624a743af7a60fd`. Sin seeds, resets, modificación de datos comerciales, pedidos de prueba, envíos, procesos autónomos ni pg_cron. Se repitieron identidad, estado y comparación antes de escribir; todas las comprobaciones posteriores fueron de lectura.

| Control | Antes | Después |
| --- | --- | --- |
| Migraciones | 17 | 18; las 17 anteriores intactas |
| Productos / unidades / stock_version | 1 / 25 / 1 | 1 / 25 / 1 |
| Huellas comerciales, Storage y usuarios | Referencia 5D | Idénticas |
| Checkout | false | false |
| Pedidos / intentos checkout y pago | 0 | 0 |
| Refunds, disputas, devoluciones y trabajos financieros | 0 | 0 |
| Nuevas tablas 5E | Ausentes | Cinco tablas vacías, con RLS |
| Exposiciones directas de tablas nuevas | No aplica | 0 para anon/authenticated/service_role |
| Mail workers registrados / correos aceptados | 0 / 0 | 0 / 0 |
| Sesiones de workers detectadas | 0 | 0 |
| pg_cron | Ausente | Ausente |

El esquema lógico completo posterior coincide con el probado localmente. Se compararon columnas, constraints, índices, triggers, funciones, ACL, políticas y permisos. Fuera de los cambios explícitos a cola y seguimiento, las funciones anteriores —incluidas las financieras— conservan su definición y permisos. Los secretos internos no se alteraron. Evidencia: directorio temporal `steffen-5e-publicacion/`, sin credenciales en el repositorio.

## Git y Preview

Se prepara commit descriptivo con código, migración, pruebas y documentación 5E; se excluyen herramientas temporales, capturas, entornos y el documento 5A preexistente no versionado. Solo se autoriza push a `feat/catalogo-supabase`, sin merge, force push ni cambios en ramas protegidas. El hash y resultado del deployment se informan en la entrega para no crear una referencia circular al hash dentro del mismo commit.

La API de Vercel respondió 403 al consultar el proyecto: no se afirma una lectura actual de sus variables, credenciales heredadas o Cron Jobs. Se conserva como antecedente la verificación manual del propietario del cierre 5D y no se modificó configuración remota. El código refuerza el bloqueo SMTP en Vercel aun con parámetros accidentales y mantiene los enclavamientos de comercio, pagos, webhooks y recuperación. El estado del deployment se consultará por la integración Vercel/GitHub del commit correcto. Las rutas que requieran SSO y la configuración no accesible quedan para revisión del propietario; un 302/401/403 de autenticación no demuestra un 404 de Next.js.

## Pendientes y condiciones para 5F

No está autorizada la activación de ventas, SMTP, Mercado Pago, workers, ARCA o cron reales. Antes de activar correo hay que elegir el producto Zoho y verificar la cuenta, permisos de logs, semántica de resultados ambiguos, retención, reenvío explícito, dominio, SPF/DKIM/DMARC, rebotes y escáneres de enlaces en HTTPS aislado. Se requiere validación fiscal individual de correcciones y posibles notas de crédito; no se automatizan.

Para comenzar 5F hace falta definir su alcance y recibir autorización separada, revisar este cierre y completar las comprobaciones manuales de Preview. Cualquier habilitación real necesitará además cerrar los bloqueos de staging correspondientes y una autorización explícita de activación. Esta publicación no inicia 5F ni despliega en Hostinger.
