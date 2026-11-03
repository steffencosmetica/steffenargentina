// Seguimiento de un pedido: formato del código y del token, y la vista que se le devuelve al navegador.
// Puro. La vista se arma con una lista CERRADA de campos de public.consultar_pedido(): lo que la base
// agregue en el futuro no llega al navegador sin pasar por acá. Sin nombre, email, teléfono, documento,
// calle, localidad ni notas.

import { parseCentavos, type Centavos } from '../money.ts';

export const ORDER_CODE_RE = /^STF-[0-9]{4}-[2-9A-HJ-NP-Z]{4}$/;
export const ORDER_TOKEN_RE = /^[A-Za-z0-9_-]{43}$/;

export const isOrderCode = (v: unknown): v is string => typeof v === 'string' && ORDER_CODE_RE.test(v);
export const isOrderToken = (v: unknown): v is string => typeof v === 'string' && ORDER_TOKEN_RE.test(v);

/** Fragmento del enlace privado: /pedido/STF-…#t=<token>. El fragmento nunca viaja al servidor. */
export const TOKEN_FRAGMENT = 't';

export function tokenFromHash(hash: string): string | null {
  const params = new URLSearchParams(hash.replace(/^#/, ''));
  const token = params.get(TOKEN_FRAGMENT);
  return isOrderToken(token) ? token : null;
}

export type PaymentStatus = 'pending' | 'approved' | 'expired' | 'cancelled';
export type FulfillmentStatus = 'pending' | 'preparing' | 'shipped' | 'delivered';

export type OrderView = {
  code: string;
  createdAt: string;
  paymentStatus: PaymentStatus;
  fulfillmentStatus: FulfillmentStatus;
  needsAttention: boolean;
  /** solo mientras la reserva está vigente */
  reservationExpiresAt: string | null;
  province: string | null;
  items: { sku: string; name: string; quantity: number; unitPriceCentavos: Centavos; lineTotalCentavos: Centavos }[];
  subtotalCentavos: Centavos;
  shippingCentavos: Centavos;
  totalCentavos: Centavos;
  dispatch: { carrier: string | null; tracking: string | null; dispatchedAt: string | null; deliveredAt: string | null } | null;
};

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };
const isObj = (v: Json | undefined): v is { [key: string]: Json } => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: Json | undefined) => (typeof v === 'string' ? v : null);
// numeric llega como número JSON desde jsonb ("12550.5" → 12550.5): se lee su texto, sin aritmética de float
const money = (v: Json | undefined): Centavos => {
  if (typeof v !== 'number' && typeof v !== 'string') throw new Error('Importe ausente');
  return parseCentavos(String(v));
};

const PAYMENT: readonly PaymentStatus[] = ['pending', 'approved', 'expired', 'cancelled'];
const FULFILLMENT: readonly FulfillmentStatus[] = ['pending', 'preparing', 'shipped', 'delivered'];

/** Respuesta de consultar_pedido() → vista pública. null si la base devolvió null (código o token incorrectos). */
export function parseOrderLookup(raw: Json): OrderView | null {
  if (raw === null) return null;
  if (!isObj(raw)) throw new Error('Respuesta de consultar_pedido inválida');
  const code = str(raw.code);
  const createdAt = str(raw.created_at);
  const payment = str(raw.payment_status) as PaymentStatus | null;
  const fulfillment = str(raw.fulfillment_status) as FulfillmentStatus | null;
  if (!code || !createdAt || !payment || !PAYMENT.includes(payment) || !fulfillment || !FULFILLMENT.includes(fulfillment)) {
    throw new Error('Respuesta de consultar_pedido incompleta');
  }
  const items = Array.isArray(raw.items) ? raw.items : [];
  const destination = isObj(raw.destination) ? raw.destination : {};
  const dispatch = isObj(raw.dispatch) ? raw.dispatch : null;
  return {
    code,
    createdAt,
    paymentStatus: payment,
    fulfillmentStatus: fulfillment,
    needsAttention: raw.needs_attention === true,
    reservationExpiresAt: str(raw.reservation_expires_at),
    province: str(destination.province),
    items: items.filter(isObj).map((i) => ({
      sku: str(i.sku) ?? '',
      name: str(i.name) ?? '',
      quantity: typeof i.quantity === 'number' ? i.quantity : 0,
      unitPriceCentavos: money(i.unit_price_ars),
      lineTotalCentavos: money(i.line_total_ars),
    })),
    subtotalCentavos: money(raw.subtotal_ars),
    shippingCentavos: money(raw.shipping_ars),
    totalCentavos: money(raw.total_ars),
    dispatch: dispatch && {
      carrier: str(dispatch.carrier),
      tracking: str(dispatch.tracking),
      dispatchedAt: str(dispatch.dispatched_at),
      deliveredAt: str(dispatch.delivered_at),
    },
  };
}

export const PAYMENT_LABEL: Record<PaymentStatus, string> = {
  pending: 'Pendiente de pago',
  approved: 'Pagado',
  expired: 'Reserva vencida (sin pago)',
  cancelled: 'Cancelado',
};

export const FULFILLMENT_LABEL: Record<FulfillmentStatus, string> = {
  pending: 'Sin preparar',
  preparing: 'En preparación',
  shipped: 'Despachado',
  delivered: 'Entregado',
};
