// Rutas del panel de administración. Sin dependencias de Next para poder probarlas con node --test.

export const LOGIN_PATH = '/admin/login';
export const HOME_PATH = '/admin/productos';

export type LoginReason = 'expirada' | 'sin-permiso' | 'salida';

/**
 * Destino seguro después del login: solo rutas internas del panel.
 * Evita redirecciones abiertas ("//otro-sitio.com", "https://…", "/admin/../afuera").
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || !next.startsWith('/admin') || next.startsWith('//') || next.includes('\\')) return HOME_PATH;
  let url: URL;
  try {
    url = new URL(next, 'http://panel.local');
  } catch {
    return HOME_PATH;
  }
  if (url.origin !== 'http://panel.local' || !/^\/admin(\/|$)/.test(url.pathname) || url.pathname === LOGIN_PATH) {
    return HOME_PATH;
  }
  return url.pathname + url.search;
}

export function loginUrl(base: URL | string, opts: { next?: string; reason?: LoginReason } = {}) {
  const url = new URL(LOGIN_PATH, base);
  if (opts.next && safeNextPath(opts.next) !== HOME_PATH) url.searchParams.set('next', safeNextPath(opts.next));
  if (opts.reason) url.searchParams.set('motivo', opts.reason);
  return url;
}

/** Igual que loginUrl pero como ruta relativa ("/admin/login?motivo=…"), para redirect(). */
export function loginPath(opts: { next?: string; reason?: LoginReason } = {}) {
  const url = loginUrl('http://panel.local', opts);
  return url.pathname + url.search;
}
