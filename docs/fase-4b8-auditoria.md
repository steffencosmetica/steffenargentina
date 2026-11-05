# Fase 4B.8 — Validación integral del ecommerce

Fecha: 05/11/2026. Rama `feat/catalogo-supabase`, base `bc97cd9`. Toda escritura se hizo en Supabase **local**.
Cloud no se consultó ni modificó en esta fase (estado aprobado: 14 migraciones, verificado en 4B.7).

## 1. Interruptores de publicación

| Control | Nivel | Dónde se evalúa | Apagado (predeterminado) |
|---|---|---|---|
| `STEFFEN_CART_ENABLED=1` | Servidor/compilación | `src/lib/cart/flag.ts`. Además exige Supabase local y fuera de Vercel (`VERCEL`/`VERCEL_ENV`). | Sin carrito ni botones de compra. |
| `CHECKOUT_PAGE_READY` | — | **Ya no existe**: constante de 4B.4, reemplazada en 4B.5 por `isCheckoutAvailable()`. | — |
| `isCheckoutAvailable()` | Servidor | `src/lib/checkout/availability.ts`: carrito + `SUPABASE_SECRET_KEY` + `STEFFEN_LEGAL_PAGES` + `STEFFEN_REVOCATION_ENABLED` (enclavamiento agregado en 4B.8). | `/checkout`, `/pedido/*` y sus API responden 404; «Finalizar compra» deshabilitado. |
| `store_settings.checkout_enabled` | Base de datos | `crear_pedido()` lo verifica; un trigger impide cambiarlo salvo a `postgres`/`supabase_admin` (bloqueo hasta Fase 5). | `crear_pedido()` rechaza con `checkout_disabled`. |
| `STEFFEN_LEGAL_PAGES=1` | Servidor/compilación | `src/lib/legal/flag.ts` | Políticas en 404 y sin enlaces en el footer. |
| `STEFFEN_REVOCATION_ENABLED=1` | Servidor/compilación | `src/lib/legal/flag.ts` | Botón, formulario, recuperación, API y panel en 404. |
| `MAIL_TRANSPORT` + `MAIL_ALLOW_REAL_SEND=1` + `MAIL_SUPABASE_HOST` | Servidor y ejecutor | `src/lib/mail/config.ts` | Nada se envía; comunicaciones pendientes en la base. |

«Compilación»: las páginas estáticas (inicio, secciones) leen el valor al hacer el build; las rutas dinámicas y las API,
en cada request. Cambiar un interruptor exige un nuevo build.

Solo el valor exacto `1` enciende cada interruptor. Las combinaciones están cubiertas por pruebas unitarias
(`checkout/availability.test.ts`, `legal/flag.test.ts`, `mail/mail.test.ts`) y por dos builds de Playwright
(todo encendido en local; todo apagado = configuración de Preview y producción).

| Escenario | Carrito | Checkout | Legales | Arrepentimiento | Correo real |
|---|---|---|---|---|---|
| Vercel Preview / producción actuales (sin variables) | No | No | No | No | No |
| Cualquier entorno en Vercel con todas las variables en `1` | No (Vercel) | No | Sí | Sí | Solo si SMTP completo y atado al proyecto |
| Local con carrito pero sin legales o sin arrepentimiento | Sí | **No** (enclavamiento 4B.8) | — | — | No |
| Local con todo encendido y `checkout_enabled=false` | Sí | Página sí, compra no (base) | Sí | Sí | No |
| `MAIL_ALLOW_REAL_SEND=1` sin el resto | — | — | — | — | No |

**Para el lanzamiento** (Fase 5, con autorización): reemplazar la condición «solo Supabase local» del carrito por un
interruptor de producción explícito, encender legales y arrepentimiento ya aprobados, configurar la clave de servidor,
Zoho y el ejecutor, integrar Mercado Pago y recién entonces habilitar `checkout_enabled` en la base.

## 2. Problemas encontrados

| # | Severidad | Problema | Estado |
|---|---|---|---|
| 1 | Importante | Configuración parcial: con el carrito encendido y las páginas legales o el arrepentimiento apagados, el checkout quedaba disponible aunque exige aceptar Términos y Privacidad que respondían 404, y sin Botón de Arrepentimiento. Solo era alcanzable en local (el carrito exige Supabase local) y la base sigue bloqueando `checkout_enabled` en Cloud. | **Corregido**: `checkoutAvailableFor()` exige los cuatro requisitos. Pruebas unitarias. |
| 2 | Importante | El seguimiento privado no mostraba el despacho (transportista, código, fechas) aunque `consultar_pedido` lo devuelve y el borrador de «Envíos y entregas» lo promete. El comprador no podía ver su código de Andreani. | **Corregido** en `OrderStatus.tsx` (sin datos nuevos ni datos del comprador). Pruebas e2e y responsive. |
| 3 | Menor | La fecha de despacho del panel tiene precisión de minutos y debe ser posterior al pago: despachar dentro del mismo minuto del pago se rechaza con un mensaje genérico («Revisá las notas, el transporte y la fecha»). | Documentado. Regla correcta; mejorar el mensaje en Fase 5. |
| 4 | Menor | `revocation_requests.contact_email` sin índice; la recuperación lo consulta. Irrelevante al volumen actual. | Documentado; requiere migración (Cloud), no se aplicó. |
| 5 | Menor | El log de `next start` muestra trazas «Refresh token is not valid» (sesiones vencidas en pruebas) y el aviso de `output: standalone`. Sin datos personales ni valores de tokens. | Documentado. En Docker se usa `server.js` de standalone. |
| 6 | Menor | El transportista es texto libre: el valor predeterminado «Andreani» definido como decisión comercial todavía no está en el formulario. | Pendiente de Fase 5 (`docs/fase-5-correos-facturacion.md`). |

