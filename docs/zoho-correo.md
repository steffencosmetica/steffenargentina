# Correo transaccional con Zoho — arquitectura y configuración

Fase 4B.7. Estado: **implementado y probado solo en local con un transporte simulado**. No se configuró ninguna
credencial real, no se envió ningún correo real y no se activó ningún servicio en Cloud.

## 1. Qué se envía

| Comunicación | Destinatario | Cuándo | Contenido |
|---|---|---|---|
| Constancia de arrepentimiento | Email informado en la solicitud | Después de registrar la solicitud | Código, fecha de recepción, estado «recibida», aclaración de que es un respaldo y no confirma reembolso. **No** incluye la referencia de compra. |
| Enlace de recuperación | Email que tenga solicitudes registradas | Al pedirlo desde `/arrepentimiento/recuperar` | Enlace privado `…/arrepentimiento/recuperar#t=<token>`; vence en 30 min, un solo uso. |
| Alerta interna | `info@steffenargentina.com.ar` | Cuando una constancia queda «fallida» | Código, tipo de fallo, intentos y código de error. **Sin** email ni datos del comprador. |

Todos son transaccionales: sin publicidad, píxeles de seguimiento, imágenes remotas ni enlaces de baja de listas.

**Canal principal**: la constancia que se muestra en la web al enviar la solicitud. El email es un respaldo y no
se presenta como sustituto jurídico equivalente. «Aceptado» = el servidor SMTP de Zoho aceptó el mensaje; **no**
acredita entrega en la casilla ni lectura.

## 2. Arquitectura

```
Navegador ──POST /api/arrepentimiento──▶ Next (route handler)
                                            │ registrar_arrepentimiento(): UNA transacción
                                            │   ├─ revocation_requests   (código ARR-…)
                                            │   └─ revocation_messages   (constancia «pendiente»)
                                            │◀── 201 {code, receivedAt}  ← constancia web inmediata
                                            └─ after(): drainOnce() — intento inmediato, no bloquea la respuesta

scripts/mail-worker.ts (proceso autónomo en el VPS, systemd/Docker con reinicio automático)
   cada 30 s: comunicaciones_reclamar() ─▶ render ─▶ SMTP Zoho ─▶ comunicaciones_resultado()
```

- **Durabilidad**: la comunicación se guarda en la misma transacción que la solicitud. Si el correo, el proceso
  web o el ejecutor fallan, la fila sigue «pendiente» en Postgres.
- **Arrendamiento (lease)**: `comunicaciones_reclamar()` usa `FOR UPDATE SKIP LOCKED` y marca la fila «enviando»
  por 120 s. Dos ejecutores (o el ejecutor y la web) nunca envían la misma fila en paralelo.
- **Recuperación tras reinicios**: si un proceso muere, el arrendamiento vence y otro ciclo la reclama; el intento
  anterior queda registrado como «interrumpido».
- **Idempotencia**: una sola constancia por solicitud (índice único); los reintentos reutilizan la fila y el
  código. `comunicaciones_resultado()` ignora resultados con un arrendamiento ajeno o ya registrado.
- **Entrega «al menos una vez»**: si el proceso cae justo después de que Zoho acepte y antes de registrar el
  resultado, el mismo email (mismo código, mismo `Message-ID` `<arr-<id>@steffenargentina.com.ar>`) puede
  llegar dos veces. Nunca se genera otro código ni otra solicitud.
- **Reintentos**: errores temporales (4xx, red, TLS, autenticación) esperan 1, 5, 15, 30 min, 1, 2, 4 y 8 h,
  hasta 8 intentos. Errores permanentes (5xx, destinatario rechazado) pasan a «fallido» de inmediato. Toda falla
  definitiva de una constancia encola **una** alerta interna (no hay alertas sobre alertas).
- **Datos personales en registros**: los errores se guardan y registran con las direcciones reemplazadas por
  `[email]`; los logs del ejecutor son JSON con ids y códigos, nunca emails, tokens ni cuerpos.

Archivos: `supabase/migrations/20261106120000_arrepentimiento_comunicaciones.sql`, `src/lib/mail/*`,
`scripts/mail-worker.ts`, `src/app/api/arrepentimiento/{recuperar,constancia}/route.ts`,
`src/app/api/interno/comunicaciones/route.ts`.

