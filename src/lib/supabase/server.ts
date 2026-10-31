import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { Database } from './database.types';
import { SESSION_COOKIE_OPTIONS } from './cookies';
import { getSupabasePublicEnv } from './env';

// Cliente con la sesión del usuario (cookies), para Server Components, Server Actions y Route Handlers.
// Las consultas viajan con el JWT del usuario, así que las políticas RLS deciden qué puede hacer.
// Se crea uno nuevo en cada llamada: nunca se comparte un cliente entre requests.
export async function createSessionClient() {
  const { url, key } = getSupabasePublicEnv();
  const cookieStore = await cookies();
  return createServerClient<Database>(url, key, {
    cookieOptions: SESSION_COOKIE_OPTIONS,
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        // En Server Actions y Route Handlers las cookies se escriben normalmente (login, logout,
        // renovación). En un Server Component Next no permite escribirlas y cookies().set lanza un
        // error: ahí la sesión ya la renovó src/proxy.ts antes de renderizar, así que se ignora.
        // Las cabeceras anti-caché que manda @supabase/ssr no hacen falta acá: las respuestas del
        // panel son dinámicas y el proxy ya las agrega cuando renueva la sesión.
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // Server Component: ver comentario anterior
        }
      },
    },
  });
}
