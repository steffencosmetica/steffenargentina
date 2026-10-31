import { localSql } from './local';

// Deja la base LOCAL como estaba: sin catálogo, zonas de envío ni usuarios de prueba.
// Los tests pgTAP (npm run db:test) asumen un catálogo y una configuración de envíos vacíos.
// Los archivos subidos al bucket local quedan; se pueden borrar con «Limpiar imágenes sin uso».
export default async function globalTeardown() {
  localSql(`
do $$
begin
  delete from public.shipping_zone_provinces;
  delete from public.shipping_zones;
  delete from public.product_images;
  delete from public.products;
  delete from public.categories;
  delete from auth.users where email like '%@steffen.test';
end
$$`);
}
