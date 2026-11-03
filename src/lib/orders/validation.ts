// Datos del checkout: las mismas reglas que private.normalizar_checkout() en la base, para dar
// mensajes claros antes de enviar. La base vuelve a validar todo y es la única fuente de verdad
// (precios, stock, envío y total los calcula ella). Los nombres de campo coinciden con los que
// devuelve crear_pedido() en detail.fields.

export type CheckoutBuyer = { name: string; email: string; phone: string; document?: string | null };
export type CheckoutShipping = {
  street: string;
  number: string;
  unit?: string | null;
  city: string;
  postal_code: string;
  province_code: string;
  notes?: string | null;
};
export type CheckoutItem = { product_id: string; quantity: number };

export type CheckoutInput = { buyer: CheckoutBuyer; shipping: CheckoutShipping; items: CheckoutItem[] };

export const CHECKOUT_FIELDS = [
  'buyer.name',
  'buyer.email',
  'buyer.phone',
  'buyer.document',
  'shipping.street',
  'shipping.number',
  'shipping.unit',
  'shipping.city',
  'shipping.postal_code',
  'shipping.province_code',
  'shipping.notes',
  'items',
  'items.duplicate',
  'idempotency_key',
  'expected_total',
] as const;
export type CheckoutField = (typeof CHECKOUT_FIELDS)[number];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_RE = /^[A-Za-z0-9_-]{32,128}$/;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/** Recorta y colapsa espacios internos, igual que la base. Vacío → null. */
export function cleanText(value: string | null | undefined): string | null {
  if (value == null) return null;
  const text = value.replace(/\s+/g, ' ').trim();
  return text === '' ? null : text;
}

/** Normaliza los datos como lo hará la base (útil para mostrar el resumen antes de confirmar). */
export function normalizeCheckout(input: CheckoutInput): CheckoutInput {
  const b = input.buyer;
  const s = input.shipping;
  const document = cleanText(b.document)?.replace(/[.\s-]/g, '') ?? null;
  return {
    buyer: {
      name: cleanText(b.name) ?? '',
      email: (cleanText(b.email) ?? '').toLowerCase(),
      phone: cleanText(b.phone) ?? '',
      // como en la base: "..." queda vacío y se rechaza (no se toma como "sin documento")
      document,
    },
    shipping: {
      street: cleanText(s.street) ?? '',
      number: (cleanText(s.number) ?? '').toUpperCase(),
      unit: cleanText(s.unit),
      city: cleanText(s.city) ?? '',
      postal_code: (cleanText(s.postal_code) ?? '').replace(/ /g, '').toUpperCase(),
      province_code: cleanText(s.province_code) ?? '',
      notes: cleanText(s.notes),
    },
    items: input.items,
  };
}

const len = (text: string) => [...text].length;
const textOk = (text: string, min: number, max: number) => len(text) >= min && len(text) <= max && !CONTROL_RE.test(text);

/**
 * Campos inválidos (vacío si todo está bien). Los límites de unidades por producto y por pedido son
 * configurables y los controla la base (quantity_limit); acá solo se exige un entero positivo.
 */
export function validateCheckout(input: CheckoutInput, provinceCodes: ReadonlySet<string>): CheckoutField[] {
  const { buyer, shipping, items } = normalizeCheckout(input);
  const errors: CheckoutField[] = [];

  if (!textOk(buyer.name, 2, 120)) errors.push('buyer.name');
  if (len(buyer.email) > 254 || !/^[^@\s\u0000-\u001f\u007f]+@[^@\s\u0000-\u001f\u007f]+\.[^@\s\u0000-\u001f\u007f]+$/.test(buyer.email)) {
    errors.push('buyer.email');
  }
  if (!/^\+?[0-9 ()-]{6,30}$/.test(buyer.phone) || buyer.phone.replace(/[^0-9]/g, '').length < 6) errors.push('buyer.phone');
  if (buyer.document != null && !/^[0-9]{7,11}$/.test(buyer.document)) errors.push('buyer.document');

  if (!textOk(shipping.street, 2, 120)) errors.push('shipping.street');
  if (!/^[0-9A-Z/ -]{1,10}$/.test(shipping.number)) errors.push('shipping.number');
  if (shipping.unit != null && !textOk(shipping.unit, 1, 30)) errors.push('shipping.unit');
  if (!textOk(shipping.city, 2, 80)) errors.push('shipping.city');
  if (!/^[A-Z]?[0-9]{4}[A-Z]{0,3}$/.test(shipping.postal_code)) errors.push('shipping.postal_code');
  if (!provinceCodes.has(shipping.province_code)) errors.push('shipping.province_code');
  if (shipping.notes != null && !textOk(shipping.notes, 1, 500)) errors.push('shipping.notes');

  if (!Array.isArray(items) || items.length < 1 || items.length > 50) {
    errors.push('items');
  } else {
    const seen = new Set<string>();
    for (const item of items) {
      if (!UUID_RE.test(item.product_id) || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 9999) {
        errors.push('items');
        break;
      }
      const id = item.product_id.toLowerCase();
      if (seen.has(id)) {
        errors.push('items.duplicate');
        break;
      }
      seen.add(id);
    }
  }
  return errors;
}

export function isIdempotencyKey(value: unknown): value is string {
  return typeof value === 'string' && IDEMPOTENCY_RE.test(value);
}

/**
 * Clave de idempotencia para un intento de compra. La genera el navegador una vez por checkout y la
 * reenvía igual en cada reintento (doble clic, red); cambia solo si cambia el contenido del pedido.
 */
export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
