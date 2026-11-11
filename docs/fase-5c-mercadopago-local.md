# Fase 5C · Webhooks y conciliación local

## Alcance y activación

La migración `20261110130000_conciliacion_pagos.sql` agrega el registro privado de trabajos, los campos de seguimiento financiero del intento y la evidencia del simulador. El receptor y el ejecutor requieren `NODE_ENV=development`, `STEFFEN_MP_MODE=mock`, `STEFFEN_MP_RECONCILIATION=1` y Supabase local en el puerto 55321. El receptor además requiere una clave de servidor de Supabase y `STEFFEN_MP_MOCK_WEBHOOK_SECRET` local de al menos 32 caracteres. Vercel, los builds productivos, los proxies configurados y las URLs de Supabase Cloud quedan bloqueados. El reconciliador puede procesar un pago previo aunque el checkout esté apagado.

```sh
npx supabase migration up --local
npm run dev -- --hostname localhost
node --env-file=.env.worker --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/payment-worker.ts
```

El archivo local de entorno del trabajador contiene las variables anteriores y la clave **del stack local** `SUPABASE_SECRET_KEY`. El receptor lee su secreto local desde el entorno de Next. `npm run payment:worker -- --once` ejecuta un ciclo con las variables ya exportadas. `--health` informa trabajos en revisión, atrasados y concesiones vencidas. El ejecutor es un proceso independiente del correo y usa logs JSON con identificadores internos y resultados clasificados. La evidencia se prepara desde PostgreSQL local como fixture. La API web carece de una operación para editarla.

Para ensayar una acreditación sobre una order de prueba existente, ejecutar en PostgreSQL local como `postgres` el siguiente cambio con el identificador de esa order. Cada cambio del fixture aumenta la revisión. El próximo polling elegible puede confirmar el pago aunque no se envíe el webhook.

```sql
update private.mock_checkout_orders
set status = 'processed', status_detail = 'accredited', paid_amount = total_ars,
    payment_id = coalesce(payment_id, 'PAYMOCK' || replace(gen_random_uuid()::text, '-', '')),
    revision = revision + 1
where id = '<ORDMOCK de prueba>';
```

## Recepción y firma

`POST /api/mercadopago/webhook` autentica mediante HMAC-SHA256 y comparación de 32 bytes en tiempo constante. El tópico de suscripción es `orders_v2` y el ejemplo de entrega de Checkout Pro usa `type=order`. El manifest usa `data.id` de la query, `x-request-id` y el valor textual de `ts`. En local se conserva el ID exacto y se exige el formato del simulador. Se aceptan timestamps de 10 o 13 dígitos con una ventana de cinco minutos hacia atrás y 30 segundos hacia adelante. Un body con ID, versión, tipo o entorno incompatible se rechaza. El cuerpo se limita a 16 KiB mediante lectura acotada. [Notificaciones de Checkout Pro](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/notifications) · [Estados de Checkout Pro](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/payment-management/status/order-status)

El receptor guarda solo ID de notificación, request, order, tipo y entorno. El commit precede al HTTP 200. Un replay del evento persistido recibe confirmación idempotente. Una colisión incompatible devuelve 409 y un fallo de PostgreSQL devuelve 503. La firma autentica el manifest, por lo que el cuerpo sirve como sobre y la resolución consulta la order de forma independiente.

Si el sobre declara vendedor o aplicación, deben corresponder al simulador. El reconciliador vuelve a verificar ambos campos de la respuesta autenticada y PostgreSQL exige que la evidencia vigente pertenezca al intento vinculado. Los tests incluyen un sobre firmado con otro vendedor y una respuesta de proveedor con identidad ajena.

## Conciliación y transición

1. El trabajador reclama un trabajo de webhook o programa una consulta de un intento abierto, desconocido o con concesión de creación vencida. PostgreSQL asigna una concesión de 30 segundos mediante `FOR UPDATE SKIP LOCKED`.
2. El adaptador simulado consulta la order por ID. Para una creación ambigua busca mediante referencia externa y fechas RFC 3339. Exige una coincidencia única y la vuelve a consultar por ID. Una búsqueda vacía provoca reintentos acotados y conserva la clave del intento original. La reconciliación carece de una operación de creación remota.
3. Se valida el ID, la referencia, el vendedor, la aplicación, el entorno, ARS y el formato monetario exacto. Para acreditar se exige `processed/accredited`, un ID de pago válido y coincidencia entre total cobrado, order, intento y pedido. La RPC verifica que la evidencia coincide con el registro vigente del simulador, vinculado al intento por la clave idempotente. Una revisión obsoleta o que degradaría una acreditación se ignora.
4. Bajo bloqueo del pedido y con una concesión vigente, `private.aplicar_pago()` aplica el pago y escribe la auditoría de pedidos. El ID del pago, con prefijo de entorno, preserva la deduplicación aunque el webhook y el polling compitan. El resultado del trabajo se persiste en la misma transacción.
5. Los fallos temporales tienen backoff de hasta 15 minutos. Un webhook que agota 10 intentos queda en revisión. El trabajo de polling conserva su capacidad de recuperación ante errores técnicos repetidos y alerta en `degraded_polls`. Una orden aún pendiente se consulta al minuto durante siete días y luego cada 15 minutos con alerta operativa. Una lectura correcta reinicia el contador técnico. La evidencia inconsistente, los reembolsos y los contracargos quedan en revisión.