| 7 | Importante (bloquea el despliegue en VPS) | Sin `VERCEL`, no hay proxy de confianza para la IP del cliente. En un VPS (Dokploy/Traefik): el Botón de Arrepentimiento respondería 503; el checkout usaba `127.0.0.1` como IP **compartida por todos los compradores** (límite global de 5 pedidos/hora) y `humanCheck()` pasaba sin Turnstile, contrario a su comentario («falla cerrado en cualquier despliegue»). Hoy no es alcanzable (carrito solo local; arrepentimiento apagado). | **Parcial**: checkout, arrepentimiento y `humanCheck` ahora fallan cerrados de forma consistente fuera del entorno local (`isLocalEnvironment`/`clientIpFor`, con pruebas). **Falta una decisión** sobre el proxy de confianza del VPS (ver §2.1). |

No se encontraron problemas críticos.

### 2.1 Decisión pendiente: IP del cliente en el VPS

Alternativas para cuando se despliegue en Dokploy (no implementadas):

1. **Traefik como único proxy de confianza** (recomendada): `STEFFEN_TRUSTED_PROXY=traefik` y tomar la **última** IP de
   `X-Forwarded-For` agregada por Traefik, con el contenedor de Next sin puertos publicados (solo accesible por Traefik)
   y `forwardedHeaders.trustedIPs` configurado en Traefik. Simple y sin servicios externos.
2. **Cloudflare delante del VPS**: usar `CF-Connecting-IP`, restringiendo el origen a los rangos de Cloudflare.
   Agrega protección DDoS/Turnstile en el mismo proveedor, pero suma una dependencia.
3. **Seguir en Vercel para la tienda**: la detección actual ya es correcta; el VPS solo para otros servicios.

En los tres casos hay que implementar Turnstile (o equivalente) antes de habilitar ventas fuera de local.

## 3. Seguridad (resumen de la auditoría)

- RPC públicas: anon solo ejecuta `configuracion_checkout`, `cotizar_carrito`, `cotizar_envio`, `provincias_cobertura` e
  `is_admin`. Las funciones de pedidos, arrepentimiento y comunicaciones son solo de `service_role`; las
  administrativas exigen `exigir_admin()`/`is_admin()`. Ninguna función de `private` es ejecutable por roles de API y
  el esquema `private` no tiene `USAGE` para anon, authenticated ni service_role.
- Todas las funciones `SECURITY DEFINER` fijan `search_path` vacío. Todas las tablas de `public` tienen RLS; las
  escrituras de `authenticated` (catálogo, envíos) están limitadas por políticas `is_admin()`.
- El stock exacto no es legible por anon ni por usuarios no administradores (permisos de columna).
- Proxy `/admin` con `getClaims()` + `is_admin`; cada página y Server Action vuelve a verificar con `requireAdmin()`
  (auditoría estática incluida en las pruebas).
- Cookies de sesión `httpOnly`, `sameSite=lax`, `secure` en producción. `localStorage`: solo producto y cantidad.
  `sessionStorage`: token del pedido y clave de idempotencia por pestaña. Tokens de pedido y de recuperación en el
  fragmento de la URL (nunca en el servidor ni en el Referer).
- El pago aprobado solo puede venir de `private.aplicar_pago()` (sin acceso desde la API ni el panel).
- Bundle público sin la clave secreta, la contraseña SMTP (canario) ni el token del monitor.

## 4. Riesgos para Mercado Pago (Fase 5)

- El webhook debe verificar la firma de Mercado Pago y consultar el pago por API antes de llamar a
  `private.aplicar_pago()` (vía una función de servidor nueva y auditada); nunca confiar en el cuerpo recibido.
- Idempotencia por `payment_ref`: ya implementada (notificaciones repetidas no se aplican dos veces).
- Montos: `aplicar_pago` compara el importe exacto; los redondeos de MP deben normalizarse en centavos.
- Pagos tardíos tras vencimiento/cancelación: regla aprobada (`approved_late` o faltante); requiere proceso humano
  de reintegro, aún manual.
- Reintegros y contracargos: no implementados; definir antes de vender.
- Vencimiento de reservas: hoy es oportunista (al crear pedidos) y por `liberar_reservas_vencidas`; en producción hará
  falta un ejecutor programado (no pg_cron en Cloud sin autorización).
- Turnstile: `humanCheck()` falla cerrado fuera de local hasta implementarlo.

## 5. Checklist para habilitar ventas reales

