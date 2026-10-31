import 'server-only';
import { redirect, unstable_rethrow } from 'next/navigation';
import { AdminActionError, AdminAuthError } from '@/lib/catalog/admin';
import { describeDbError, type DbErrorLike } from '@/lib/catalog/errors';
import { ValidationError } from '@/lib/catalog/validation';
import type { ActionState } from './action-state';
import { loginPath } from './routes';

/**
 * Convierte cualquier error de una operación del panel en un ActionState para el formulario.
 * Si la sesión ya no es de administrador, redirige al login.
 * Los errores inesperados se registran en el servidor y se muestran con un mensaje genérico.
 */
export function toActionError(error: unknown): ActionState {
  // redirect() / notFound() de Next se propagan: no son errores
  unstable_rethrow(error);

  if (error instanceof AdminAuthError) {
    redirect(loginPath({ reason: error.message.includes('permisos') ? 'sin-permiso' : 'expirada' }));
  }
  if (error instanceof ValidationError) {
    return { status: 'error', message: 'Revisá los campos marcados.', fieldErrors: error.errors };
  }
  if (error instanceof AdminActionError || error instanceof RangeError) {
    return { status: 'error', message: error.message };
  }
  if (isDbError(error)) {
    const friendly = describeDbError(error);
    if (error.code === '42501' || error.code === 'PGRST301') console.warn('Operación rechazada por permisos', error.code);
    else if (!['23505', '23503', '23514'].includes(error.code ?? '')) console.error('Error de base de datos en el panel', error);
    return {
      status: 'error',
      message: friendly.message,
      fieldErrors: friendly.field ? { [friendly.field]: friendly.message } : undefined,
    };
  }
  console.error('Error inesperado en el panel', error);
  return { status: 'error', message: 'No se pudo completar la operación. Intentá de nuevo.' };
}

function isDbError(error: unknown): error is DbErrorLike {
  return typeof error === 'object' && error !== null && 'code' in error && typeof (error as DbErrorLike).code === 'string';
}
