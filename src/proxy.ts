import { NextResponse, type NextRequest } from 'next/server';
import { createServerClient } from '@supabase/ssr';
import type { Database } from '@/lib/supabase/database.types';
import { SESSION_COOKIE_OPTIONS } from '@/lib/supabase/cookies';
import { getSupabasePublicEnv } from '@/lib/supabase/env';
import { LOGIN_PATH, loginUrl } from '@/lib/admin/routes';

// Proxy del panel de administración (solo /admin, ver config.matcher).
// 1. Renueva la sesión de Supabase Auth: si el access token venció, lo cambia por uno nuevo con el
//    refresh token y escribe las cookies actualizadas en la request (para lo que se renderiza a
//    continuación) y en la respuesta (para el navegador).
// 2. Redirige al login a quien no tiene sesión o no es administrador. Es solo un primer filtro:
//    cada página y cada Server Action vuelve a verificar con requireAdmin(), y RLS con is_admin().
// El sitio institucional no pasa por acá.

export async function proxy(request: NextRequest) {
  const { url, key } = getSupabasePublicEnv();
  let response = NextResponse.next({ request });

  const supabase = createServerClient<Database>(url, key, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet, headers) {
        // la request lleva las cookies nuevas a los Server Components de este mismo render
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        // Cache-Control: private, no-store… para que ningún CDN guarde una respuesta con tokens
        Object.entries(headers).forEach(([name, value]) => response.headers.set(name, value));
      },
    },
  });

  // getClaims valida el JWT (y lo renueva si venció) antes de generar cualquier respuesta
  const { data } = await supabase.auth.getClaims();
  const claims = data?.claims;
  const path = request.nextUrl.pathname;
  const isLogin = path === LOGIN_PATH;

  let redirectTo: URL | null = null;
  if (!claims) {
    if (!isLogin) {
      // si llegó una cookie de sesión que ya no sirve, la sesión expiró (o se cerró en otro lado)
      const hadSession = request.cookies.getAll().some((c) => c.name.startsWith('sb-') && c.name.includes('-auth-token'));
      redirectTo = loginUrl(request.nextUrl, { next: path + request.nextUrl.search, reason: hadSession ? 'expirada' : undefined });
    }
  } else {
    const { data: isAdmin, error } = await supabase.rpc('is_admin');
    if (error || !isAdmin) {
      // sesión válida de un usuario que no es administrador: se cierra para que no quede a medias
      await supabase.auth.signOut({ scope: 'local' });
      redirectTo = loginUrl(request.nextUrl, { reason: 'sin-permiso' });
    } else if (isLogin) {
      redirectTo = new URL('/admin/productos', request.nextUrl);
    }
  }

  if (redirectTo) {
    // la redirección tiene que llevar las cookies que haya escrito Supabase (renovadas o borradas)
    const redirect = NextResponse.redirect(redirectTo);
    response.cookies.getAll().forEach((cookie) => redirect.cookies.set(cookie));
    for (const name of ['cache-control', 'expires', 'pragma']) {
      const value = response.headers.get(name);
      if (value) redirect.headers.set(name, value);
    }
    response = redirect;
  }

  response.headers.set('X-Robots-Tag', 'noindex, nofollow');
  return response;
}

export const config = {
  matcher: ['/admin', '/admin/:path*'],
};
