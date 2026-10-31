// Lógica de la tienda pública que no depende de Next ni de Supabase: disponibilidad, filtros,
// orden, paginación y enlaces. Se usa en el servidor y se prueba con node --test.

import { WHATSAPP_NUMERO } from '../site.ts';
import type { Availability, Product } from './types.ts';

export type { Availability };

// ---------------------------------------------------------------------------
// Disponibilidad (nunca se muestra la cantidad exacta)
// ---------------------------------------------------------------------------

export const AVAILABILITY_LABEL: Record<Availability, string> = {
  disponible: 'Disponible',
  ultimas: 'Últimas unidades',
  'sin-stock': 'Sin stock',
};

// La calcula la base (columna generada products.availability: más de 3, de 1 a 3, 0); acá solo se valida.
export function isAvailability(value: unknown): value is Availability {
  return value === 'disponible' || value === 'ultimas' || value === 'sin-stock';
}

// ---------------------------------------------------------------------------
// Parámetros de la URL de /tienda
// ---------------------------------------------------------------------------

export const STORE_SORTS = ['destacados', 'nombre', 'precio-asc', 'precio-desc'] as const;
export type StoreSort = (typeof STORE_SORTS)[number];

export const SORT_LABEL: Record<StoreSort, string> = {
  destacados: 'Destacados',
  nombre: 'Nombre (A-Z)',
  'precio-asc': 'Precio: menor a mayor',
  'precio-desc': 'Precio: mayor a menor',
};

export const PAGE_SIZE = 24;
const MAX_SHOWN = 1000;

export type StoreQuery = { q: string; categoria: string; orden: StoreSort; mostrar: number };

type RawParams = Record<string, string | string[] | undefined>;

function first(value: string | string[] | undefined) {
  return (Array.isArray(value) ? value[0] : value) ?? '';
}

/** Lee y sanea los filtros de la URL. Cualquier valor inválido vuelve al predeterminado. */
export function parseStoreQuery(params: RawParams): StoreQuery {
  const q = first(params.q).replace(/\s+/g, ' ').trim().slice(0, 80);
  const categoria = first(params.categoria).trim();
  const orden = first(params.orden) as StoreSort;
  const mostrar = Number.parseInt(first(params.mostrar), 10);
  return {
    q,
    categoria: /^[a-z0-9]+(-[a-z0-9]+)*$/.test(categoria) ? categoria : '',
    orden: STORE_SORTS.includes(orden) ? orden : 'destacados',
    mostrar: Number.isFinite(mostrar) && mostrar > PAGE_SIZE ? Math.min(Math.ceil(mostrar / PAGE_SIZE) * PAGE_SIZE, MAX_SHOWN) : PAGE_SIZE,
  };
}

/** URL de /tienda con los filtros dados; omite los valores predeterminados para que quede limpia. */
export function storeHref(query: Partial<StoreQuery>): string {
  const params = new URLSearchParams();
  if (query.q) params.set('q', query.q);
  if (query.categoria) params.set('categoria', query.categoria);
  if (query.orden && query.orden !== 'destacados') params.set('orden', query.orden);
  if (query.mostrar && query.mostrar > PAGE_SIZE) params.set('mostrar', String(query.mostrar));
  const search = params.toString();
  return search ? `/tienda?${search}` : '/tienda';
}

// ---------------------------------------------------------------------------
// Búsqueda y orden
// ---------------------------------------------------------------------------

/** "Máscara  ÁRGAN" → "mascara argan": sin tildes ni mayúsculas, para comparar */
export function normalizeText(text: string) {
  return text.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
}

const collator = new Intl.Collator('es', { sensitivity: 'base', numeric: true });

function compareBy(sort: StoreSort): (a: Product, b: Product) => number {
  const byName = (a: Product, b: Product) => collator.compare(a.name, b.name);
  switch (sort) {
    case 'nombre':
      return byName;
    case 'precio-asc':
      return (a, b) => a.priceCentavos - b.priceCentavos || byName(a, b);
    case 'precio-desc':
      return (a, b) => b.priceCentavos - a.priceCentavos || byName(a, b);
    case 'destacados':
      return (a, b) => Number(b.isFeatured) - Number(a.isFeatured) || a.sortOrder - b.sortOrder || byName(a, b);
  }
}

/**
 * Ordena los productos: los que no tienen stock van siempre al final,
 * cualquiera sea el orden elegido; dentro de cada grupo se aplica ese orden.
 */
export function sortProducts(products: Product[], sort: StoreSort = 'destacados'): Product[] {
  const compare = compareBy(sort);
  return [...products].sort((a, b) => Number(a.availability === 'sin-stock') - Number(b.availability === 'sin-stock') || compare(a, b));
}

/** Busca por nombre o SKU (sin distinguir tildes ni mayúsculas), filtra por categoría y ordena. */
export function filterProducts(products: Product[], query: Pick<StoreQuery, 'q' | 'categoria' | 'orden'>): Product[] {
  const terms = normalizeText(query.q).split(' ').filter(Boolean);
  const filtered = products.filter((p) => {
    if (query.categoria && p.category.slug !== query.categoria) return false;
    if (!terms.length) return true;
    const haystack = `${normalizeText(p.name)} ${normalizeText(p.sku)}`;
    return terms.every((t) => haystack.includes(t));
  });
  return sortProducts(filtered, query.orden);
}

/** Hasta `limit` productos de la misma categoría, sin el actual; los que tienen stock primero. */
export function relatedProducts(products: Product[], current: Product, limit = 4): Product[] {
  return sortProducts(
    products.filter((p) => p.id !== current.id && p.category.id === current.category.id),
    'destacados',
  ).slice(0, limit);
}

// ---------------------------------------------------------------------------
// Consulta por WhatsApp
// ---------------------------------------------------------------------------

/** Enlace wa.me al WhatsApp comercial configurado en el sitio, con el producto en el mensaje. */
export function whatsappConsultUrl(productName: string) {
  const phone = WHATSAPP_NUMERO.replace(/\D/g, '');
  const text = `Hola, quisiera consultar por el producto ${productName} de Steffen.`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(text)}`;
}
