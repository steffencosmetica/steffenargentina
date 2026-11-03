// Checkout (Fase 4B.5): formulario, solicitudes a la API y huella para la idempotencia.
// Puro (sin dependencias del servidor ni del navegador) para compartirlo y probarlo. Las reglas de cada
// campo son las de src/lib/orders/validation.ts, que a su vez replica private.normalizar_checkout():
// acá no se agrega ninguna regla comercial. La base vuelve a validar todo al crear el pedido.

import { MAX_CART_LINES, MAX_LINE_QUANTITY, type CartItem } from '../cart/types.ts';
import { MAX_CENTAVOS, type Centavos } from '../money.ts';
import { cleanText, validateCheckout, type CheckoutField, type CheckoutInput } from '../orders/validation.ts';

/** Campos del formulario, en el orden en que se muestran (el resumen de errores los recorre así). */
export const FORM_FIELDS = [
  'firstName',
  'lastName',
  'email',
  'phone',
  'provinceCode',
  'city',
  'postalCode',
  'street',
  'number',
  'unit',
  'notes',
  'terms',
] as const;
export type FormField = (typeof FORM_FIELDS)[number];

export type CheckoutFormData = {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  provinceCode: string;
  city: string;
  postalCode: string;
  street: string;
  number: string;
  unit: string;
  notes: string;
};

export const EMPTY_FORM: CheckoutFormData = {
  firstName: '',
  lastName: '',
  email: '',
  phone: '',
  provinceCode: '',
  city: '',
  postalCode: '',
  street: '',
  number: '',
  unit: '',
  notes: '',
};

/** Cuerpo de POST /api/checkout/pedido. */
export type CreateOrderRequest = {
  idempotencyKey: string;
  form: CheckoutFormData;
  items: CartItem[];
  /** total que vio y aceptó el comprador; crear_pedido() lo compara con el vigente */
  expectedTotalCentavos: Centavos;
  acceptTerms: true;
};

/** Cuerpo de POST /api/checkout/resumen. */
export type SummaryRequest = { items: CartItem[]; provinceCode: string | null };

// Datos fiscales (Factura A, CUIT, condición frente al IVA…): pendientes de definir con el contador.
// La base ya acepta un documento opcional (buyer.document); el formulario no lo pide hasta confirmarlo.
export const BILLING_FIELDS_ENABLED = false;

// ---------------------------------------------------------------------------
// Validación
// ---------------------------------------------------------------------------

const NAME_PART_MAX = 60;
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f]/;

/** Nombre completo como lo guarda la base (buyer.name): «Nombre Apellido». */
export function fullName(form: Pick<CheckoutFormData, 'firstName' | 'lastName'>): string {
  return [cleanText(form.firstName), cleanText(form.lastName)].filter(Boolean).join(' ');
}

/** Datos con la forma que espera crear_pedido(). Sin documento: la facturación todavía no se pide. */
export function toCheckoutInput(form: CheckoutFormData, items: CartItem[]): CheckoutInput {
  return {
    buyer: { name: fullName(form), email: form.email, phone: form.phone, document: null },
    shipping: {
      street: form.street,
      number: form.number,
      unit: form.unit,
      city: form.city,
      postal_code: form.postalCode,
      province_code: form.provinceCode,
      notes: form.notes,
    },
    items: items.map((i) => ({ product_id: i.productId, quantity: i.quantity })),
  };
}

const DB_FIELD_TO_FORM: Partial<Record<CheckoutField, FormField[]>> = {
  'buyer.name': ['firstName', 'lastName'],
  'buyer.email': ['email'],
  'buyer.phone': ['phone'],
  'shipping.street': ['street'],
  'shipping.number': ['number'],
  'shipping.unit': ['unit'],
  'shipping.city': ['city'],
  'shipping.postal_code': ['postalCode'],
  'shipping.province_code': ['provinceCode'],
  'shipping.notes': ['notes'],
};

/** Campos de la base (crear_pedido → detail.fields) llevados a los del formulario. */
export function formFieldsFromDb(fields: readonly CheckoutField[]): FormField[] {
  const out = new Set<FormField>();
  for (const f of fields) for (const ff of DB_FIELD_TO_FORM[f] ?? []) out.add(ff);
  return FORM_FIELDS.filter((f) => out.has(f));
}

function namePartOk(value: string) {
  const text = cleanText(value) ?? '';
  return [...text].length >= 1 && [...text].length <= NAME_PART_MAX && !CONTROL_RE.test(text);
}

/**
 * Errores del formulario (vacío si está todo bien), en el orden de FORM_FIELDS. Los artículos se validan
 * aparte (vienen del carrito, no del formulario); acá solo los datos del comprador y la dirección.
 */
export function validateForm(form: CheckoutFormData, provinceCodes: ReadonlySet<string>, acceptTerms: boolean): FormField[] {
  const errors = new Set<FormField>(
    formFieldsFromDb(validateCheckout(toCheckoutInput(form, [{ productId: '00000000-0000-4000-8000-000000000000', quantity: 1 }]), provinceCodes)),
  );
  // nombre y apellido por separado (la base valida el nombre completo, de 2 a 120 caracteres)
  errors.delete('firstName');
  errors.delete('lastName');
  if (!namePartOk(form.firstName)) errors.add('firstName');
  if (!namePartOk(form.lastName)) errors.add('lastName');
  if (!acceptTerms) errors.add('terms');
  return FORM_FIELDS.filter((f) => errors.has(f));
}

