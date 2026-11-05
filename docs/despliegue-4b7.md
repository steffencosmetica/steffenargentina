# Fase 4B.7 — despliegue con todo deshabilitado y activación posterior

Estado al 04/11/2026: nada de esto se ejecutó. Cloud intacto; migraciones solo en local.

## 1. Interruptores (todos apagados por defecto)

| Interruptor | Dónde | Apagado (predeterminado) | Encendido |
|---|---|---|---|
| `STEFFEN_LEGAL_PAGES=1` | Servidor Next (Vercel/VPS) | Las 4 políticas responden 404; el footer no las enlaza. | Publica Términos, Privacidad, Envíos y Cambios (con aviso de borrador y `noindex`). |
| `STEFFEN_REVOCATION_ENABLED=1` | Servidor Next | Sin botón flotante; `/arrepentimiento`, `/arrepentimiento/recuperar`, sus 3 API y `/admin/arrepentimientos` responden 404; las acciones del panel se niegan. | Publica el Botón de Arrepentimiento y la recuperación. |
| `MAIL_TRANSPORT=smtp` + `MAIL_ALLOW_REAL_SEND=1` + `MAIL_SUPABASE_HOST` | Servidor Next y ejecutor | No se envía ningún email; las constancias quedan pendientes en la base. | Envío real por Zoho. |
| `store_settings.checkout_enabled` | Base (bloqueado por trigger hasta Fase 5) | Sin compras. | — |
| `STEFFEN_CART_ENABLED` | Servidor Next | Sin carrito (además exige Supabase local y fuera de Vercel). | — |

- Solo el valor exacto `"1"` enciende los interruptores; `true`, `yes` o espacios no.
- Las páginas estáticas (inicio, secciones) leen los interruptores **al compilar**: cambiar un valor exige un
  nuevo build/deploy. En Docker/Dokploy pasarlos también como *build args*.
- Los interruptores son independientes: publicar las políticas no publica el botón, ni al revés.
- La ruta de monitor `GET /api/interno/comunicaciones` no depende de ellos: solo existe con `MAIL_HEALTH_TOKEN`.

## 2. Migraciones pendientes para Cloud (en este orden)

1. `supabase/migrations/20261105120000_arrepentimiento.sql`
2. `supabase/migrations/20261106120000_arrepentimiento_comunicaciones.sql`

Suponen que Cloud tiene aplicadas todas las anteriores hasta `20261104120000_admin_pedidos.sql` (la última
commiteada). **Verificar antes con** `npx supabase migration list --linked` (solo lectura).

Verificación local (simulación del estado de Cloud): base reconstruida en `20261104120000`, con catálogo, zona,
stock y dos pedidos reales con reserva; luego se aplicaron solo las dos migraciones en orden. Resultado:
sin cambios en los 47 registros existentes (stock, pedidos, ítems, precios, zonas, configuración), sin
permisos, funciones, políticas, RLS ni triggers previos eliminados o modificados, y sin líneas de esquema
eliminadas; solo se agregan objetos nuevos. `registrar_arrepentimiento` lo crea la 1.ª y lo reemplaza la 2.ª
(ambas nuevas). Dependen de `private.hash_ip`, `private.exigir_admin`, `public.is_admin` y pgcrypto en
`extensions`, presentes desde las fases anteriores. No activan pg_cron ni modifican `checkout_enabled`.

Aplicadas solas, las migraciones **no publican nada**: las tablas quedan vacías y sin acceso público, y la web
sigue en 404 mientras los interruptores estén apagados.

## 3. Ramas y procedimiento: desplegar con todo deshabilitado

Organización de ramas (vigente):

| Rama | Rol | En esta fase |
|---|---|---|
| `main` | Sitio original | **Intocable.** Sin merge ni push. |
| `feat/nextjs-migracion` | Producción institucional en Vercel | **Intocable por ahora.** Sin merge ni push. |
| `feat/catalogo-supabase` | Desarrollo de la tienda | **Único destino autorizado** del push (sin force push). Genera solo un Vercel Preview. |

No se propone ningún merge a una rama de producción. La integración de la tienda con producción se decidirá
en una fase posterior, con su propia autorización.

