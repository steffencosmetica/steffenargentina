# Fase 4B.7 — decisiones aprobadas y datos pendientes

Todos los textos de `src/lib/legal/documents.ts` siguen siendo **borradores pendientes de aprobación jurídica y
contable**. Las páginas tienen `noindex` y el aviso de borrador. No habilitar ventas ni publicarlos como
definitivos antes de resolver los puntos pendientes. Actualizado: 04/11/2026.

## 1. Decisiones comerciales ya aprobadas (incorporadas a los borradores)

| Decisión | Dónde se refleja |
|---|---|
| Preparación y despacho: plazo estimado de 1 a 3 días hábiles desde la confirmación del pago, sin incluir el transporte. | Envíos y entregas; Términos («Entrega»). |
| Transportista habitual: Andreani; Steffen puede usar otros. | Envíos y entregas («Transportista»); Privacidad (proveedores). |
| Envíos fallidos: evaluación y coordinación individual según la causa, sin cargos automáticos ni desconocer obligaciones legales. | Envíos y entregas («Envíos fallidos»). |
| Atención: lunes a viernes de 8:00 a 16:00, por email y WhatsApp institucional. | Contacto de las cinco páginas; Términos; Privacidad; emails. |
| Sin cambios ni beneficios comerciales adicionales a los derechos legales por ahora. | Cambios y devoluciones («Cambios voluntarios»); Términos. |
| Devoluciones: coordinación individual del envío o retiro, que no condiciona derechos. | Cambios y devoluciones; Botón de Arrepentimiento. |
| Vendedor monotributista; Factura C manual desde ARCA; PDF enviado manualmente por Zoho; sin integración con ARCA. | Términos («Quién vende», «Facturación»); Privacidad (proveedores). |
| Emails a compradores exclusivamente transaccionales, sin marketing. | Términos; Privacidad («Emails transaccionales»); plantillas de `src/lib/mail/templates.ts`. |
| Constancia web inmediata como canal principal; email como respaldo; recuperación privada por email. | Botón de Arrepentimiento; formulario; `/arrepentimiento/recuperar`. |

## 2. Datos legales y fiscales todavía no aportados

- Nombre completo o razón social del vendedor y del responsable del tratamiento de datos.
- CUIT, domicilio fiscal/legal y domicilio comercial que deba informarse. No se usa «Buenos Aires» del footer como domicilio legal.
- Relación entre el vendedor y la marca Steffen Cosmética Capilar.
- Domicilio operativo para recibir devoluciones (no publicar una dirección inventada).
- Área o persona responsable de atención, reemplazo y forma de identificarla en las páginas.
- Facturación: momento de emisión (pago aprobado o despacho) y de envío del PDF; datos del comprador necesarios para Factura C; conservación de comprobantes. No solicitar DNI/CUIT adicional por defecto sin necesidad y base legal.
- Confirmar que `info@steffenargentina.com.ar` y `+54 9 223-559-0428` atienden compras, reclamos, arrepentimiento y derechos sobre datos.

## 3. Configuración real pendiente de Zoho

Ver `docs/zoho-correo.md`. Nada de esto está configurado:

- Elegir opción: Zoho Mail SMTP (casilla dedicada/alias con contraseña de aplicación) o ZeptoMail (Zoho CPaaS).
- Confirmar plan (gratuito/pago), región/data center y límites de envío vigentes de la cuenta.
- Crear la contraseña de aplicación o el token de envío **en el servidor**, nunca en el repositorio; cargar `MAIL_*` en el entorno del VPS.
- Remitente verificado (`MAIL_FROM`) y `MAIL_REPLY_TO`.
- DNS: SPF, DKIM y DMARC (y CNAME de rebotes si ZeptoMail). No se revisó el DNS actual.
- Procedimiento para revisar avisos de rebote (NDR) en la casilla y registrarlos en el panel («Registrar rebote»).
- Prueba controlada de envío real a una casilla propia antes de habilitar (con `MAIL_ALLOW_REAL_SEND=1`).

## 4. Plazos y criterios de conservación de datos (pendientes)

No se fijaron plazos legales. Estado actual:

