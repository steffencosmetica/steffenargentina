import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { CATALOGO_TAG, getSupabasePublicEnv } from './env';

// Cliente anónimo para leer el catálogo desde el servidor.
// No usa cookies ni sesión: lo que devuelve es lo mismo para cualquier visitante
// (solo lo activo, por RLS), así que sus respuestas se guardan en la Data Cache de Next.

/** Red de seguridad: aunque nadie invalide el tag, los datos se renuevan cada hora. */
export const CATALOGO_REVALIDATE = 3600;

// Cada consulta GET a PostgREST queda cacheada con el tag del catálogo. Las consultas con el mismo
// URL y cabeceras (misma clave publicable) comparten la entrada de caché entre visitantes.
const catalogFetch: typeof fetch = (input, init) =>
  fetch(input, { ...init, next: { revalidate: CATALOGO_REVALIDATE, tags: [CATALOGO_TAG] } });

export function createPublicClient() {
  const { url, key } = getSupabasePublicEnv();
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    global: { fetch: catalogFetch },
  });
}
