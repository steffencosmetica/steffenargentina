# Fase 5 — diseño previo de correos de pedido y facturación manual

**Solo diseño. Nada de esto está implementado en 4B.7.** No hay facturación automática, envío de PDFs fiscales
ni correos disparados por webhooks de Mercado Pago.

Base reutilizable: la cola `revocation_messages` y el ejecutor de 4B.7 demuestran el patrón (encolado en la misma
transacción, arrendamiento, reintentos, alertas, panel). Para pedidos conviene una tabla análoga
(`order_messages`) con clave única `(order_id, kind)` y el mismo ejecutor.

## Correos automáticos previstos

| Correo | Disparador | Contenido mínimo | Notas |
|---|---|---|---|
| Pedido recibido | `crear_pedido()` confirma (misma transacción) | Código de pedido, resumen, total, enlace privado de seguimiento, aviso de que **no** implica pago aprobado, acceso al Botón de Arrepentimiento | El enlace de seguimiento existente; nunca el token de recuperación de arrepentimiento. |
| Pago aprobado | Cambio a `payment_status = approved` | Código, importe, próximos pasos, plazo estimado de 1 a 3 días hábiles para preparar y despachar (sin incluir transporte) | Con Mercado Pago dependerá del webhook verificado: **no implementar hasta integrar MP**. |
| Pedido despachado | Registro **manual** del despacho en el panel | Transportista (predeterminado **Andreani**, editable), número de seguimiento, fecha | La confirmación sigue siendo manual; el registro manual dispara el correo automático. |

Todos transaccionales (sin marketing), con atención de lunes a viernes de 8:00 a 16:00 por email y WhatsApp.

## Facturación manual (Factura C, monotributo)

- Sin integración con ARCA. La factura se emite a mano en ARCA y el PDF se envía a mano desde Zoho.
- Registro propuesto en el pedido: `invoice_status` (`pendiente` / `emitida` / `enviada`), número de comprobante,
  fecha de emisión y fecha de envío, cada cambio auditado con el administrador. **No** se guarda el PDF en la
  base ni se envía automáticamente.
- Vista «Facturas pendientes» en el panel: pedidos con pago aprobado y factura pendiente.
- Pendiente de definición contable: momento de emisión (pago aprobado o despacho), datos del comprador necesarios
  para Factura C a consumidor final, conservación de comprobantes.

## Transportista

- Campo `carrier` con valor predeterminado `Andreani` y posibilidad de otros transportistas.
- Número de seguimiento validado (longitud y caracteres), sin enlace automático hasta confirmar el formato oficial.
