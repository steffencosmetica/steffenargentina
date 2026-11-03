// Resultado de crear_pedido() y mensajes para el comprador. No expone stock exacto ni detalles internos.

import { parseCentavos, type Centavos } from '../money.ts';
import { CHECKOUT_FIELDS, type CheckoutField } from './validation.ts';

export const REJECTION_CODES = [
  'checkout_disabled',
  'invalid_input',
  'quantity_limit',
  'idempotency_conflict',
  'too_many_attempts',
  'too_many_orders',
  'too_many_pending_orders',
  'product_unavailable',
  'insufficient_stock',
  'no_shipping_coverage',
  'total_mismatch',
  // error inesperado en la base: el intento se registró y se puede reintentar con la misma clave
  'internal_error',
] as const;
export type RejectionCode = (typeof REJECTION_CODES)[number];

export type CreateOrderResult =
  | {
      status: 'created' | 'replayed';
      orderId: string;
      code: string;
      token: string;
      totalCentavos: Centavos;
      reservationExpiresAt: string;
    }
  | {
      status: 'rejected';
      error: RejectionCode | 'unknown';
      fields: CheckoutField[];
      productIds: string[];
      /** total vigente cuando el error es total_mismatch */
      currentTotalCentavos: Centavos | null;
    };

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const asString = (v: Json | undefined) => (typeof v === 'string' ? v : null);
const amount = (v: Json | undefined) => (typeof v === 'number' || typeof v === 'string' ? parseCentavos(String(v)) : null);

/** Interpreta el jsonb que devuelve crear_pedido(). Lanza si la forma no es la esperada. */
export function parseCreateOrderResult(raw: Json): CreateOrderResult {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Respuesta de crear_pedido inválida');
  const status = raw.status;
  if (status === 'created' || status === 'replayed') {
    const orderId = asString(raw.order_id);
    const code = asString(raw.code);
    const token = asString(raw.token);
    const expires = asString(raw.reservation_expires_at);
    const total = amount(raw.total_ars);
    if (!orderId || !code || !token || !expires || total === null) throw new Error('Respuesta de crear_pedido incompleta');
    return { status, orderId, code, token, totalCentavos: total, reservationExpiresAt: expires };
  }
  if (status === 'rejected') {
    const error = asString(raw.error);
    const detail = raw.detail && typeof raw.detail === 'object' && !Array.isArray(raw.detail) ? raw.detail : {};
    const fields = Array.isArray(detail.fields)
      ? detail.fields.filter((f): f is CheckoutField => typeof f === 'string' && (CHECKOUT_FIELDS as readonly string[]).includes(f))
      : [];
    const productIds = Array.isArray(detail.product_ids) ? detail.product_ids.filter((p): p is string => typeof p === 'string') : [];
    return {
      status,
      error: (REJECTION_CODES as readonly string[]).includes(error ?? '') ? (error as RejectionCode) : 'unknown',
      fields,
      productIds,
      currentTotalCentavos: error === 'total_mismatch' ? amount(detail.total_ars) : null,
    };
  }
  throw new Error('Respuesta de crear_pedido con estado desconocido');
}

const MESSAGES: Record<RejectionCode | 'unknown', string> = {
  checkout_disabled: 'Las compras online todavía no están habilitadas.',
  invalid_input: 'Revisá los datos marcados.',
  quantity_limit: 'Superaste la cantidad máxima de unidades por compra.',
  idempotency_conflict: 'El pedido cambió mientras se enviaba. Revisalo y confirmá de nuevo.',
  too_many_attempts: 'Hubo demasiados intentos. Esperá unos minutos y volvé a intentar.',
  too_many_orders: 'Hubo demasiados pedidos desde tu conexión. Esperá un rato y volvé a intentar.',
  too_many_pending_orders: 'Ya tenés pedidos esperando el pago. Completalos o esperá a que venzan.',
  product_unavailable: 'Algunos productos ya no están disponibles.',
  insufficient_stock: 'No hay stock suficiente de algunos productos.',
  no_shipping_coverage: 'Todavía no hacemos envíos a esa provincia.',
  total_mismatch: 'El total cambió (precio o envío actualizado). Revisá el nuevo total y confirmá.',
  internal_error: 'No pudimos crear el pedido. Intentá de nuevo en unos segundos.',
  unknown: 'No pudimos crear el pedido. Intentá de nuevo.',
};

export function describeRejection(error: RejectionCode | 'unknown'): string {
  return MESSAGES[error];
}
