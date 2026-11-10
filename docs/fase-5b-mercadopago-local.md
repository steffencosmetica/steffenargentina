# Fase 5B · Creación de órdenes de pago en local

## Activación

El modo simulado requiere `next dev`, Supabase local, los controles del checkout de 4B.8 y `store_settings.checkout_enabled = true`. Configurar `STEFFEN_MP_MODE=mock` y `STEFFEN_MP_LOCAL_ORIGIN=http://localhost:3000` en el entorno de desarrollo. Iniciar con `npm run dev -- --hostname localhost` y abrir la tienda en el origen configurado. Aplicar la migración con `npx supabase migration up --local`. El checkout puede habilitarse para pruebas con el comando local documentado en `supabase/docs/checkout.md`. El build productivo mantiene apagado el pago incluso con las dos variables del simulador. Los entornos HTTPS de staging y producción requieren una integración posterior. El simulador opera mediante PostgreSQL local.

## Flujo y recuperación

- El seguimiento envía exclusivamente el código y el token privado en el cuerpo de `POST /api/pedido/pago`. PostgreSQL compara su hash y devuelve el mismo resultado para un código inexistente o un token incorrecto. Se limita a 60 solicitudes por minuto por IP de confianza seudonimizada. Los RPC son de servidor y las tablas tienen RLS y permisos revocados para los roles de API.
- La adquisición bloquea la fila del pedido y verifica el checkout, el estado de pago, la incidencia y la reserva vigente. El intento tiene un ID, una clave de idempotencia y una referencia externa únicos. Guarda importe, entorno, vendedor simulado, marcas de tiempo, vencimiento, estado de creación e ID remoto cuando se confirma. Una restricción permite un solo intento por pedido durante 5B.
- `creating` tiene una concesión exclusiva de 20 segundos. `unknown` conserva la misma clave ante timeout, red, 409 o respuesta inválida. Si falla la persistencia final o se interrumpe el proceso, el siguiente dueño recupera la concesión vencida. Primero busca por referencia y fechas RFC 3339, valida el resultado por ID y, si no encuentra una order, repite con la misma clave. Un 409 dispara otra búsqueda. Una coincidencia ambigua conserva el bloqueo contra duplicados.
- El simulador confirma su order en una transacción independiente. PostgreSQL registra el ID mediante una concesión que identifica al solicitante y verifica de nuevo la elegibilidad antes de entregar la URL. `open` reutiliza la order vinculada. La reserva original sigue su ciclo de 30 minutos. El simulador limita la creación y redirección a una fecha absoluta 30 segundos anterior al vencimiento.
- En 5C, los intentos `creating` con concesión vencida y `unknown` son candidatos a conciliación aun después de vencer la reserva. La conciliación debe verificar referencia, vendedor, entorno, moneda e importe antes de vincular. Una búsqueda vacía, un timeout o un 409 por sí solos dejan el resultado indeterminado. Para habilitar otro intento se requerirá evidencia definitiva sobre el anterior y una transición transaccional con unicidad de intento activo.

## Contrato de Orders

- El adaptador contempla `POST /v1/orders`, consulta por ID y búsqueda con `begin_date`, `end_date` y `external_reference`. En local los métodos usan RPC y un timeout de cuatro segundos. La integración HTTP futura debe enviar la misma clave persistida en el header obligatorio `X-Idempotency-Key`. El payload incluye `type=online`, `processing_mode=manual`, `total_amount` decimal como texto, la referencia del pedido, ítems históricos y `expiration_time` ISO 8601. Se omite el objeto opcional `payer` para minimizar datos. Si se incorpora, requiere `payer.email`. [Creación](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-orders/create-order/post) · [Búsqueda](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro/search-orders/get)
- Los precios salen como texto desde PostgreSQL. Los centavos enteros se multiplican por las cantidades y se comparan contra el total persistido. Si el envío tiene costo, aparece como un ítem adicional.
- Se excluye el tipo `ticket`, que abarca `rapipago` y `pagofacil`, y se configura `max_installments=6`. Las promociones dependen de la configuración comercial del vendedor. El descriptor solicitado es `STEFFEN`. [Exclusiones](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/additional-settings/exclude-payment-methods) · [Rapipago y Pago Fácil](https://www.mercadopago.com.ar/developers/es/docs/checkout-api-orders/payment-integration/rapipago-pagofacil)
- Las URLs de `config.online` usan el origen configurado, el código y un resultado fijo. El seguimiento interpreta esos resultados como avisos y consulta su estado habitual. El token queda en el enlace privado o en `sessionStorage` y se envía por POST al propio sitio. La respuesta exitosa contiene solo `checkoutUrl`, validada contra el origen, ruta y parámetros exactos del simulador. [URLs de retorno](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/web-integration/configure-back-urls)

## Pendientes antes de la integración real

- En staging HTTPS aislado (D9), verificar el mínimo y la granularidad de `expiration_time`, el momento efectivo en que empieza a correr, y el comportamiento al repetir la misma clave cerca del vencimiento. La duración es relativa a la creación remota. La activación real queda bloqueada hasta demostrar que la vigencia respeta la reserva, incluso con retrasos o reintentos. [Vigencia de la order](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/additional-settings/define-order-validity)
- Validar aceptación y retención de la idempotencia, semántica del 409, disponibilidad y retraso de la búsqueda, lectura de la URL en consulta, hosts y rutas oficiales, vendedor, contexto de prueba, validación de importes, exclusiones efectivas, cuotas y descriptor aprobado. Puede haber pagos pendientes o en revisión aun con `ticket` excluido.
- D2 prevé contacto con el comprador ante un pago tardío sin stock. D3 prevé gestión individual de pedidos despachados. D4 descarta la reposición automática de stock por reembolso. D5 requiere administrador autorizado, confirmación y auditoría. Son decisiones de 5C/5D.
- D7 prevé recuperar el seguimiento por correo y token temporal en la fase de comunicaciones. En 5B el acceso sigue siendo mediante el enlace privado existente. D8 mantiene correo simulado durante el desarrollo y reserva la configuración de Zoho para antes del lanzamiento.

## Pruebas

`npm test` incluye el contrato y la auditoría estática. `npm run db:test` incluye pgTAP de intentos. `npm run test:concurrency` usa conexiones simultáneas reales. `npm run test:e2e:pago-local` verifica seguimiento, redirección, persistencia fallida, retorno y estados incompatibles en escritorio y móvil. Guarda capturas de ambos proyectos en `test-results-pago-local/`. La suite principal comprueba que el build productivo mantiene apagado el pago.

## Archivos

- PostgreSQL y tipos de RPC: `supabase/migrations/20261110120000_intentos_pago.sql` y `src/lib/supabase/database.types.ts`.
- Contrato, adaptador y servicio: `src/lib/orders/payment.ts`, `payment-provider.ts` y `payment-server.ts`.
- API y seguimiento: `src/app/api/pedido/pago/route.ts`, `src/app/(tienda)/pedido/[codigo]/page.tsx` y `src/components/checkout/OrderStatus.tsx`.
- Pruebas: `src/lib/orders/payment.test.ts`, `src/lib/orders/secrets.audit.test.ts`, `supabase/tests/database/intentos_pago.test.sql`, `supabase/tests/concurrency/pedidos.concurrency.test.ts`, `e2e/checkout.spec.ts` y `e2e/carrito-apagado.spec.ts`.
- Configuración de desarrollo y pruebas: `.env.example`, `.gitignore`, `package.json`, `playwright.config.ts`, `playwright.pago-local.config.ts` y `tsconfig.json`.