| Estado y detalle | Tratamiento |
|---|---|
| `created/created` | Registrado, sigue en conciliación. |
| `action_required/waiting_capture`, espera de pago, transferencia o reintento | Pendiente. |
| `action_required/pending_challenge`, `processing/in_process` o revisión | En procesamiento. |
| `processed/accredited` | Acreditación únicamente con evidencia completa. |
| `failed` con detalle conocido | Rechazo auditado cuando existe un ID de pago válido. |
| `canceled/canceled`, `canceled/expired`, `expired/expired` | Cancelada o vencida en el proveedor. La reserva sigue su ciclo local. |
| `processed/partially_refunded`, `refunded/refunded`, contracargo conocido | Estado e incidencia para seguimiento en 5D. |
| Otra combinación | Incidencia `unknown_state`. |

Una acreditación posterior a la liberación por vencimiento intenta descontar stock con las reglas existentes. Si las unidades siguen reservadas, la función consume esa reserva. Si ya se liberaron y no hay unidades, el pedido muestra pago recibido con `stock_shortage` pendiente, queda fuera de preparación y requiere contacto del administrador. Para un pedido cancelado se registra `cancelled_order_paid` como incidencia del trabajo y se conserva la cancelación.

## Contrato y preparación de staging

Checkout Pro documenta `GET /v1/orders/{order_id}`, búsqueda por `begin_date`, `end_date` y `external_reference`, duración relativa `expiration_time` y `X-Idempotency-Key`. La referencia documenta `409 idempotency_key_already_used`; en una respuesta ambigua, generar otra clave sin determinar el resultado podría duplicar la order. El simulador usa una revisión local y un ID de pago sintético. La futura normalización HTTP debe verificar el identificador de la transacción acreditada, su importe, el vendedor y los campos de aplicación y entorno que entregue el recurso. [Referencia de Orders](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-orders/overview) · [Búsqueda](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-orders/search-orders/get) · [Vigencia](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/additional-settings/define-order-validity) · [Errores](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/payment-management/integration-errors)

Para D9, preparar un dominio HTTPS aislado con la ruta de webhook, un proyecto PostgreSQL de staging separado, un vendedor de prueba, la aplicación y sus credenciales de prueba, y el secreto de firma de esa aplicación. Las variables propuestas de servidor son `MP_TEST_ACCESS_TOKEN`, `MP_TEST_WEBHOOK_SECRET`, `MP_TEST_SELLER_ID`, `MP_TEST_APPLICATION_ID` y `MP_TEST_WEBHOOK_ORIGIN`, además de las credenciales del proyecto aislado. La implementación local carece de un selector para activar ese modo.

En staging quedan por comprobar el formato real de las entregas y la fuente, capitalización y normalización de `data.id`, el timestamp en reintentos, los campos de identidad que devuelve GET, los estados de disputa y los métodos que pueden acreditar tarde. Verificar también la duración mínima y granularidad de `expiration_time`, repetición tras vencimiento, retención de la clave, `409`, indexación de búsqueda y respuestas ambiguas. El mínimo aceptado debe permitir respetar la reserva de 30 minutos, incluyendo el tiempo de red y reintentos. La activación real sigue bloqueada hasta resolver esas pruebas y definir el manejo de operaciones que puedan acreditarse fuera de esa ventana.

## Archivos y pruebas

- Receptor en `src/app/api/mercadopago/webhook/route.ts` y validación en `src/lib/orders/payment-webhook.ts`.
- Consulta y máquina de estados en `src/lib/orders/payment-reconciliation.ts`, con entrada autónoma en `scripts/payment-worker.ts`.
- Persistencia, permisos y operación atómica en la migración, con firmas RPC en `src/lib/supabase/database.types.ts`.
- Unitarias en `src/lib/orders/payment-reconciliation.test.ts` y auditoría estática en `src/lib/orders/secrets.audit.test.ts`.
- pgTAP en `supabase/tests/database/conciliacion_pagos.test.sql`, carreras en `supabase/tests/concurrency/pedidos.concurrency.test.ts` y pruebas HTTP y responsive en `e2e/checkout.spec.ts`.
- Configuración y regresiones de apagado en `.env.example`, `package.json`, `playwright.config.ts`, `playwright.pago-local.config.ts`, `e2e/local.ts` y `e2e/carrito-apagado.spec.ts`.

Validación local completada con TypeScript, build productivo, auditoría estática y del bundle, 152 unitarias, 852 comprobaciones pgTAP y 22 pruebas de concurrencia. Playwright pasó 167 pruebas generales, 20 del simulador, 9 de funcionalidades apagadas y 8 de Traefik. Supabase local quedó con la migración aplicada, reserva de 30 minutos, checkout apagado y cero pedidos, intentos, órdenes simuladas y trabajos.