- Solicitudes de arrepentimiento, comunicaciones, intentos y eventos de auditoría: **sin eliminación automática**. Definir plazo y procedimiento de revisión/supresión.
- Pedidos y huellas antiabuso de pedidos: sin eliminación automática (igual que fases anteriores).
- Limpieza técnica implementada (no son plazos de conservación de datos personales): tokens de recuperación vencidos hace más de 1 día, eventos de límite por IP de más de 1 día y latidos de ejecutores sin actividad en 30 días. Revisar si el criterio es aceptable.
- Los emails enviados quedan además en la carpeta «Enviados» de Zoho según su configuración: definir retención.
- Registros técnicos de proveedores (Supabase, Vercel/VPS, Zoho): confirmar retención.

## 5. Revisión jurídica y contable pendiente

- Revisar los cinco borradores (y la página de recuperación) contra la normativa vigente al publicar, la jurisdicción y la operación efectiva.
- Excepciones de la Disposición 954/2025 art. 3 junto con normas de mayor jerarquía (CCyC arts. 1114–1116). La recepción nunca se rechaza por cosmético abierto, plazo o estado financiero; la evaluación es humana.
- Validar que la constancia web inmediata cumple la comunicación del código «por el mismo medio» y que el email de respaldo no se presenta como equivalente jurídico automático.
- Revisar la redacción de Factura C, monotributo y envío manual del comprobante (contador).
- Regiones de Supabase, Vercel/VPS y Zoho; encargados/subencargados, contratos y transferencias internacionales (Ley 25.326, art. 12). Obligaciones registrales ante AAIP.
- Revisar Formspree, fuentes Google de algunas páginas y enlaces a redes/WhatsApp.
- Actualizar privacidad antes de integrar Mercado Pago.
- Aprobar identificación fiscal, versiones definitivas; luego retirar el aviso de borrador y `noindex`, e incorporar documentos aprobados al sitemap.

## 6. Configuración de alertas y supervisión ante fallos críticos (pendiente)

Implementado (ver `docs/zoho-correo.md` §7): alerta por email a `info@` ante constancias fallidas; monitor
`GET /api/interno/comunicaciones` (token) y `npm run mail:worker -- --health`; banner y filtro en el panel;
latido del ejecutor.

Pendiente y **no funcionando hoy**:

- Desplegar el ejecutor autónomo en el VPS con reinicio automático (no hay ejecutor corriendo fuera de las pruebas locales).
- Configurar un monitor externo que consulte el estado y avise por un canal **distinto** del correo (el email de alerta no llega si Zoho está caído).
- Designar responsable y reemplazo para revisar alertas y el panel en el horario de atención (lunes a viernes 8:00–16:00), y criterio para fuera de horario. La recepción web y la cola funcionan sin administradores conectados; la gestión humana no.
- Canal alternativo para comunicar el código si el email falla (p. ej. WhatsApp institucional), registrándolo en el panel como «resuelto por otro canal».

## Evidencia mínima de aceptación propuesta para compras futuras

Sin cambios respecto de la revisión anterior: documentos inmutables con identificador, vigencia y SHA-256;
`crear_pedido` validando las versiones vigentes y registrando la aceptación en la misma transacción; sin casillas
premarcadas ni IP en claro. El aviso destacado de arrepentimiento debe acompañar el cierre y el comprobante (CCyC art. 1111).

## Fuentes oficiales consultadas (03/11/2026)

- [Ley 24.240, texto actualizado](https://www.argentina.gob.ar/normativa/nacional/ley-24240-638/actualizacion).
- [Código Civil y Comercial, texto actualizado](https://www.argentina.gob.ar/normativa/nacional/c%C3%B3digo-civil-y-comercial-de-la-naci%C3%B3n-235975/actualizacion): arts. 1109–1116.
- [Disposición 954/2025](https://www.argentina.gob.ar/normativa/nacional/disposici%C3%B3n-954-2025-417152/texto).
- [Disposición 3/2026](https://www.argentina.gob.ar/normativa/nacional/disposici%C3%B3n-3-2026-423007/texto).
- [Ley 25.326, texto actualizado](https://www.argentina.gob.ar/normativa/nacional/64790/actualizacion).
- [AAIP — protección de datos personales](https://www.argentina.gob.ar/aaip/datospersonales).