1. Confirmar que en el entorno Preview de Vercel **no** existen `STEFFEN_LEGAL_PAGES`,
   `STEFFEN_REVOCATION_ENABLED`, `MAIL_*` ni `SUPABASE_SECRET_KEY` (o que valen `0`/vacío).
2. Preflight de Cloud de solo lectura sobre `zzxlghpopmccwsaqbsko` con las credenciales aisladas de Steffen Tienda
   (sin login global): historial, esquema, guardas (checkout apagado, cero pedidos, pg_cron ausente), huellas de
   datos y dry-run que muestre exclusivamente las dos migraciones. Repetir el dry-run antes de aplicar.
3. Con aprobación explícita: aplicar solo esas dos migraciones (`db push --db-url … --skip-vault`, sin
   `--include-all`, seeds ni roles) y verificar historial, esquema, permisos, datos comerciales y guardas.
4. Commit de la fase y push exclusivamente a `feat/catalogo-supabase`.
5. En el Preview (con un 404 real de Next, no un 401/302 de Vercel Authentication) verificar: las rutas legales y
   `/arrepentimiento` → 404; APIs de arrepentimiento → 404; sin botón flotante ni enlaces legales en el footer;
   carrito y checkout deshabilitados; catálogo y administrador funcionando; `noindex`.

## 4. Activación (cuando empiecen las ventas, no antes)

1. Aprobación jurídica y fiscal de los textos; completar datos del vendedor; retirar aviso de borrador y `noindex`.
2. Configurar Zoho (`docs/zoho-correo.md`): credencial de aplicación en el servidor, DNS, prueba controlada a una
   casilla propia.
3. Desplegar el ejecutor en el VPS (§5) y el monitor externo (§6); comprobar `npm run mail:worker -- --health`.
4. Configurar `SUPABASE_SECRET_KEY` en el servidor y encender `STEFFEN_REVOCATION_ENABLED=1` y
   `STEFFEN_LEGAL_PAGES=1`; nuevo build. Verificar recepción, constancia web, email y panel.
5. Recién entonces, Fase 5 (checkout y pagos).

## 5. Ejecutor en el VPS (documentado, no configurado)

- Proceso: `node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/mail-worker.ts` (o `npm run mail:worker`).
- Reinicio automático: unidad systemd con `Restart=always` y `RestartSec=10`, o servicio Docker/Dokploy con
  `restart: unless-stopped`. Ejemplo en `docs/zoho-correo.md` §6.
- Variables en un archivo de entorno del servidor con permisos `600`, fuera del repo: `NEXT_PUBLIC_SUPABASE_URL`,
  `SUPABASE_SECRET_KEY`, `MAIL_TRANSPORT=smtp`, `MAIL_ALLOW_REAL_SEND=1`, `MAIL_SUPABASE_HOST`, `MAIL_FROM`,
  `MAIL_LINK_BASE_URL`, `MAIL_SMTP_*`, `MAIL_WORKER_ID`.
- Si la configuración es parcial o no coincide con el proyecto, el proceso sale con código 2 sin tocar la cola;
  systemd lo reintenta y el monitor detecta la falta de latido.
- Tras un reinicio retoma solo: las filas pendientes siguen en Postgres y las «enviando» de un proceso muerto
  se recuperan al vencer su arrendamiento (120 s).
- Apagado ordenado con `SIGTERM`.

## 6. Monitor externo necesario (no configurado)

- Servicio de uptime con soporte de cabeceras (cualquier proveedor) que haga
  `GET https://<dominio>/api/interno/comunicaciones` con `Authorization: Bearer <MAIL_HEALTH_TOKEN>` cada
  5 minutos y alerte si la respuesta no es 200.
- Debe avisar por un canal **independiente de Zoho** (SMS, app móvil, WhatsApp) a un responsable y a un reemplazo.
- Detecta: ejecutor caído o nunca iniciado (`sin_ejecutor`/`ejecutor_detenido`), envíos demorados (correo caído o
  credenciales inválidas) y constancias fallidas o rebotadas.
- Revisión humana de `/admin/arrepentimientos` (filtro «Requieren intervención») cada día hábil, lunes a viernes de
  8:00 a 16:00.
