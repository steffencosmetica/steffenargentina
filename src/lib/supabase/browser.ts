'use client';

import { createBrowserClient } from '@supabase/ssr';
import type { Database } from './database.types';
import { getSupabasePublicEnv } from './env';

// Cliente para el navegador. El panel lo usa solo para subir imágenes con URLs firmadas: la sesión
// vive en cookies httpOnly que este cliente no puede leer, así que actúa como visitante anónimo.
// Solo usa la clave publicable: no puede saltear las políticas RLS.
export function createBrowserSupabase() {
  const { url, key } = getSupabasePublicEnv();
  return createBrowserClient<Database>(url, key);
}