export const FIELD_MESSAGES: Record<FormField, string> = {
  firstName: 'Ingresá tu nombre.',
  lastName: 'Ingresá tu apellido.',
  email: 'Ingresá un email válido, por ejemplo nombre@correo.com.',
  phone: 'Ingresá un teléfono con código de área (solo números, espacios, guiones o paréntesis).',
  provinceCode: 'Elegí la provincia de entrega.',
  city: 'Ingresá la localidad.',
  postalCode: 'Ingresá el código postal (4 números, por ejemplo 7600, o el formato B7600ABC).',
  street: 'Ingresá la calle.',
  number: 'Ingresá la altura (números o «S/N»).',
  unit: 'El piso o departamento puede tener hasta 30 caracteres.',
  notes: 'Las indicaciones pueden tener hasta 500 caracteres.',
  terms: 'Tenés que aceptar los términos y la política de privacidad para continuar.',
};

// ---------------------------------------------------------------------------
// Solicitudes (validación estricta en el servidor)
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const KEY_RE = /^[A-Za-z0-9_-]{32,128}$/;
const PROVINCE_RE = /^AR-[A-Z]$/;
const FORM_KEYS = Object.keys(EMPTY_FORM) as (keyof CheckoutFormData)[];
const MAX_FIELD = 600;

const isObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const exactKeys = (o: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(o).length === keys.length && Object.keys(o).every((k) => keys.includes(k));

function parseItems(raw: unknown): CartItem[] | null {
  if (!Array.isArray(raw) || raw.length < 1 || raw.length > MAX_CART_LINES) return null;
  const seen = new Set<string>();
  const items: CartItem[] = [];
  for (const entry of raw) {
    if (!isObject(entry) || !exactKeys(entry, ['productId', 'quantity'])) return null;
    const { productId, quantity } = entry;
    if (typeof productId !== 'string' || !UUID_RE.test(productId)) return null;
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1 || quantity > MAX_LINE_QUANTITY) return null;
    if (seen.has(productId)) return null;
    seen.add(productId);
    items.push({ productId, quantity });
  }
  return items;
}

function parseForm(raw: unknown): CheckoutFormData | null {
  if (!isObject(raw) || !exactKeys(raw, FORM_KEYS)) return null;
  const form = { ...EMPTY_FORM };
  for (const key of FORM_KEYS) {
    const value = raw[key];
    if (typeof value !== 'string' || value.length > MAX_FIELD) return null;
    form[key] = value;
  }
  return form;
}

/** POST /api/checkout/resumen: `{ items, provinceCode }`. null → 400. */
export function parseSummaryRequest(body: unknown): SummaryRequest | null {
  if (!isObject(body) || !exactKeys(body, ['items', 'provinceCode'])) return null;
  const items = parseItems(body.items);
  const { provinceCode } = body;
  if (!items) return null;
  if (provinceCode !== null && (typeof provinceCode !== 'string' || !PROVINCE_RE.test(provinceCode))) return null;
  return { items, provinceCode };
}

/**
 * POST /api/checkout/pedido. Forma estricta: claves desconocidas, tipos incorrectos o textos demasiado
 * largos → null (400). Los errores de contenido (email inválido…) los informa validateForm con detalle.
 */
export function parseCreateOrderRequest(body: unknown): CreateOrderRequest | null {
  if (!isObject(body) || !exactKeys(body, ['idempotencyKey', 'form', 'items', 'expectedTotalCentavos', 'acceptTerms'])) return null;
  const { idempotencyKey, expectedTotalCentavos, acceptTerms } = body;
  if (typeof idempotencyKey !== 'string' || !KEY_RE.test(idempotencyKey)) return null;
  if (acceptTerms !== true) return null;
  if (typeof expectedTotalCentavos !== 'number' || !Number.isSafeInteger(expectedTotalCentavos) || expectedTotalCentavos <= 0 || expectedTotalCentavos > MAX_CENTAVOS) {
    return null;
  }
  const form = parseForm(body.form);
  const items = parseItems(body.items);
  if (!form || !items) return null;
  return { idempotencyKey, form, items, expectedTotalCentavos, acceptTerms: true };
}

// ---------------------------------------------------------------------------
// Idempotencia
// ---------------------------------------------------------------------------

/**
 * Contenido de un intento de compra en forma canónica: misma compra ⇒ mismo texto. El navegador reusa la
 * clave mientras este texto no cambie (doble clic, recarga, reintento de red) y genera una nueva cuando
 * cambia (otro dato, otra cantidad o un total nuevo aceptado). La base rechaza una clave reutilizada con
 * otro contenido (idempotency_conflict).
 */
export function checkoutFingerprint(form: CheckoutFormData, items: CartItem[], expectedTotalCentavos: Centavos): string {
  const sorted = [...items].sort((a, b) => (a.productId < b.productId ? -1 : a.productId > b.productId ? 1 : 0));
  return JSON.stringify({
    v: 1,
    form: FORM_KEYS.map((k) => [k, cleanText(form[k]) ?? '']),
    items: sorted.map((i) => [i.productId, i.quantity]),
    total: expectedTotalCentavos,
  });
}

/** Clave de idempotencia: 32 bytes de un generador criptográfico (CSPRNG) en base64url (43 caracteres). */
export function newCheckoutKey(random: (bytes: Uint8Array) => Uint8Array = (b) => crypto.getRandomValues(b)): string {
  const bytes = random(new Uint8Array(32));
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
