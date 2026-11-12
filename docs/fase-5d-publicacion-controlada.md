# Fase 5D — Auditoría para publicación controlada

Fecha: 12/11/2026. Repositorio `steffencosmetica/steffenargentina`, rama `feat/catalogo-supabase`, HEAD inicial `4e72478b94d569d9dd5962f6522e79644d1b5a55`.

## Estado

El propietario confirmó manualmente la ausencia de credenciales productivas Mercado Pago, flags comerciales/legales/arrepentimiento apagados, SMTP real apagado, ausencia de trabajadores y Cron Jobs, y ausencia de variables heredadas que cambien esas condiciones. La API administrativa de Vercel sigue respondiendo HTTP 403; no se cambió ningún login ni credencial global.

Se repitió el preflight, la identidad y el dry-run inmediatamente antes de escribir y se aplicó exclusivamente la migración autorizada. Cloud registra ahora 17 migraciones. La publicación se detuvo inicialmente por una diferencia de `ordinal_position` de `private.mock_checkout_orders.refund_balance_cents`, Cloud 11 frente a local 15. El diagnóstico de lectura posterior, autorizado por el propietario, la clasifica como **no funcional y aceptada** según los criterios indicados abajo. No se hizo ninguna corrección ni reversión en Cloud y no se volvió a aplicar la migración.

## Auditoría de riesgos e idempotencia

- El adaptador disponible solo ejecuta RPC del simulador. No hay transporte HTTP de reintegros reales ni lectura de Access Token Mercado Pago que lo pueda habilitar accidentalmente. Producción y Vercel quedan excluidos por `paymentReconciliationEnabled` y `afterSalesEnabled`, además del flag explícito y el destino Supabase local.
- Se conserva una clave de idempotencia por intención. Hay una sola intención incompatible activa por pedido, bloqueo del pedido antes de escribir, concesiones de 30 segundos y fencing UUID. Un resultado ambiguo mantiene bloqueada otra solicitud. La confirmación proviene de observar el ledger, no del acuse del envío.
- Los parciales acumulados y el siguiente total utilizan centavos enteros y saldo verificado. El servidor selecciona la transacción persistida, no confía en el importe del formulario y exige administrador, motivo y confirmación explícita.
- Pedidos cancelados sin acreditación histórica local, pagos adicionales duplicados y operaciones con evidencia desconocida no se habilitan para reintegro. Reintegros externos consumen saldo; una disputa abierta o perdida bloquea el envío. No hay reembolso comercial iniciado por webhook, worker o arrepentimiento.
- Reembolsos, recepción física e inspección apta no modifican stock. Las cantidades devueltas acumuladas no pueden superar las vendidas; se rechaza la operación. La reincorporación futura requiere un movimiento explícito, autorizado, auditable e idempotente, todavía no implementado.
- Las tablas nuevas tienen RLS y revocación de acceso directo. Las RPC administrativas verifican el rol en PostgreSQL; las privilegiadas del simulador se limitan a service_role. Se mantienen Server Actions y protecciones de origen de Next, controles de replay y límites administrativos. Las claves de proveedor y concesiones no se entregan al componente cliente.

## Documentación externa y operaciones bloqueadas