## 3. Opciones reales de Zoho (investigadas el 04/11/2026)

| Opción | Cómo se conecta | A favor | En contra |
|---|---|---|---|
| **A. Zoho Mail SMTP** (casilla institucional) | `smtppro.zoho.com:465` (SSL) para cuentas de organización pagas; `smtp.zoho.com:465/587` para cuentas gratuitas o con STARTTLS. Usuario = dirección completa. | Ya existe la casilla; sin servicio nuevo. | Zoho Mail limita el envío externo por hora según reputación (orientativamente 50–500/h) y su política no permite envíos masivos; los rebotes llegan como avisos (NDR) a la casilla, sin webhook. El remitente debe ser la cuenta o un alias. |
| **B. Zoho ZeptoMail (Zoho CPaaS)** | `smtp.zeptomail.com:465/587`, usuario `emailapikey`, contraseña = token de envío del «Agent». También API REST. | Diseñado para transaccionales; dominio verificado por DKIM + CNAME de rebotes; estadísticas y webhooks de rebote/entrega. | Servicio aparte (alta y costo propios); requiere DNS adicional. |
| C. Zoho Mail REST API (OAuth) | API con client id/secret y refresh token. | Sin contraseña SMTP. | Más complejo (OAuth, rotación); sin ventajas para este volumen. |

**Recomendación**: empezar con **A** usando una contraseña de aplicación de una casilla dedicada o alias
(por ejemplo `no-responder@` o la propia `info@` con alias), porque el volumen esperado es bajo y no requiere un
servicio nuevo. Migrar a **B** si crece el volumen o se necesitan rebotes automáticos. El código usa SMTP
estándar (nodemailer), así que el cambio A→B es solo de variables de entorno.

**No** se usan las credenciales personales existentes. **No** se guarda ninguna contraseña en el repositorio.

