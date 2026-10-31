-- Mínimo privilegio para las funciones del catálogo.
-- Supabase otorga EXECUTE a anon y authenticated de forma directa en cada función nueva del
-- esquema public (default privileges), así que el "revoke all ... from public" de
-- 20261029120000_catalogo_esquema.sql no alcanzaba para quitárselo.

-- set_updated_at: solo la invocan los triggers *_set_updated_at, y PostgreSQL no verifica
-- EXECUTE al disparar un trigger. Nadie necesita llamarla directamente.
revoke execute on function public.set_updated_at() from public, anon, authenticated;

-- set_primary_product_image: solo la usa el panel con una sesión de administrador
-- (rol authenticated). Un visitante no tiene motivo para llamarla.
revoke execute on function public.set_primary_product_image(uuid) from public, anon;

-- is_admin: se mantiene para anon y authenticated. La evalúan las políticas de lectura de
-- categories, products y product_images (que aplican a anon) y las de storage.objects;
-- sin EXECUTE, cualquier consulta pública al catálogo fallaría con "permission denied".