La [consulta de una order](https://www.mercadopago.com.ar/developers/es/reference/online-payments/checkout-pro-orders/get-order/get) y el ejemplo de [notificaciones de contracargos](https://www.mercadopago.com.ar/developers/es/docs/checkout-pro-orders/chargebacks/notifications) representan los pagos mediante `transactions.payments`, una colección. No se considera que una order tenga necesariamente una única transacción. El constructor local puede seleccionar explícitamente entre varias transacciones verificadas; el simulador actual acredita una. La compatibilidad real multitransacción y la recuperación de reintegros siguen bloqueadas hasta probar la normalización y saldos por transacción en staging aislado.

La documentación de contracargos exige seleccionar el evento **Chargebacks además de Order**. Indica una URL HTTPS configurada por entorno; no exige que sea una URL distinta. El receptor real de ese tópico no está implementado: la conciliación de orders no se presenta como cobertura completa. No se registró ninguna suscripción ni URL externa.

Siguen pendientes transporte real, total tras parciales, idempotencia/409 y resultados ambiguos reales, vigencia de order frente a la reserva de 30 minutos, casos y plazos reales de contracargos, tratamiento por transacción de pagos cancelados/duplicados y el movimiento físico de inventario. No se activan por publicar la estructura.

## Suites repetidas para este cierre

| Suite | Resultado |
| --- | --- |
| TypeScript | Aprobado |
| Build productivo con destino Supabase local fijado | Aprobado |
| Unitarias y auditorías estáticas | 160 aprobadas |
| pgTAP completo | 938 aprobadas, 14 archivos |
| Concurrencia real | 23 aprobadas |
| Playwright general | 167 aprobadas |
| Mercado Pago simulado desktop/mobile | 26 aprobadas |
| Funcionalidades apagadas | 10 aprobadas |
| Traefik | 8 aprobadas |
| Secretos y bundle público | 43 assets por cada build general, apagado y proxy, sin secretos ni RPC financieras privilegiadas |

Todas las suites se ejecutaron secuencialmente, sin eliminar pruebas ni aumentar timeouts. Logs locales en `artifacts/fase-5d/release-tests`, ignorados por Git. No se hicieron cobros, reintegros o envíos SMTP reales.

## Preflight Cloud de solo lectura

- Proyecto exacto: `zzxlghpopmccwsaqbsko`, **Steffen Web tienda**, `ACTIVE_HEALTHY`.
- Credenciales aisladas existentes de Steffen Tienda; no se ejecutó `supabase login`.
- PostgreSQL con TLS `verify-full`, CA explícita, host `db.zzxlghpopmccwsaqbsko.supabase.co`; snapshots en transacción repeatable read, read only. La conexión además confirmó TLS y estado de solo lectura.
- 16 migraciones exactamente iguales a la referencia guardada del cierre 5C. Sin deriva de metadatos, permisos ni funciones anteriores.
- Huellas del catálogo, precios, imágenes, Storage, usuarios y demás datos comerciales iguales a esa referencia.
- Un producto, 25 unidades, `stock_version=1`.
- Checkout false; cero pedidos, intentos de checkout/pago, mock orders, trabajos financieros y límites de pago persistidos; cero sesiones financieras detectadas. `pg_cron` ausente.
- Esquema local anterior a las adiciones 5D compatible con el esquema Cloud auditado.
- Snapshot idéntico antes y después del dry-run.

Resultado exacto del dry-run:

```json
{"upToDate":false,"dryRun":true,"migrations":["20261110140000_posventa_pagos.sql"],"seeds":[],"roles":[],"message":"Finished supabase db push."}
```

Migración revisada: `20261110140000_posventa_pagos.sql`.
SHA-256: `557d9026fe820e92c987a3e332941e8e21b807994f8d2b3c331c37d812cd0a3c`.

## Aplicación y auditoría posterior de solo lectura

Aplicada exclusivamente `20261110140000_posventa_pagos.sql`, sin seeds, resets ni roles adicionales. Se repitieron identidad, snapshot y dry-run inmediatamente antes de aplicarla; no hubo diferencias previas. El SQL y su SHA-256 permanecen iguales a los revisados.

Las comprobaciones posteriores, todas de lectura, confirmaron:

- 17 migraciones y las 16 anteriores intactas.
- Huellas de catálogo, precios, imágenes, Storage, usuarios y datos comerciales idénticas antes/después.
- Un producto, 25 unidades y `stock_version=1`, sin cambios.
- Checkout false, cero pedidos e intentos, cero trabajos y todas las ocho tablas 5D vacías.
- RLS habilitada en las ocho tablas nuevas y cero exposiciones directas a anon, authenticated o service_role.
- Metadatos, permisos y funciones anteriores sin cambios no previstos. Todos los metadatos nuevos coinciden con local salvo el ordinal indicado abajo.
- Metadatos de secretos internos intactos, `pg_cron` ausente y cero sesiones financieras detectadas.

La comparación estricta se detuvo en `columns`: la única diferencia es `ordinal_position` de `private.mock_checkout_orders.refund_balance_cents` (Cloud 11, local 15). Los otros campos de esa columna y el resto de tablas, restricciones, índices, funciones, triggers, políticas y permisos coinciden.

Una consulta de lectura a `pg_attribute` local confirmó cuatro atributos eliminados, posiciones 11–14, y la columna actual en 15. Corresponden a las reconstrucciones locales de la migración durante las pruebas. Cloud la creó por primera vez en 11. Es una diferencia física de historial local, sin diferencia detectada en tipo, nulabilidad, restricciones, permisos o datos. No se alteró el comparador para ignorarla ni se hizo una reversión. Se respeta la instrucción de detenerse ante diferencias inesperadas.

Evidencia técnica local ignorada por Git: `steffen-5d-publicacion/cloud-before.json`, `cloud-after.json`, ambos dry-runs y `post-audit-delta.json` dentro del directorio temporal del sistema. El resultado completo se obtuvo con la conexión TLS y transacción de solo lectura descritas arriba.

## Git, Preview y continuación pendiente

En la detención inicial no se había creado commit ni realizado push; HEAD estaba en `4e72478b94d569d9dd5962f6522e79644d1b5a55`. Tras aceptar el diagnóstico de abajo se autoriza continuar con el commit y push de 5D, cuyo hash y resultado se informan en la entrega. Se conserva sin seguimiento el documento 5A preexistente. No se tocan ramas protegidas.

Antes de la continuación, GitHub informaba éxito de Vercel para el commit anterior aprobado y el deployment `3h9cH4t1sR24BBdCmRiVmkUgVQQj`. El deployment de 5D se comprueba después del push. No se usan respuestas SSO como evidencia de 404. La configuración remota fue verificada manualmente por el propietario; las rutas que sigan inaccesibles por autenticación se dejan expresamente para revisión manual.

## Diagnóstico ordinal aceptado

El propietario autorizó aceptar la discrepancia si se verificaban equivalencia lógica, ausencia de dependencias funcionales del orden físico, corrección de permisos/RLS y conservación de los datos. Esas condiciones se verificaron mediante consultas exclusivamente de lectura sobre Cloud y el catálogo local:

- `refund_balance_cents`: `bigint` (`int8`), nullable, sin default, sin generación automática, CHECK `refund_balance_cents >= 0` en ambas bases.
- Todas las otras columnas coinciden. Cloud no tiene atributos `attisdropped`; local tiene cuatro, posiciones 11–14, y el nuevo atributo en 15. La causa es el historial local de DROP/ADD durante las reconstrucciones de prueba, no un esquema lógico distinto.
- Se compararon restricciones, los tres índices únicos, foreign keys entrantes y salientes, triggers, funciones, ACL, políticas y RLS. No hay trigger de usuario en `mock_checkout_orders`; las FK son por `id` y `idempotency_key`, no por el saldo.
- La tabla simulada está vacía en ambas bases y tiene la misma huella de filas; no hay valores de columnas restantes que difieran. Las huellas comerciales y los permisos anteriores siguen coincidiendo con la referencia previa a 5D. Las 17 migraciones coinciden con el snapshot posterior a la aplicación.
- La comparación de todos los metadatos lógicos queda sin diferencias cuando se normaliza **exclusivamente** ese campo `ordinal_position` de esa columna. No se ignoran otros ordinales ni otras diferencias.

Se examinaron `pg_depend`, el tipo compuesto y su tipo array automático, y los cuerpos actuales de las siguientes funciones y sus consumidores transitivos: `simular_order_pago`, `buscar_order_pago_simulada`, `mock_payment_evidence`, `refundable_mock_order`, `admin_solicitar_reembolso`, `admin_ver_posventa`, `simular_reembolso_posventa`, `observe_after_sales`, `observe_after_payment_job`, `resolver_trabajo_pago`, `resolver_reembolso_posventa` y `resolver_posventa_simulada`.

El INSERT en la tabla declara explícitamente `(id, idempotency_key, external_reference, total_ars)`. Los `SELECT * INTO m` cargan el tipo compuesto de esa misma relación en la misma base y acceden posteriormente por nombre; no se exportan como contrato de tuplas entre local y Cloud. `refundable_mock_order` devuelve ese mismo tipo nominal. `mock_payment_evidence` construye JSON con claves explícitas y el adaptador consume objetos por nombre. Los arrays de transacciones son JSON de objetos con campos nombrados; no convierten el registro completo en un array posicional. No se hallaron INSERT sin lista, conversiones posicionales del registro, uso funcional de `attnum`/`ordinal_position`, SQL dinámico para esa relación ni vistas/reglas que introduzcan ese contrato. Las lecturas de catálogo y la huella `to_jsonb` pertenecen al diagnóstico, no al flujo financiero.

Resultado: **diferencia interna no funcional, aceptada; esquema funcional confirmado**. No se reconstruyó ninguna tabla ni se modificó Cloud para igualar posiciones. Se mantiene la prohibición de activar pagos, reintegros, checkout, SMTP, workers o cron reales. Evidencia de lectura: `ordinal-accepted.json` y `ordinal-function-review.json` en el directorio temporal de la publicación, fuera del commit.

La migración ya está aplicada y no debe volver a ejecutarse. Se continúa exclusivamente con documentación, commit y push de la rama autorizada, y verificación del nuevo deployment.
