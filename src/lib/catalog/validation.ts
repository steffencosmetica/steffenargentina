// Validación de los datos que cargan los administradores, antes de enviarlos a la base.
// La base vuelve a controlar lo mismo con restricciones CHECK: esto solo da mensajes claros.

import { MAX_CENTAVOS } from '../money.ts';
import type { CategoryInput, ProductInput } from './types.ts';

export type ValidationErrors = Record<string, string>;

export class ValidationError extends Error {
  readonly errors: ValidationErrors;

  constructor(errors: ValidationErrors) {
    super('Datos inválidos: ' + Object.values(errors).join(' '));
    this.name = 'ValidationError';
    this.errors = errors;
  }
}

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_INT = 2_147_483_647; // integer de PostgreSQL

export function isValidSlug(slug: string) {
  return SLUG_RE.test(slug);
}

/** "Shampoo Extra Ácido 500 ml" → "shampoo-extra-acido-500-ml" */
export function slugify(text: string) {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Ruta dentro del bucket: relativa, sin ".." ni barra inicial */
export function isValidStoragePath(path: string) {
  return path.trim() !== '' && !path.startsWith('/') && !/(^|\/)\.\.(\/|$)/.test(path);
}

function requireText(errors: ValidationErrors, field: string, value: string | undefined, label: string) {
  if (!value || value.trim() === '') errors[field] = `${label} es obligatorio.`;
}

function checkMaxLength(errors: ValidationErrors, field: string, value: string | null | undefined, max: number, label: string) {
  if (value && value.trim().length > max) errors[field] = `${label} puede tener hasta ${max} caracteres.`;
}

function checkInt(errors: ValidationErrors, field: string, value: number | null | undefined, opts: { min: number; label: string }) {
  if (value === null || value === undefined) return;
  if (!Number.isInteger(value) || value < opts.min || value > MAX_INT) {
    errors[field] = `${opts.label} debe ser un número entero mayor o igual a ${opts.min}.`;
  }
}

export function validateCategoryInput(input: CategoryInput): ValidationErrors {
  const errors: ValidationErrors = {};
  requireText(errors, 'name', input.name, 'El nombre');
  if (!isValidSlug(input.slug)) errors.slug = 'El slug solo puede tener minúsculas, números y guiones.';
  if (input.imagePath && !isValidStoragePath(input.imagePath)) errors.imagePath = 'La ruta de la imagen no es válida.';
  checkInt(errors, 'sortOrder', input.sortOrder, { min: -MAX_INT, label: 'El orden' });
  return errors;
}

export function validateProductInput(input: ProductInput): ValidationErrors {
  const errors: ValidationErrors = {};
  requireText(errors, 'sku', input.sku, 'El SKU');
  if (input.sku && input.sku !== input.sku.trim()) errors.sku = 'El SKU no puede empezar ni terminar con espacios.';
  requireText(errors, 'name', input.name, 'El nombre');
  if (!isValidSlug(input.slug)) errors.slug = 'El slug solo puede tener minúsculas, números y guiones.';
  if (!UUID_RE.test(input.categoryId)) errors.categoryId = 'Elegí una categoría.';
  if (!Number.isSafeInteger(input.priceCentavos) || input.priceCentavos < 0 || input.priceCentavos > MAX_CENTAVOS) {
    errors.priceCentavos = 'El precio debe ser un importe válido mayor o igual a cero.';
  }
  if (input.stock === undefined || input.stock === null) errors.stock = 'El stock es obligatorio.';
  else checkInt(errors, 'stock', input.stock, { min: 0, label: 'El stock' });
  checkMaxLength(errors, 'benefits', input.benefits, 2000, 'Los beneficios');
  checkMaxLength(errors, 'presentation', input.presentation, 300, 'La presentación');
  checkInt(errors, 'weightGrams', input.weightGrams, { min: 1, label: 'El peso' });
  checkInt(errors, 'packageLengthMm', input.packageLengthMm, { min: 1, label: 'El largo' });
  checkInt(errors, 'packageWidthMm', input.packageWidthMm, { min: 1, label: 'El ancho' });
  checkInt(errors, 'packageHeightMm', input.packageHeightMm, { min: 1, label: 'El alto' });
  checkInt(errors, 'sortOrder', input.sortOrder, { min: -MAX_INT, label: 'El orden' });
  return errors;
}

export function assertValid(errors: ValidationErrors) {
  if (Object.keys(errors).length) throw new ValidationError(errors);
}
