# Fase 4B.7 — implementación local para revisión

> Actualización: la validación posterior autorizada, que incluye las pruebas inicialmente excluidas y la auditoría de fallos de entrega, se registra en [fase-4b7-validacion-complementaria.md](fase-4b7-validacion-complementaria.md). Los resultados y exclusiones de este informe describen la primera entrega.

## Páginas y textos propuestos

| Ruta | Contenido |
| --- | --- |
| `/terminos-y-condiciones` | Vendedor pendiente de identificar, productos, ARS, stock, proceso de compra, confirmación, pagos todavía no integrados, entrega y atención |
| `/politica-de-privacidad` | Datos reales de checkout y solicitudes, seguridad, proveedores existentes, almacenamiento, conservación sin promesas de borrado automático y derechos |
| `/envios-y-entregas` | Cobertura por provincia, tarifas y gratuidad configuradas, preparación, transporte manual, seguimiento y demoras |
| `/cambios-y-devoluciones` | Arrepentimiento, defectos, errores de envío y cambios voluntarios pendientes |
| `/arrepentimiento` | Información y formulario público sin cuenta, con constancia inmediata |

Los textos editables están en `src/lib/legal/documents.ts`; la presentación compartida, en `src/components/legal/LegalPage.tsx`. Usan el header/footer institucional, Montserrat local y blanco, negro y dorado. Incluyen aviso visible de borrador, títulos y canónicas propios y `noindex` hasta aprobación. No se agregaron al sitemap mientras sean borradores.

Los datos fiscales desconocidos están identificados como pendientes; no se inventaron razón social, CUIT, domicilios, operadores contratados ni plazos comerciales. La revisión normativa y las decisiones pendientes están en [legal-pendientes.md](legal-pendientes.md), con fuentes oficiales. Los documentos no excluyen todos los cosméticos por categoría: separan apertura de uso/consumo efectivo y conservan la recepción para evaluación humana, sin condicionar reclamos por defectos.

## Solicitud de arrepentimiento

- `RevocationForm.tsx` envía exclusivamente referencia de compra, email y clave técnica de idempotencia a `POST /api/arrepentimiento`. No requiere nombre, dirección, motivo, documentos, cuenta ni datos de pago.
- Devuelve código aleatorio `ARR-…` y fecha del servidor. La constancia aparece en la misma web, recibe foco y se puede imprimir/guardar. No hay envío automático de email: el contacto posterior es manual.
- La respuesta no consulta, confirma ni revela pedidos. No existe consulta pública de solicitudes por código o email. Las respuestas y errores no reflejan datos personales.
- Valida estructura, tamaños, email, referencia, clave UUID y honeypot. Limita el cuerpo a 4096 bytes incluso sin Content-Length; controla JSON y origen. Respuestas `no-store`, `no-referrer` y `noindex`.
- La base limita a cinco solicitudes nuevas por IP por hora; guarda HMAC de la IP, no la IP original. Serializa por clave y huella de IP para evitar duplicados y carreras. Los reintentos de la misma solicitud recuperan el mismo código sin consumir otro cupo. El email institucional queda disponible como alternativa ante errores o límite temporal.
- La IP proviene del proxy confiable Vercel. En local se usa la IP fija de desarrollo; un despliegue distinto requiere configurar un proxy confiable antes de publicar el endpoint. Sin IP confiable o clave de servidor falla cerrado con 503.
- No modifica pedidos, reservas, stock, pagos ni reembolsos.

## Gestión administrativa y auditoría

Nueva bandeja `/admin/arrepentimientos`, integrada a la navegación existente, paginada de veinte en veinte. Muestra referencia y contacto proporcionados, recepción e historial cronológico. Incluye estados vacíos, carga y error.

Estados: `recibida → en_gestion → cerrada`. Hay confirmación al operar y versión optimista. Cerrar indica gestión administrativa, nunca reembolso; la pantalla lo aclara. La gestión del pedido sigue pasando por sus reglas anteriores y por la verificación humana de identidad y procedencia.

Los cambios y eventos se registran en la misma transacción. La auditoría contiene estado, fecha, solicitud y actor administrativo; no duplica email, referencia ni IP. No se implementó borrado automático ni tareas programadas.

## Base de datos y seguridad

Única migración nueva: `20261105120000_arrepentimiento.sql`, aplicada **solo en Supabase local**. No se modificaron migraciones previas.

| Objeto | Acceso |
| --- | --- |
| `revocation_requests` | RLS; solo lectura administrativa de columnas necesarias; hash y clave excluidos de los grants de authenticated |
| `revocation_events` | RLS; lectura administrativa |
| `registrar_arrepentimiento(text,text,uuid,inet)` | EXECUTE exclusivo de service_role, desde módulo server-only existente |
| `admin_gestionar_arrepentimiento(uuid,integer,text)` | EXECUTE de authenticated con `private.exigir_admin()` antes de consultar existencia |

Ambas funciones usan `SECURITY DEFINER` y `search_path` vacío. Sin EXECUTE para PUBLIC. Anon no ejecuta las funciones ni lee las tablas; authenticated no administrador recibe cero filas por RLS y no puede gestionar. Ninguno de esos roles ni service_role tiene escritura directa sobre las tablas. La administración usa sesión y `requireAdmin()`, sin clave secreta en el navegador. No se cambian los permisos de las funciones previas.

## Footer y checkout

