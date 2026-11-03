// Persistencia del carrito en localStorage. Solo producto y cantidad, con versión de esquema.
// Lo guardado puede estar corrupto o manipulado: se valida todo al leer y nada de acá se usa como
// precio, stock o total.

import { MAX_CART_LINES, MAX_LINE_QUANTITY, type CartItem } from './types.ts';

export const CART_STORAGE_KEY = 'steffen-carrito-v1';
export const CART_SCHEMA_VERSION = 1;

type StoredCart = { version: typeof CART_SCHEMA_VERSION; items: { productId: string; quantity: number }[] };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/**
 * Normaliza una lista de artículos: ids uuid en minúscula, cantidades enteras positivas (acotadas a la
 * validación técnica), productos repetidos sumados en una sola línea y como máximo MAX_CART_LINES líneas.
 */
export function normalizeItems(items: unknown): CartItem[] {
  if (!Array.isArray(items)) return [];
  const merged = new Map<string, number>();
  for (const raw of items) {
    if (!raw || typeof raw !== 'object') continue;
    const { productId, quantity } = raw as Record<string, unknown>;
    if (typeof productId !== 'string') continue;
    const id = productId.trim().toLowerCase();
    if (!UUID_RE.test(id)) continue;
    if (typeof quantity !== 'number' || !Number.isInteger(quantity) || quantity < 1) continue;
    if (!merged.has(id) && merged.size >= MAX_CART_LINES) continue;
    merged.set(id, Math.min((merged.get(id) ?? 0) + quantity, MAX_LINE_QUANTITY));
  }
  return [...merged].map(([productId, quantity]) => ({ productId, quantity }));
}

/**
 * Lee el carrito guardado. Cualquier cosa inesperada (JSON inválido, otra versión, estructura distinta)
 * da un carrito vacío o solo con las líneas válidas: nunca rompe la página.
 * Una versión futura del esquema se migraría acá antes de normalizar.
 */
export function parseStoredCart(raw: string | null | undefined): CartItem[] {
  if (!raw || raw.length > 20_000) return [];
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
  const { version, items } = data as Record<string, unknown>;
  if (version !== CART_SCHEMA_VERSION) return [];
  return normalizeItems(items);
}

export function serializeCart(items: CartItem[]): string {
  const stored: StoredCart = {
    version: CART_SCHEMA_VERSION,
    items: normalizeItems(items).map(({ productId, quantity }) => ({ productId, quantity })),
  };
  return JSON.stringify(stored);
}
