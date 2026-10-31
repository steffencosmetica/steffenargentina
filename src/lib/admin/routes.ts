// Rutas del panel de administración. Sin dependencias de Next para poder probarlas con node --test.

export const LOGIN_PATH = '/admin/login';
export const HOME_PATH = '/admin/productos';

export type LoginReason = 'expirada' | 'sin-permiso' | 'salida';

// Pantallas del panel a las que se puede volver después del login. Cualquier otra ruta
// (el propio login, variantes como "/admin/login.", rutas inexistentes o fuera del panel) va al inicio.
const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const PANEL_ROUTES = [
  /^\/admin$/,
  /^\/admin\/productos$/,
  /^\/admin\/productos\/nuevo$/,
  new RegExp(`^/admin/productos/${UUID}$`),
  /^\/admin\/categorias$/,
  /^\/admin\/categorias\/nueva$/,
  new RegExp(`^/admin/categorias/${UUID}$`),
];

// Filtros del listado de productos que se conservan al volver; el resto de la query se descarta
const LIST_FILTERS = ['q', 'categoria', 'estado'];

/**
 * Destino seguro después del login: solo pantallas existentes del panel.
 * Evita redirecciones abiertas ("//otro-sitio.com", "https://…", "/admin/../afuera") y destinos
 * que no llevan a ningún lado ("/admin/login.", "/admin/xyz").
 */
export function safeNextPath(next: string | null | undefined): string {
  if (!next || next.length > 512 || !next.startsWith('/') || next.startsWith('//') || /[\\\s]/.test(next)) return HOME_PATH;
  let url: URL;
  try {
    url = new URL(next, 'http://panel.local');
  } catch {
    return HOME_PATH;
  }
  if (url.origin !== 'http://panel.local' || !PANEL_ROUTES.some((route) => route.test(url.pathname))) return HOME_PATH;

  if (url.pathname !== HOME_PATH) return url.pathname;
  const params = new URLSearchParams();
  for (const key of LIST_FILTERS) {
    const value = url.searchParams.get(key);
    if (value) params.set(key, value.slice(0, 80));
  }
  const query = params.toString();
  return query ? `${HOME_PATH}?${query}` : HOME_PATH;
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
