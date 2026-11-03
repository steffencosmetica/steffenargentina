import 'server-only';
import { headers } from 'next/headers';
import { isCartEnabled, quoteCart } from '@/lib/cart/server';
import type { CartItem } from '@/lib/cart/types';
import { centavosToDecimal } from '@/lib/money';
import { LOCAL_DEV_IP, trustedClientIp, trustedProxyFromEnv } from '@/lib/orders/client-ip';
import { parseCreateOrderResult, type CreateOrderResult } from '@/lib/orders/errors';
import { listProvinceCoverage, quoteShipping, type ProvinceCoverage } from '@/lib/shipping/quote';
import { createServiceClient, hasServiceKey } from '@/lib/supabase/admin';
import { parseOrderLookup, type OrderView } from './order-view';
import { toCheckoutInput, type CreateOrderRequest } from './request';
import type { CheckoutSummary, ShippingSummary } from './summary';

// Checkout del lado del servidor. Toda la lógica comercial vive en la base:
//   - resumen: public.cotizar_carrito (precios, estado, límites) + public.cotizar_envio (cobertura, tarifa)
//   - pedido:  public.crear_pedido (valida, bloquea, recalcula precios, envío y total, reserva el stock)
//   - estado:  public.consultar_pedido (código + token)
// Acá solo se arman las llamadas y se convierten los importes.

/**
 * ¿Están disponibles el checkout y el seguimiento? Mismas condiciones que el carrito (Supabase local y
 * fuera de Vercel, ver src/lib/cart/flag.ts) y además la clave de servidor. En Preview y Production: no
 * (las páginas y rutas responden 404). Comprar además exige store_settings.checkout_enabled en la base.
 */
export function isCheckoutAvailable(): boolean {
  return isCartEnabled() && hasServiceKey();
}

export async function listProvinces(): Promise<ProvinceCoverage[]> {
  return listProvinceCoverage();
}

export async function buildSummary(items: CartItem[], provinceCode: string | null): Promise<CheckoutSummary> {
  const quote = await quoteCart(items);
  let shipping: ShippingSummary = { status: 'pending' };
  if (provinceCode) {
    // sobre el subtotal de lo comprable, el mismo que calculará crear_pedido() si nada cambia
    const s = await quoteShipping(provinceCode, quote.subtotalCentavos);
    shipping = s.hasCoverage
      ? { status: 'ok', zoneName: s.zone.name, costCentavos: s.costCentavos, isFree: s.isFree, freeFromCentavos: s.freeFromCentavos }
      : { status: 'no_coverage' };
  }
  const totalCentavos = quote.canCheckout && quote.subtotalCentavos > 0 && shipping.status === 'ok' ? quote.subtotalCentavos + shipping.costCentavos : null;
  return { quote, shipping, totalCentavos };
}

/**
 * IP del comprador para el antiabuso de crear_pedido(): la del proxy de confianza (Vercel), o la fija de
 * desarrollo fuera de Vercel. Nunca un dato que mande el navegador.
 */
export async function clientIp(): Promise<string | null> {
  const proxy = trustedProxyFromEnv(process.env);
  if (proxy === 'none') return process.env.VERCEL ? null : LOCAL_DEV_IP;
  return trustedClientIp(await headers(), proxy);
}

/**
 * Control antiabuso previo a crear_pedido(): punto de enganche de Turnstile (pendiente de credenciales).
 * Fuera de Vercel (desarrollo y pruebas locales) no hay desafío. En cualquier despliegue falla CERRADO
 * hasta que se implemente la verificación con TURNSTILE_SECRET_KEY. Los límites por IP, por email y de
 * unidades los aplica la base en cada intento, con o sin este control.
 */
export function humanCheck(): boolean {
  return !process.env.VERCEL;
}

export async function createOrder(request: CreateOrderRequest, ip: string): Promise<CreateOrderResult> {
  const input = toCheckoutInput(request.form, request.items);
  const { data, error } = await createServiceClient().rpc('crear_pedido', {
    p_idempotency_key: request.idempotencyKey,
    p_buyer: input.buyer,
    p_shipping: input.shipping,
    p_items: input.items,
    // importe exacto como texto ("12550.50"): PostgreSQL lo convierte a numeric sin pasar por float
    p_expected_total_ars: centavosToDecimal(request.expectedTotalCentavos) as unknown as number,
    p_client_ip: ip,
  });
  if (error) throw error;
  return parseCreateOrderResult(data as never);
}

export async function lookupOrder(code: string, token: string): Promise<OrderView | null> {
  const { data, error } = await createServiceClient().rpc('consultar_pedido', { p_code: code, p_token: token });
  if (error) throw error;
  return parseOrderLookup(data as never);
}
