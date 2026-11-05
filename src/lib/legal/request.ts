export type RevocationInput = { purchaseReference: string; email: string; idempotencyKey: string; website: string };

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function normalizeEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim().toLowerCase();
  return email.length <= 254 && EMAIL.test(email) ? email : null;
}

export function parseRevocation(value: unknown): RevocationInput | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.purchaseReference !== 'string' || typeof v.email !== 'string' || typeof v.idempotencyKey !== 'string' || v.website !== '') return null;
  const purchaseReference = v.purchaseReference.trim();
  const email = normalizeEmail(v.email);
  if (purchaseReference.length < 3 || purchaseReference.length > 100 || /[\u0000-\u001f\u007f]/.test(purchaseReference)) return null;
  if (!email) return null;
  if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(v.idempotencyKey)) return null;
  return { purchaseReference, email, idempotencyKey: v.idempotencyKey, website: '' };
}

/** Pedido de recuperación: solo el email (y el campo trampa vacío). */
export function parseRecoveryRequest(value: unknown): { email: string } | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const v = value as Record<string, unknown>;
  if (v.website !== '' || Object.keys(v).some((k) => k !== 'email' && k !== 'website')) return null;
  const email = normalizeEmail(v.email);
  return email ? { email } : null;
}

/** Token de recuperación: 32 bytes en base64url (43 caracteres). Distinto del token de pedidos. */
export function parseRecoveryToken(value: unknown): string | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const token = (value as Record<string, unknown>).token;
  return typeof token === 'string' && /^[A-Za-z0-9_-]{43}$/.test(token) ? token : null;
}
