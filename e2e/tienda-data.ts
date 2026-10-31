import { join } from 'node:path';
import { expect, type Browser } from '@playwright/test';
import { ADMIN_STATE } from './helpers';
import { localSql } from './local';

// Catálogo de prueba de la tienda, SOLO en Supabase local (localSql se niega a otro host).
// Cubre los casos de visibilidad: producto inactivo, categoría inactiva, sin stock, últimas
// unidades, sin fotografía y suficientes productos para probar «Ver más productos».

export const STORE = {
  shampoos: '00000000-0000-4000-8000-0000000051c1',
  mascaras: '00000000-0000-4000-8000-0000000051c2',
  oculta: '00000000-0000-4000-8000-0000000051c3',
  neutro: '00000000-0000-4000-8000-0000000051d1', // destacado, con fotos y todos los textos
  acido: '00000000-0000-4000-8000-0000000051d2', // destacado, sin stock
  argan: '00000000-0000-4000-8000-0000000051d3', // destacado, últimas unidades, otra categoría
  balsamo: '00000000-0000-4000-8000-0000000051d4', // sin fotos ni textos opcionales
  inactivo: '00000000-0000-4000-8000-0000000051d5', // inactivo y destacado: nunca se ve
  oculto: '00000000-0000-4000-8000-0000000051d6', // categoría inactiva: nunca se ve
};

/** Productos visibles: 4 con nombre propio + 22 de relleno = 26 (más que una página de 24). */
export const VISIBLE_COUNT = 26;

export function seedStore() {
  localSql(`
do $$
begin
  delete from public.product_images;
  delete from public.products;
  delete from public.categories;

  insert into public.categories (id, name, slug, sort_order, is_active) values
    ('${STORE.shampoos}', 'Shampoos', 'shampoos', 10, true),
    ('${STORE.mascaras}', 'Máscaras', 'mascaras', 20, true),
    ('${STORE.oculta}', 'Categoría Oculta', 'categoria-oculta', 30, false);

  insert into public.products (id, sku, name, slug, category_id, price_ars, stock, is_active, is_featured, sort_order,
                               short_description, description, benefits, usage_instructions, presentation) values
    ('${STORE.neutro}', 'TND-NEUTRO', 'Shampoo Neutro 1000cc', 'shampoo-neutro-1000cc', '${STORE.shampoos}', 12550, 20, true, true, 1,
     'Limpieza suave para uso diario.', 'Shampoo de pH neutro.', 'Limpia sin resecar.', 'Aplicar sobre el cabello húmedo.', 'Botella de 1000 cc.'),
    ('${STORE.acido}', 'TND-ACIDO', 'Acondicionador Ácido', 'acondicionador-acido', '${STORE.shampoos}', 9000, 0, true, true, 2,
     null, null, null, null, null),
    ('${STORE.argan}', 'TND-ARGAN', 'Máscara Argán', 'mascara-argan', '${STORE.mascaras}', 15000, 2, true, true, 3,
     null, 'Máscara nutritiva.', null, null, null),
    ('${STORE.balsamo}', 'TND-BALSAMO', 'Bálsamo Lino', 'balsamo-lino', '${STORE.shampoos}', 5000, 5, true, false, 4,
     null, null, null, null, null),
    ('${STORE.inactivo}', 'TND-INACTIVO', 'Producto Inactivo', 'producto-inactivo', '${STORE.shampoos}', 1000, 10, false, true, 0,
     null, null, null, null, null),
    ('${STORE.oculto}', 'TND-OCULTO', 'Producto de Categoría Oculta', 'producto-categoria-oculta', '${STORE.oculta}', 1000, 10, true, true, 0,
     null, null, null, null, null);

  insert into public.products (sku, name, slug, category_id, price_ars, stock, sort_order)
  select 'TND-REL-' || lpad(i::text, 2, '0'), 'Producto Relleno ' || lpad(i::text, 2, '0'), 'producto-relleno-' || lpad(i::text, 2, '0'),
         '${STORE.shampoos}', 20000 + i, 10, 100 + i
  from generate_series(1, 22) as i;
end
$$`);
}

/**
 * Invalida la caché del catálogo como lo hace un administrador real: guardando un dato desde /admin
 * (el Server Action llama a updateTag('catalogo')). Se usa después de escribir datos por SQL.
 */
export async function invalidateCatalog(browser: Browser) {
  const context = await browser.newContext({ storageState: ADMIN_STATE });
  const page = await context.newPage();
  await page.goto('/admin/productos?q=TND-BALSAMO');
  const row = page.getByTestId('product-row').filter({ hasText: 'TND-BALSAMO' });
  await row.getByRole('button', { name: /^Guardar stock/ }).click();
  await expect(row.getByRole('status')).toHaveText('✓');
  await context.close();
}

/** Sube dos fotos reales del sitio al producto destacado, por el flujo del panel (URL firmada). */
export async function uploadNeutroImages(browser: Browser) {
  const context = await browser.newContext({ storageState: ADMIN_STATE });
  const page = await context.newPage();
  await page.goto(`/admin/productos/${STORE.neutro}`);
  await page.getByLabel('Elegir imágenes para subir').setInputFiles([
    join(process.cwd(), 'public/img/productos/shampoos.jpg'),
    join(process.cwd(), 'public/img/productos/serums.jpg'),
  ]);
  await expect(page.getByTestId('product-image')).toHaveCount(2, { timeout: 20_000 });
  await context.close();
}
