// Punto de integración del pago (Fase 5: Mercado Pago Checkout Pro). TODAVÍA NO HAY PAGOS.
//
// Flujo previsto, sobre el pedido ya creado por crear_pedido() (estado pending / reserved):
//   1. Servidor: crear la preferencia de Checkout Pro con el código del pedido como external_reference y
//      los importes LEÍDOS DE LA BASE (order_items y total_ars), nunca los del navegador.
//   2. Redirigir al comprador al init_point de la preferencia.
//   3. Webhook (servidor): verificar la firma, consultar el pago a la API de Mercado Pago y recién entonces
//      aplicarlo con private.aplicar_pago() a través de una función de servidor dedicada.
//   4. Retornos (success / pending / failure): solo informativos; el estado real lo da el webhook.
//   5. Vaciar el carrito del navegador cuando el pedido figure pagado (no antes).
//
// Mientras tanto no se simula ningún pago: el pedido queda pendiente y la reserva vence sola.

export type PaymentStart = { kind: 'unavailable' } | { kind: 'redirect'; url: string };

export const ONLINE_PAYMENTS_ENABLED = false;

/** Inicio del pago de un pedido. Hoy siempre `unavailable`. */
export function paymentStartFor(_orderCode: string): PaymentStart {
  return { kind: 'unavailable' };
}