Fuentes: [Zoho Mail — configuración SMTP](https://www.zoho.com/mail/help/zoho-smtp.html),
[Zoho Mail — límites](https://www.zoho.com/mail/help/adminconsole/rates-and-limits.html),
[ZeptoMail — SMTP](https://www.zoho.com/zeptomail/help/smtp-home.html),
[ZeptoMail — dominios](https://www.zoho.com/zeptomail/help/domains.html).
Verificar en la cuenta real: región/data center (`.com` u otro), plan (gratuito/pago) y límites vigentes.

## 4. Configuración (variables de servidor)

Ver `.env.example`. Ninguna lleva prefijo `NEXT_PUBLIC_`; la auditoría `src/lib/orders/secrets.audit.test.ts`
verifica que `MAIL_SMTP_PASSWORD` solo se lea en `src/lib/mail/config.ts` y que ningún componente de cliente
importe código de correo.

| Variable | Uso |
|---|---|
| `MAIL_TRANSPORT` | `desactivado` (predeterminado), `archivo` (desarrollo/pruebas) o `smtp`. |
| `MAIL_ALLOW_REAL_SEND=1` | Obligatoria para `smtp` (solo el valor exacto `1`). Sola no activa nada. SMTP además rechaza enlaces a `localhost` y Supabase local. |
| `MAIL_SUPABASE_HOST` | Obligatoria para `smtp`: host del proyecto (`<ref>.supabase.co`). Si no coincide con `NEXT_PUBLIC_SUPABASE_URL`, la web y el ejecutor no envían nada. |
| `MAIL_FROM` | Remitente verificado (la cuenta SMTP o un alias). |
| `MAIL_REPLY_TO` | Opcional, p. ej. `info@steffenargentina.com.ar`. |
| `MAIL_LINK_BASE_URL` | Base de los enlaces de recuperación (`https://…`). |
| `MAIL_SMTP_HOST` / `PORT` / `SECURE` / `USER` / `PASSWORD` | Credenciales del servidor (sección 3). |
| `MAIL_CAPTURE_DIR` | Solo con `archivo`: carpeta local donde se escribe cada email como JSON. |
| `MAIL_WORKER_ID`, `MAIL_WORKER_INTERVAL_SECONDS`, `MAIL_WORKER_MAX_SILENCE_MINUTES` | Ejecutor autónomo. |
| `MAIL_HEALTH_TOKEN` | ≥ 32 caracteres aleatorios; habilita `GET /api/interno/comunicaciones`. |

El ejecutor necesita además `NEXT_PUBLIC_SUPABASE_URL` y `SUPABASE_SECRET_KEY` (clave de servidor).

**Desarrollo**: `MAIL_TRANSPORT=archivo` (solo se acepta con Supabase local) y `MAIL_CAPTURE_DIR=./.mail-capturas`. Crear el archivo `CAIDA` en esa
carpeta simula el servicio caído (error temporal); `RECHAZO` simula un rechazo definitivo. Nunca sale a la red.
Alternativa: Mailpit de Supabase local (hoy excluido en `npm run db:start`) apuntando `MAIL_SMTP_HOST` a él.

## 5. DNS del dominio (pendiente de verificar en el proveedor de DNS)

- **SPF**: un único registro TXT `v=spf1 …` en `steffenargentina.com.ar` que incluya a Zoho con el valor exacto
  que muestre la consola de Zoho (Admin Console → Domains → Email configuration). Si se usa ZeptoMail, su
  verificación actual usa DKIM y un CNAME de rebotes (el SPF dejó de ser obligatorio según su documentación).
- **DKIM**: generar la clave en la consola de Zoho (selector propio) y publicar el TXT indicado; activarla.
- **DMARC**: publicar `_dmarc.steffenargentina.com.ar` empezando con `p=none` y un `rua` a una casilla
  revisada; endurecer a `quarantine`/`reject` después de verificar alineación SPF/DKIM.
- **ZeptoMail**: además, el CNAME del dominio de rebotes que indique el panel.

No se verificó el DNS actual del dominio en esta fase.

## 6. Ejecutor en el VPS (futuro, no activado)

Procedimiento completo de despliegue y activación: `docs/despliegue-4b7.md`.

```ini
# /etc/systemd/system/steffen-mail-worker.service (ejemplo)
[Service]
WorkingDirectory=/srv/steffen
EnvironmentFile=/etc/steffen/mail-worker.env   # permisos 600, fuera del repo
ExecStart=/usr/bin/node --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/mail-worker.ts
Restart=always
RestartSec=10
User=steffen
```

O en Docker/Dokploy: un servicio aparte con la misma imagen y `restart: unless-stopped`. El proceso maneja
`SIGTERM` (termina el ciclo y sale). No requiere visitas a la web ni administradores conectados.
**No** se usa pg_cron ni cron de Vercel/Supabase Cloud.

## 7. Supervisión y canal alternativo (pendiente de configurar)

El correo no puede ser el único aviso de que el correo falla. Mecanismos implementados:

1. `GET /api/interno/comunicaciones` con `Authorization: Bearer $MAIL_HEALTH_TOKEN`: 200 si está sano, 503 con
   `problemas` (`sin_ejecutor`, `ejecutor_detenido`, `comunicaciones_demoradas`, `comunicaciones_fallidas`).
   Sin datos personales. Sin token configurado, la ruta responde 404.
2. `npm run mail:worker -- --health`: mismo diagnóstico por CLI; sale con código 1 si hay problemas.
3. Panel `/admin/arrepentimientos`: banner de estado, filtro «Requieren intervención».
4. Latido de los ejecutores autónomos (`private.mail_workers`); el envío inmediato de la web no cuenta como latido.

**Falta (operativo, no técnico)**: contratar o configurar un monitor externo (p. ej. un servicio de uptime con
cabecera de autorización) que consulte la ruta 1 cada pocos minutos y avise por un canal **distinto** del correo
de Zoho (SMS, WhatsApp, app móvil); designar responsable y reemplazo. Hasta que eso exista, la detección depende
de revisar el panel. **No está funcionando hoy.**

## 8. Límites de envío y antiabuso

- Envíos: el ejecutor procesa hasta 10 mensajes por ciclo (30 s) → máx. ~1.200/h, muy por encima del volumen
  esperado; si Zoho limita (4xx), se reintenta con espera creciente.
- Recuperación: 5 pedidos por IP y hora; 3 emails por dirección y hora y uno pendiente a la vez; solo se escribe
  a direcciones que tienen solicitudes. Canje: 20 intentos por IP y hora. La respuesta pública es siempre igual.
- Recepción de arrepentimientos: su propio límite (5 por IP y hora), independiente de la recuperación.
