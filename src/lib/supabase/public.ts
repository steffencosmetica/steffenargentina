import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { getSupabasePublicEnv } from './env';

// Cliente anónimo para leer el catálogo desde el servidor.
// No usa cookies ni sesión: lo que devuelve es lo mismo para cualquier visitante
// (solo lo activo, por RLS), así que las páginas que lo usen se pueden cachear.
export function createPublicClient() {
  const { url, key } = getSupabasePublicEnv();
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
}
