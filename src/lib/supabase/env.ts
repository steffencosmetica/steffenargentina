// Configuración pública de Supabase (URL del proyecto y clave publicable).
// Ninguna de las dos es secreta: el acceso real lo controlan las políticas RLS de la base.
// Next las incrusta en el build por ser NEXT_PUBLIC_; en Docker se pasan como build args.
// Se leen recién al crear un cliente para que el sitio institucional compile sin Supabase configurado.

export function getSupabasePublicEnv() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new Error(
      'Falta configurar Supabase: definí NEXT_PUBLIC_SUPABASE_URL y NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY (ver .env.example).',
    );
  }
  return { url, key };
}

export function isSupabaseConfigured() {
  return Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY);
}

// Bucket público con las imágenes del catálogo (ver supabase/migrations/*_catalogo_storage.sql)
export const CATALOGO_BUCKET = 'catalogo';

// Tag de caché del catálogo público (src/lib/supabase/public.ts). El panel lo invalida con
// updateTag() después de cada cambio, así la tienda muestra los datos nuevos en la próxima visita.
export const CATALOGO_TAG = 'catalogo';
