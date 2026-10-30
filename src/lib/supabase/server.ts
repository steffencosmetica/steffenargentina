import 'server-only';
import { cookies } from 'next/headers';
import { createServerClient } from '@supabase/ssr';
import type { Database } from './database.types';
import { getSupabasePublicEnv } from './env';

// Cliente con la sesión del usuario (cookies), para Server Components, Server Actions y Route Handlers.
// Las consultas viajan con el JWT del usuario, así que las políticas RLS deciden qué puede hacer.
export async function createSessionClient() {
  const { url, key } = getSupabasePublicEnv();
  const cookieStore = await cookies();
  return createServerClient<Database>(url, key, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => cookieStore.set(name, value, options));
        } catch {
          // En un Server Component no se pueden escribir cookies; la sesión la renueva
          // el proxy/middleware de autenticación que se agregará con el panel de administración.
        }
      },
    },
  });
}
