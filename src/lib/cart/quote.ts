// Cotización del carrito: validación de la solicitud y lectura de la respuesta de public.cotizar_carrito.
// Puro (sin dependencias del servidor) para poder probarlo y compartir los tipos con el navegador.

import { parseCentavos } from '../money.ts';
import { MAX_CART_LINES, MAX_LINE_QUANTITY, type CartItem, type CartQuote, type QuoteLine, type QuoteLineStatus } from './types.ts';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STATUSES: readonly QuoteLineStatus[] = ['ok', 'unavailable', 'out_of_stock', 'exceeds_limit', 'exceeds_stock'];

/**
 * Valida el cuerpo de POST /api/carrito/cotizar: `{ items: [{ productId, quantity }] }`.
 * Estricto: claves desconocidas, ids no uuid, cantidades no enteras o repetidos → null (400).
 */
export function parseQuoteRequest(body: unknown): CartItem[] | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null;
  const keys = Object.keys(body);
  if (keys.length !== 1 || keys[0] !== 'items') return null;
  const items = (body as { items: unknown }).items;
  if (!Array.isArray(items) || items.length > MAX_CART_LINES) return null;
  const seen = new Set<string>();
  const parsed: CartItem[] = [];
  for (const raw of items) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
    const entry = raw as Record<string, unknown>;
    if (Object.keys(entry).some((k) => k !== 'productId' && k !== 'quantity')) return null;
    const { productId, quantity } = entry;
    if (typeof productId !== 'string' || !UUID_RE.test(productId.toLowerCase())) return null;
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LINE_QUANTITY) return null;
    const id = productId.toLowerCase();
    if (seen.has(id)) return null;
    seen.add(id);
    parsed.push({ productId: id, quantity });
  }
  return parsed;
}

type Json = string | number | boolean | null | Json[] | { [key: string]: Json };

const str = (v: Json | undefined) => (typeof v === 'string' ? v : null);
const int = (v: Json | undefined) => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null);
const amount = (v: Json | undefined) => (typeof v === 'string' ? parseCentavos(v) : null);

/**
 * Convierte la respuesta de cotizar_carrito en el modelo de la app. `imageUrl` arma la URL pública de una
 * ruta del bucket. Lanza si la forma no es la esperada (nunca se muestra una cotización a medias).
 */
export function parseQuoteResponse(raw: Json, imageUrl: (path: string) => string): CartQuote {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('Cotización inválida');
  const limits = raw.limits;
  if (!limits || typeof limits !== 'object' || Array.isArray(limits)) throw new Error('Cotización sin límites');
  const perProduct = int(limits.max_units_per_product);
  const perOrder = int(limits.max_units_per_order);
  if (!perProduct || !perOrder) throw new Error('Límites inválidos');
  if (!Array.isArray(raw.items)) throw new Error('Cotización sin artículos');

  const lines: QuoteLine[] = raw.items.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Artículo inválido');
    const status = str(item.status) as QuoteLineStatus | null;
    const productId = str(item.product_id);
    const quantity = int(item.quantity);
    const maxQuantity = int(item.max_quantity);
    if (!status || !STATUSES.includes(status) || !productId || !quantity || maxQuantity === null) throw new Error('Artículo inválido');
    const imagePath = str(item.image_path);
    return {
      productId,
      status,
      quantity,
      name: str(item.name),
      slug: str(item.slug),
      priceCentavos: amount(item.price_ars),
      imageUrl: imagePath ? imageUrl(imagePath) : null,
      maxQuantity,
      lineTotalCentavos: amount(item.line_total_ars),
    };
  });

  const subtotal = amount(raw.subtotal_ars);
  const units = int(raw.units);
  if (subtotal === null || units === null) throw new Error('Totales inválidos');
  return {
    checkoutEnabled: raw.checkout_enabled === true,
    limits: { maxUnitsPerProduct: perProduct, maxUnitsPerOrder: perOrder },
    lines,
    units,
    subtotalCentavos: subtotal,
    exceedsOrderLimit: raw.exceeds_order_limit === true,
    canCheckout: raw.can_checkout === true,
  };
}
