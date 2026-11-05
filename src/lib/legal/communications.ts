// Modelo de las comunicaciones del arrepentimiento para el panel (sin dependencias de servidor).

export type MessageRow = {
  id: string;
  request_id: string | null;
  kind: string;
  recipient: string;
  status: string;
  attempts: number;
  max_attempts: number;
  next_attempt_at: string;
  last_attempt_at: string | null;
  last_error_code: string | null;
  last_error: string | null;
  accepted_at: string | null;
  related_message_id: string | null;
  version: number;
  created_at: string;
};

export type AdminAction = 'reintento_manual' | 'rebote_manual' | 'resuelto_manual';

export const KIND_LABEL: Record<string, string> = { constancia: 'Constancia por email', recuperacion: 'Enlace de recuperación', alerta: 'Alerta interna' };

export const STATUS_LABEL: Record<string, string> = {
  pendiente: 'Pendiente',
  enviando: 'Enviando',
  // Nunca «entregado»: Zoho aceptó el mensaje, no hay confirmación de entrega ni de lectura.
  aceptado: 'Aceptado por el servidor de correo',
  fallido: 'Fallido',
  rebotado: 'Rebotado',
  resuelto_manual: 'Resuelto por otro canal',
  vencido: 'Vencido',
};

export const ACTION_LABEL: Record<AdminAction, string> = {
  reintento_manual: 'Reintentar envío',
  rebote_manual: 'Registrar rebote',
  resuelto_manual: 'Marcar resuelto por otro canal',
};

export const REQUEST_STATUS_LABEL: Record<string, string> = { recibida: 'Recibida', en_gestion: 'En gestión', cerrada: 'Cerrada' };

const DELAY_MINUTES = 10;

export type Attention = 'fallido' | 'rebotado' | 'demorado' | null;

/** Por qué una comunicación necesita intervención humana (null: no necesita). */
export function attentionReason(m: Pick<MessageRow, 'status' | 'next_attempt_at' | 'last_attempt_at' | 'kind'>, now: Date): Attention {
  if (m.status === 'fallido') return m.kind === 'recuperacion' ? null : 'fallido';
  if (m.status === 'rebotado') return 'rebotado';
  const limit = now.getTime() - DELAY_MINUTES * 60_000;
  if (m.status === 'pendiente' && Date.parse(m.next_attempt_at) < limit) return 'demorado';
  if (m.status === 'enviando' && m.last_attempt_at && Date.parse(m.last_attempt_at) < limit) return 'demorado';
  return null;
}

/** Acciones que la base permite (admin_intervenir_comunicacion valida lo mismo). */
export function allowedActions(m: Pick<MessageRow, 'status' | 'kind'>): AdminAction[] {
  const actions: AdminAction[] = [];
  if (m.kind !== 'recuperacion' && ['fallido', 'rebotado', 'aceptado', 'resuelto_manual'].includes(m.status)) actions.push('reintento_manual');
  if (m.status === 'aceptado') actions.push('rebote_manual');
  if (['fallido', 'rebotado', 'pendiente'].includes(m.status)) actions.push('resuelto_manual');
  return actions;
}

export function isAdminAction(value: unknown): value is AdminAction {
  return value === 'reintento_manual' || value === 'rebote_manual' || value === 'resuelto_manual';
}

/** Nota opcional (obligatoria para «resuelto»): sin caracteres de control, acotada. */
export function cleanNote(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const note = value.trim();
  if (note.length > 500 || /[\u0000-\u0008\u000b-\u001f\u007f]/.test(note)) return null;
  return note;
}
