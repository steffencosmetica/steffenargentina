// Formulario de zona de envío: lectura y validación, iguales en el navegador y en el servidor.
// La base vuelve a controlar lo mismo (CHECK y claves): esto solo da mensajes claros.

import { MAX_CENTAVOS, parsePesosInput } from '../money.ts';
import { isProvinceCode } from './regions.ts';

export type ZoneInput = {
  name: string;
  priceCentavos: number;
  freeFromCentavos: number | null;
  isActive: boolean;
  provinces: string[];
  /** confirmación para mover provincias que hoy están en otra zona */
  move: boolean;
};

export type ZoneErrors = Record<string, string>;

type FormLike = Pick<FormData, 'get' | 'getAll'>;

function text(form: FormLike, name: string) {
  const value = form.get(name);
  return typeof value === 'string' ? value : '';
}

export function zoneFromForm(form: FormLike): { input: ZoneInput; errors: ZoneErrors } {
  const errors: ZoneErrors = {};

  const priceText = text(form, 'price').trim();
  const price = parsePesosInput(priceText);
  if (priceText === '') errors.price = 'La tarifa es obligatoria (puede ser 0).';
  else if (price === null) errors.price = 'Escribí la tarifa como 5.000 o 5.000,50.';

  const freeEnabled = text(form, 'freeEnabled') === 'on';
  let freeFrom: number | null = null;
  if (freeEnabled) {
    const freeText = text(form, 'freeFrom').trim();
    freeFrom = parsePesosInput(freeText);
    if (freeText === '' || freeFrom === null) errors.freeFrom = 'Escribí desde qué importe el envío es gratis.';
  }

  const provinces = [...new Set(form.getAll('provinces').filter((v): v is string => typeof v === 'string'))].sort();

  return {
    input: {
      name: text(form, 'name').trim(),
      priceCentavos: price ?? 0,
      freeFromCentavos: freeFrom,
      isActive: text(form, 'isActive') === 'on',
      provinces,
      move: text(form, 'move') === '1',
    },
    errors,
  };
}

export function validateZoneInput(input: ZoneInput): ZoneErrors {
  const errors: ZoneErrors = {};
  if (!input.name) errors.name = 'El nombre es obligatorio.';
  else if (input.name.length > 80) errors.name = 'El nombre puede tener hasta 80 caracteres.';
  if (!Number.isSafeInteger(input.priceCentavos) || input.priceCentavos < 0 || input.priceCentavos > MAX_CENTAVOS) {
    errors.price = 'La tarifa debe ser un importe mayor o igual a cero.';
  }
  if (input.freeFromCentavos !== null) {
    if (!Number.isSafeInteger(input.freeFromCentavos) || input.freeFromCentavos <= 0 || input.freeFromCentavos > MAX_CENTAVOS) {
      errors.freeFrom = 'El envío gratis tiene que empezar desde un importe mayor a cero.';
    }
  }
  if (input.provinces.some((code) => !isProvinceCode(code))) errors.provinces = 'Hay provincias inválidas en la selección.';
  return errors;
}
