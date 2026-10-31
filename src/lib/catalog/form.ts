// Convierte los formularios del panel en los datos que validan validation.ts y guarda admin.ts.
// Lo usan el navegador (validación inmediata) y los Server Actions (validación definitiva),
// así que no depende de nada del servidor.

import { parsePesosInput } from '../money.ts';
import type { CategoryInput, ProductInput } from './types.ts';
import type { ValidationErrors } from './validation.ts';

type FormLike = Pick<FormData, 'get'>;

function text(form: FormLike, name: string) {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

function optionalText(form: FormLike, name: string) {
  const value = text(form, name).trim();
  return value === '' ? null : value;
}

// Número entero escrito por una persona ("1.500" se acepta como 1500). NaN si no es un entero.
function parseInteger(value: string) {
  const clean = value.trim().replace(/\.(?=\d{3}(\D|$))/g, '');
  return /^-?\d+$/.test(clean) ? Number(clean) : Number.NaN;
}

function optionalInt(form: FormLike, name: string) {
  const value = text(form, name).trim();
  return value === '' ? null : parseInteger(value);
}

function checkbox(form: FormLike, name: string) {
  const value = form.get(name);
  return value === 'on' || value === 'true' || value === '1';
}

export type ParsedForm<T> = { input: T; errors: ValidationErrors };

export function productFromForm(form: FormLike): ParsedForm<ProductInput> {
  const errors: ValidationErrors = {};
  const priceText = text(form, 'price').trim();
  const price = parsePesosInput(priceText);
  if (priceText === '') errors.priceCentavos = 'El precio es obligatorio.';
  else if (price === null) errors.priceCentavos = 'Escribí el precio como 12.500 o 12.500,50.';

  const stockText = text(form, 'stock').trim();
  const stock = stockText === '' ? Number.NaN : parseInteger(stockText);
  if (stockText === '') errors.stock = 'El stock es obligatorio.';

  const input: ProductInput = {
    sku: text(form, 'sku').trim(),
    name: text(form, 'name'),
    slug: text(form, 'slug').trim(),
    shortDescription: optionalText(form, 'shortDescription'),
    description: optionalText(form, 'description'),
    usageInstructions: optionalText(form, 'usageInstructions'),
    categoryId: text(form, 'categoryId'),
    priceCentavos: price ?? 0,
    stock,
    weightGrams: optionalInt(form, 'weightGrams'),
    packageLengthMm: optionalInt(form, 'packageLengthMm'),
    packageWidthMm: optionalInt(form, 'packageWidthMm'),
    packageHeightMm: optionalInt(form, 'packageHeightMm'),
    isFeatured: checkbox(form, 'isFeatured'),
    isActive: checkbox(form, 'isActive'),
    sortOrder: optionalInt(form, 'sortOrder') ?? 0,
  };
  return { input, errors };
}

export function categoryFromForm(form: FormLike): ParsedForm<CategoryInput> {
  return {
    input: {
      name: text(form, 'name'),
      slug: text(form, 'slug').trim(),
      description: optionalText(form, 'description'),
      isActive: checkbox(form, 'isActive'),
    },
    errors: {},
  };
}

/** Precio rápido del listado: devuelve centavos o un mensaje de error. */
export function quickPriceFromForm(form: FormLike): { centavos: number } | { error: string } {
  const centavos = parsePesosInput(text(form, 'price'));
  return centavos === null ? { error: 'Precio inválido. Escribilo como 12.500 o 12.500,50.' } : { centavos };
}

/** Stock rápido del listado. */
export function quickStockFromForm(form: FormLike): { stock: number } | { error: string } {
  const stock = parseInteger(text(form, 'stock'));
  return Number.isInteger(stock) && stock >= 0 && stock <= 2_147_483_647
    ? { stock }
    : { error: 'El stock debe ser un número entero mayor o igual a cero.' };
}