El footer común incorpora cuatro enlaces legales. Un acceso fijo y destacado “Botón de Arrepentimiento” es visible desde el primer acceso, también en mobile. No se duplicó ese acceso en el footer. En checkout mobile se sitúa sobre la barra de confirmación para no taparla.

La aceptación de checkout enlaza términos y privacidad en otra pestaña, conserva la casilla desmarcada y su validación existente. No se guardó aceptación ficticia ni se alteraron pedidos anteriores. La propuesta de versiones inmutables y registro transaccional para compras futuras está en `legal-pendientes.md`.

## Verificación

| Validación | Resultado |
| --- | --- |
| TypeScript `npx tsc --noEmit` | Aprobado |
| Unitarias `npm test` | 109/109 |
| pgTAP, nueve suites con checkout permanentemente apagado | 397/397; incluye las 58 comprobaciones nuevas |
| Playwright de regresión con exclusiones indicadas abajo | 125/125, repetido satisfactoriamente |
| Playwright legal después de los últimos ajustes de textos, presentación e impresión | 10/10, incluida autenticación de preparación |
| Playwright carrito/checkout apagados | 8/8 |
| Builds de producción | Aprobados con `npm run build`, ejecutado por los servidores de ambas configuraciones Playwright y con Supabase local |
| `git diff --check` | Sin errores |

**No se ejecutó la totalidad de las suites que activan ventas**, para respetar la restricción expresa de no activar `checkout_enabled`:

- Playwright: se excluyeron `checkout.spec.ts` y `stock-concurrencia.spec.ts`, que suman 21 pruebas. Comando: `npm run test:e2e -- --grep-invert 'checkout\.spec\.ts|stock-concurrencia\.spec\.ts'`.
- pgTAP: se excluyó `pedidos.test.sql`, de 252 comprobaciones, porque habilita el interruptor dentro de su transacción. Se ejecutaron copias fieles de las otras nueve suites y su fixture compartido dentro de `artifacts/4b7/pgtap/`; no se modificaron las suites anteriores para omitir comprobaciones.
- La suite anterior `test:concurrency` también habilita checkout y no se ejecutó. La concurrencia nueva sí se probó mediante diez solicitudes HTTP simultáneas (cinco recepciones y cinco rechazos por límite) y dos sesiones administrativas con versiones obsoletas.

El checkbox se probó en el checkout local con carrito ficticio y compras apagadas: enlaces visibles, estado inicial desmarcado, marcado explícito, botón de compra deshabilitado y sin solapamiento de la barra mobile. La validación unitaria existente sigue rechazando la falta de aceptación. No se crearon compras para esta verificación.

Incidencias detectadas y resueltas durante la validación:

- Dos selectores nuevos coincidían con los anunciadores accesibles de Next y del carrito. Se acotaron al contenedor correspondiente; no se aumentaron timeouts ni reintentos.
- El CLI pgTAP, al recibir archivos sueltos, no montaba el fixture `admin-pedidos.inc`. Se repitió con un directorio local que conserva la estructura y los originales, obteniendo 397/397.
- El sandbox bloqueó subprocesos de un intento de unitarias y del CLI. Las ejecuciones con permiso de proceso terminaron correctamente; el registro definitivo de unitarias está en `artifacts/4b7/unitarias.txt`.
- Se ajustó el acceso fijo para no tapar la barra de checkout mobile y se verificó la impresión de la constancia sin navegación ni textos ajenos a la solicitud.

No quedan fallos funcionales conocidos en las comprobaciones ejecutadas. Persisten advertencias de infraestructura ya existentes sobre `MODULE_TYPELESS_PACKAGE_JSON`, `NO_COLOR` y el uso de `next start` junto a `output: standalone`; los builds y las pruebas finalizaron correctamente.

Capturas locales: `artifacts/4b7/`, excluidas de Git. Cinco páginas × 390, 768 y 1440 px, más bandeja administrativa en los mismos tamaños. Las comprobaciones incluyen ausencia de desborde horizontal, estructura de encabezados, navegación por teclado, foco, labels, canónicas y noindex. No equivalen a una certificación completa de WCAG.

Estado final confirmado mediante SELECT de solo lectura, guardado en `artifacts/4b7/estado-final-local.json`: `checkout_enabled=false`, cero pedidos, cero intentos de checkout, cero solicitudes y eventos ficticios, RLS activa, pg_cron ausente y migración nueva registrada únicamente en local. EXECUTE de recepción denegado a anon/authenticated y concedido al servidor. No se consultó ni modificó Supabase Cloud en esta fase.

## Pendientes del propietario

Identificación fiscal, responsable de datos, domicilio, área y horarios de atención, operación diaria de solicitudes, transportistas y plazos reales, facturación, cambios voluntarios, conservación y transferencias de datos. Se requiere revisión legal profesional y aprobación de los textos antes de publicarlos como definitivos. No hay una política comercial voluntaria aprobada por inferencia.

## Alcance de la entrega

Trabajo exclusivamente local en `feat/catalogo-supabase`. Sin commit, push, deploy, cambios en Cloud, Mercado Pago, pg_cron ni avance a 4B.8. Los archivos de evidencia y autenticación de pruebas están ignorados y no forman parte de la publicación.

Git conserva el commit de partida `95a9e0f`; los cambios de esta fase están sin commit. El diff no contiene credenciales ni modificaciones de migraciones anteriores. Se entrega para revisión antes de publicar.
