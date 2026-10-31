// Resultado que devuelven los Server Actions del panel a los formularios (useActionState).
// Sin dependencias del servidor: lo importan también los componentes de cliente.

export type ActionState =
  | { status: 'idle' }
  | { status: 'ok'; message: string; warning?: string }
  | { status: 'error'; message: string; fieldErrors?: Record<string, string> };

export const IDLE: ActionState = { status: 'idle' };
