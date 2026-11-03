// Resultado que devuelven los Server Actions del panel a los formularios (useActionState).
// Sin dependencias del servidor: lo importan también los componentes de cliente.

export type ActionState =
  | { status: 'idle' }
  | { status: 'ok'; message: string; warning?: string }
  | {
      status: 'error';
      message: string;
      fieldErrors?: Record<string, string>;
      /** el stock cambió desde que se leyó: valor y versión actuales para recargar el campo */
      stockConflict?: StockSnapshot;
    };

export type StockSnapshot = { stock: number; version: number };

export const IDLE: ActionState = { status: 'idle' };

/**
 * Stock que muestra un formulario: el leído al renderizar la página o, si un intento de guardar dio
 * conflicto, el valor actual que informó la base (el de versión más nueva). Así el campo se recarga solo
 * y el administrador decide el valor sobre datos actuales antes de volver a guardar.
 */
export function currentStock(read: StockSnapshot, state: ActionState): StockSnapshot {
  const conflict = state.status === 'error' ? state.stockConflict : undefined;
  return conflict && conflict.version > read.version ? conflict : read;
}
