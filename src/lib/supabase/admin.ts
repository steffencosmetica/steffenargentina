import 'server-only';
import { createClient } from '@supabase/supabase-js';
import type { Database } from './database.types';
import { getSupabasePublicEnv } from './env';

// Cliente con la clave SECRETA de Supabase (rol service_role), solo para el servidor de Next.
// Se usa para las funciones reservadas al servidor: crear_pedido(), consultar_pedido() y
// registrar_arrepentimiento(). Aun con esta clave la base no deja escribir
// tablas de pedidos, ejecutar funciones privadas (pagos), habilitar el checkout ni cambiar stock sin versión.
//
// SUPABASE_SECRET_KEY: variable de servidor, NUNCA con prefijo NEXT_PUBLIC_ (la auditoría
// src/lib/orders/secrets.audit.test.ts lo impide) ni importada desde un componente de cliente
// ('server-only' rompe el build si pasa).

export function hasServiceKey(): boolean {
  return Boolean(process.env.SUPABASE_SECRET_KEY);
}

export function createServiceClient() {
  const key = process.env.SUPABASE_SECRET_KEY;
  if (!key) throw new Error('Falta SUPABASE_SECRET_KEY (clave secreta de servidor).');
  const { url } = getSupabasePublicEnv();
  return createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
    // nada de caché de Next: pedidos y consultas siempre van a la base
    global: { fetch: (input, init) => fetch(input, { ...init, cache: 'no-store' }) },
  });
}
