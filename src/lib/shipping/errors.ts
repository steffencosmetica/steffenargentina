// Errores de la administración de envíos con mensajes para mostrar en el panel.

import type { ZoneErrors } from './validation';

export class ZoneValidationError extends Error {
  readonly errors: ZoneErrors;

  constructor(errors: ZoneErrors) {
    super('Datos de zona inválidos');
    this.name = 'ZoneValidationError';
    this.errors = errors;
  }
}

type DbError = { code?: string; message?: string };

/** Traduce los errores de la base al guardar una zona (sin exponer el mensaje técnico). */
export function describeZoneDbError(error: DbError): { message: string; field?: string } | null {
  const message = error.message ?? '';
  if (error.code === '23505' && message.includes('shipping_zones_name_key')) {
    return { field: 'name', message: 'Ya existe una zona con ese nombre.' };
  }
  if (error.code === '23505' && message.startsWith('Provincias asignadas a otra zona')) {
    return { field: 'provinces', message: 'Algunas provincias ya están en otra zona: confirmá si querés moverlas.' };
  }
  if (error.code === '22023') return { field: 'provinces', message: 'Hay provincias inválidas en la selección.' };
  if (error.code === '23514') return { message: 'La tarifa o el envío gratis no son válidos.' };
  if (error.code === 'P0002') return { message: 'La zona ya no existe.' };
  return null;
}
