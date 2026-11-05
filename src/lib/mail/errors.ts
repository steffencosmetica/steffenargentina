// Errores de envío clasificados. Nunca se guarda ni se registra una dirección de email ni el cuerpo de un mensaje.

export type MailFailureKind = 'temporal' | 'permanente';

export class MailSendError extends Error {
  readonly kind: MailFailureKind;
  readonly code: string;
  readonly detail: string;
  constructor(kind: MailFailureKind, code: string, detail = '') {
    super(`${kind}:${code}`);
    this.name = 'MailSendError';
    this.kind = kind;
    this.code = safeCode(code);
    this.detail = redact(detail);
  }
}

const EMAIL = /[^\s<>"'(),;:]+@[^\s<>"'(),;:]+/g;

/** Texto apto para registros: sin direcciones de email, sin caracteres de control y acotado. */
export function redact(text: unknown, max = 200): string {
  return String(text ?? '')
    .replace(EMAIL, '[email]')
    .replace(/[\u0000-\u001f\u007f]+/g, ' ')
    .trim()
    .slice(0, max);
}

export function safeCode(code: string): string {
  return code.toLowerCase().replace(/[^a-z0-9_]/g, '').slice(0, 60) || 'desconocido';
}

const TEMPORARY_NETWORK = new Set(['ECONNECTION', 'ETIMEDOUT', 'ESOCKET', 'EDNS', 'ECONNREFUSED', 'ECONNRESET', 'EPIPE', 'EHOSTUNREACH', 'ENOTFOUND', 'EAI_AGAIN', 'EPROTOCOL', 'ETLS']);

/**
 * Clasifica un error de nodemailer/SMTP.
 *  - 4xx, red, TLS o tiempo de espera: temporal (se reintenta con espera creciente).
 *  - 535/534/530 (autenticación) y 454: temporal, porque es un problema de configuración que afecta a TODOS
 *    los envíos; al agotar los intentos dispara alertas y el monitor externo lo detecta.
 *  - Otros 5xx o destinatario rechazado: permanente (en la práctica, un rebote sincrónico).
 */
export function classifySmtpError(error: unknown): MailSendError {
  if (error instanceof MailSendError) return error;
  const e = (error ?? {}) as { code?: unknown; responseCode?: unknown; message?: unknown; response?: unknown };
  const responseCode = typeof e.responseCode === 'number' ? e.responseCode : undefined;
  const code = typeof e.code === 'string' ? e.code : '';
  const detail = redact(typeof e.response === 'string' ? e.response : e.message);
  if (responseCode !== undefined) {
    if ([530, 534, 535].includes(responseCode)) return new MailSendError('temporal', `smtp_auth_${responseCode}`, detail);
    if (responseCode >= 400 && responseCode < 500) return new MailSendError('temporal', `smtp_${responseCode}`, detail);
    if (responseCode >= 500) return new MailSendError('permanente', `smtp_${responseCode}`, detail);
  }
  if (code === 'EAUTH') return new MailSendError('temporal', 'smtp_auth', detail);
  if (code === 'EENVELOPE') return new MailSendError('permanente', 'smtp_destinatario', detail);
  if (TEMPORARY_NETWORK.has(code)) return new MailSendError('temporal', `red_${code}`, detail);
  return new MailSendError('temporal', 'desconocido', detail);
}
