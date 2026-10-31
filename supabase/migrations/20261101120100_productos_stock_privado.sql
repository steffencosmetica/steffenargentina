-- Paso 2 de 2: solo los administradores pueden consultar el stock exacto.
-- Hasta ahora anon y authenticated tenían SELECT sobre toda la tabla products: la clave publicable
-- permitía leer la cantidad exacta por la API (select=stock, select=*, embebidos desde product_images
-- o categories, y filtros u orden como stock=gt.10), y lo mismo cualquier usuario logueado.
--
-- Ambos roles pasan a tener SELECT solo sobre una lista explícita de columnas, sin stock. Postgres
-- aplica los permisos por columna en cualquier consulta (REST, embebidos, filtros, orden), y las
-- columnas que se agreguen en el futuro no quedan visibles hasta otorgarlas a propósito.
--   - anon: lo que necesita el catálogo público.
--   - authenticated: todas las columnas salvo stock. Los administradores leen el stock exacto con
--     public.admin_product_stock() (paso 1), que verifica is_admin(). Los permisos de escritura no
--     cambian: el panel sigue editando el stock (y RLS sigue exigiendo is_admin()).
-- La regla stock >= 0 y las políticas RLS no cambian.
--
-- Requiere que el código desplegado ya no lea stock con SELECT (src/lib/catalog/queries.ts y
-- src/lib/catalog/admin-queries.ts usan availability y admin_product_stock()).

revoke select on public.products from anon, authenticated;

grant select (
  id, sku, name, slug,
  short_description, description, usage_instructions, benefits, presentation,
  category_id, price_ars,
  weight_grams, package_length_mm, package_width_mm, package_height_mm,
  is_featured, is_active, sort_order, availability, updated_at
) on public.products to anon;

grant select (
  id, sku, name, slug,
  short_description, description, usage_instructions, benefits, presentation,
  category_id, price_ars,
  weight_grams, package_length_mm, package_width_mm, package_height_mm,
  is_featured, is_active, sort_order, availability, created_at, updated_at
) on public.products to authenticated;
