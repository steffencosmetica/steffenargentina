'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './database.types';
import { getSupabasePublicEnv } from './env';

// Cliente para el navegador (por ejemplo, el formulario de login del futuro panel).
// Solo usa la clave publicable: no puede saltear las políticas RLS.
export function createBrowserSupabase() {
  const { url, key } = getSupabasePublicEnv();
  return createBrowserClient<Database>(url, key);
}