- [ ] Aprobación jurídica y contable de los cinco textos; datos del vendedor (CUIT, domicilio); retirar borrador y `noindex`.
- [ ] `STEFFEN_LEGAL_PAGES=1` y `STEFFEN_REVOCATION_ENABLED=1` publicados y verificados (constancia web, recuperación).
- [ ] Zoho configurado (credencial de aplicación, DNS SPF/DKIM/DMARC), ejecutor de correo en el VPS con reinicio automático y monitor externo con canal alternativo.
- [ ] Interruptor de producción del carrito/checkout (reemplaza la condición «solo local»), con aprobación.
- [ ] Mercado Pago: webhook verificado, pruebas en sandbox, reintegros definidos.
- [ ] Turnstile u otro control antiabuso en producción.
- [ ] Ejecutor de vencimiento de reservas.
- [ ] Registro administrativo de Factura C (número, fecha, envío manual del PDF) y transportista predeterminado Andreani.
- [ ] Evidencia de aceptación de términos versionados en `crear_pedido`.
- [ ] Plazos de conservación de datos definidos.
- [ ] Recién entonces `checkout_enabled = true` en Cloud, con autorización explícita.

## 6. Resultados de las pruebas (05/11/2026, Supabase local)

| Suite | Resultado |
|---|---|
| TypeScript (`tsc --noEmit`) | OK |
| Unitarias (`npm test`) | 130/130 (127 previas + 3 nuevas: enclavamiento del checkout e IP/entorno local) |
| pgTAP (`npm run db:test`) | 819/819 |
| Concurrencia real (`npm run test:concurrency`) | 20/20 |
| Playwright completo (build de producción local) | 167/167 (158 previas + 9 nuevas en `e2e/integral.spec.ts`) |
| Playwright con todo deshabilitado | 9/9 |
| Auditoría del bundle (ambos builds) | Sin clave secreta, contraseña SMTP (canario) ni token del monitor |

Incidencia no reproducida: en una corrida completa intermedia (con un build anterior a la corrección de IP) falló una vez
`seguimiento con despacho responsive 1440` por tiempo de espera al confirmar el pedido. No se repitió en la suite
aislada (10/10) ni en la corrida completa final (167/167). Los artefactos se perdieron al correr la configuración
deshabilitada a continuación, por lo que la causa **no quedó determinada**; no se agregaron reintentos ni se aumentaron
tiempos. Vigilar en próximas corridas.

JavaScript público: 1,1 MB en total entre todos los chunks del build (no por página); el mayor (≈260 KB) es la
librería de Supabase. Sin optimizaciones especulativas.

## 7. Informe complementario (decisión: Traefik como único proxy de confianza)

### 7.1 IP del cliente en el VPS (problema 7)

Implementado según `docs/proxy-traefik.md`: modo explícito `STEFFEN_TRUSTED_PROXY=traefik`, cabecera secreta del
middleware de Traefik, validación completa de `X-Forwarded-For`/`X-Real-Ip` (sin posición fija), soporte de proxies
anteriores declarados, rechazo de IPs no públicas y sin respaldo local ni omisión del control antibots cuando hay un
proxy configurado. Vercel y el entorno local sin cambios. Diagnóstico de aceptación `GET /api/interno/proxy` (solo
con token temporal).

Verificado con **Traefik 3.5.6 real** en Docker (`npm run test:e2e:proxy`): cabeceras falsificadas borradas, IP TCP
real usada, usuarios distintos con límites independientes, IPv6, acceso directo a Next rechazado, Traefik con
`insecure` detectado (cadena de 2 saltos → rechazo). **Aceptación final pendiente** en el VPS real (§6 de
`docs/proxy-traefik.md`): depende de la publicación de puertos de Traefik en Dokploy, que no se puede verificar aquí.

### 7.2 Regresión del checkout sin páginas legales (problema 1)

Además de las pruebas unitarias, el build del arnés de proxy tiene carrito y clave de servidor encendidos con las
páginas legales **apagadas**: la prueba e2e confirma `/checkout`, `/pedido/*` y sus API en 404 y «Finalizar compra»
deshabilitado con productos en el carrito.

### 7.3 Falla intermitente del checkout a 1440 px — causa determinada

Reproducida con `--repeat-each=4` (2 fallas en 36 ejecuciones, en 1440 y 768 px: no depende del ancho). Con los
artefactos conservados, la captura mostró el banner «El total de tu compra es $ 16.050,50. Revisalo y confirmá.»:
la prueba confirmaba **antes** de que llegara la cotización del envío y el checkout, correctamente, pidió confirmar
el total visible (`CheckoutForm`: `shown === null`). Era una carrera de las pruebas nuevas de `e2e/integral.spec.ts`,
no un defecto de la aplicación. Corrección: las pruebas esperan el total visible antes de confirmar
(`confirmWithTotal`), como la suite de checkout existente; sin cambios de tiempos ni reintentos. Verificación:
`--repeat-each=4` → 36/36.

Para conservar artefactos, cada configuración de Playwright escribe en su propia carpeta (`test-results`,
`test-results-apagado`, `test-results-proxy`); antes, la suite deshabilitada borraba los de la principal.
