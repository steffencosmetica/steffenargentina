// Estado del checkout en el navegador (sessionStorage, por pestaña):
//   - la clave de idempotencia del intento actual, asociada al sha256 de su contenido (nunca los datos);
//   - el token de cada pedido creado en esta pestaña, para ver su estado sin ponerlo en la URL.
// Si sessionStorage no está disponible se usa memoria: dentro de la visita, la protección es la misma.

import { newCheckoutKey } from './request.ts';

const ATTEMPT_KEY = 'steffen-checkout-intento-v1';
const ORDER_PREFIX = 'steffen-pedido-v1:';
const memory = new Map<string, string>();

function read(key: string): string | null {
  try {
    return window.sessionStorage.getItem(key) ?? memory.get(key) ?? null;
  } catch {
    return memory.get(key) ?? null;
  }
}

function write(key: string, value: string) {
  memory.set(key, value);
  try {
    window.sessionStorage.setItem(key, value);
  } catch {
    // modo privado estricto: queda en memoria
  }
}

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Clave de idempotencia para este contenido. La misma mientras el contenido no cambie (doble clic, recarga
 * de la página, reintento de red): si el pedido ya se creó, la base devuelve el mismo. Contenido nuevo
 * (otro dato, otra cantidad, un total nuevo aceptado) → clave nueva.
 */
export async function idempotencyKeyFor(fingerprint: string): Promise<string> {
  const hash = await sha256(fingerprint);
  try {
    const stored = JSON.parse(read(ATTEMPT_KEY) ?? 'null') as { hash?: unknown; key?: unknown } | null;
    if (stored && stored.hash === hash && typeof stored.key === 'string') return stored.key;
  } catch {
    // valor corrupto: se reemplaza
  }
  const key = newCheckoutKey();
  write(ATTEMPT_KEY, JSON.stringify({ hash, key }));
  return key;
}

/** Descarta la clave actual (solo ante idempotency_conflict: la próxima confirmación usa una nueva). */
export function forgetIdempotencyKey() {
  memory.delete(ATTEMPT_KEY);
  try {
    window.sessionStorage.removeItem(ATTEMPT_KEY);
  } catch {
    // sin sessionStorage
  }
}

export function rememberOrderToken(code: string, token: string) {
  write(ORDER_PREFIX + code, token);
}

export function orderTokenFor(code: string): string | null {
  return read(ORDER_PREFIX + code);
}
