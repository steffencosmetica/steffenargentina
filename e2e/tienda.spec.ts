import { expect, test, type Page } from '@playwright/test';
import { ADMIN_STATE } from './helpers';
import { localSql } from './local';
import { STORE, VISIBLE_COUNT, invalidateCatalog, seedStore, uploadNeutroImages } from './tienda-data';

// Catálogo público contra Supabase local. Los datos se cargan por SQL y la caché se invalida con un
// guardado real desde /admin (updateTag), como pasa en producción.

const cardNames = (page: Page) => page.getByTestId('store-card').locator('.store-card-name').allTextContents();

test.describe.serial('tienda pública', () => {
  test.beforeAll(async ({ browser }) => {
    seedStore();
    await uploadNeutroImages(browser);
    await invalidateCatalog(browser);
  });

  test('lista solo productos activos de categorías activas, con contador y una página de 24', async ({ page }) => {
    await page.goto('/tienda');
    await expect(page.getByRole('heading', { level: 1, name: 'TIENDA ONLINE' })).toBeVisible();
    await expect(page.getByTestId('store-count')).toHaveText(`${VISIBLE_COUNT} productos`);
    // ya sin el esqueleto de carga: un solo encabezado
    await expect(page.getByText('Descubrí Steffen')).toHaveCount(1);
    await expect(page.getByTestId('store-card')).toHaveCount(24);

    const html = await page.content();
    expect(html).not.toContain('Producto Inactivo');
    expect(html).not.toContain('Categoría Oculta');

    // chips: solo categorías activas con productos
    const chips = page.getByRole('navigation', { name: 'Categorías' }).getByRole('link');
    await expect(chips).toHaveText(['Todas', 'Shampoos', 'Máscaras']);
    await expect(chips.first()).toHaveAttribute('aria-current', 'true');

    // carga progresiva
    await page.getByRole('link', { name: 'Ver más productos' }).click();
    await expect(page).toHaveURL(/\/tienda\?mostrar=48$/);
    await expect(page.getByTestId('store-card')).toHaveCount(VISIBLE_COUNT);
    await expect(page.getByRole('link', { name: 'Ver más productos' })).toHaveCount(0);
  });

  test('orden y productos sin stock siempre al final', async ({ page }) => {
    await page.goto('/tienda?mostrar=48');
    let names = await cardNames(page);
    // destacados primero; el destacado sin stock queda último
    expect(names.slice(0, 2)).toEqual(['Shampoo Neutro 1000cc', 'Máscara Argán']);
    expect(names.at(-1)).toBe('Acondicionador Ácido');

    // cambiar el orden vuelve a la primera página (24) y lo refleja en la URL
    await page.getByLabel('Ordenar por').selectOption('precio-asc');
    await expect(page).toHaveURL(/\/tienda\?orden=precio-asc$/);
    await expect(page.getByTestId('store-card').first()).toContainText('Bálsamo Lino');
    await page.goto('/tienda?orden=precio-asc&mostrar=48');
    names = await cardNames(page);
    expect(names.at(-1)).toBe('Acondicionador Ácido');

    await page.goto('/tienda?orden=precio-desc&mostrar=48');
    names = await cardNames(page);
    expect(names[0]).toBe('Producto Relleno 22');
    expect(names.at(-1)).toBe('Acondicionador Ácido');

    await page.goto('/tienda?orden=nombre&mostrar=48');
    names = await cardNames(page);
    expect(names.slice(0, 2)).toEqual(['Bálsamo Lino', 'Máscara Argán']);
    expect(names.at(-1)).toBe('Acondicionador Ácido');
  });

  test('buscador por nombre y SKU, filtro por categoría y URL compartible', async ({ page }) => {
    await page.goto('/tienda');
    await page.getByPlaceholder('Buscar por nombre o SKU').fill('mascara');
    await expect(page).toHaveURL(/\/tienda\?q=mascara$/);
    await expect(page.getByTestId('store-count')).toHaveText('1 producto para «mascara»');
    await expect(page.getByTestId('store-card')).toHaveText(/Máscara Argán/);

    await page.getByPlaceholder('Buscar por nombre o SKU').fill('tnd-neutro');
    await expect(page.getByTestId('store-card')).toHaveCount(1);
    await expect(page.getByTestId('store-card')).toContainText('Shampoo Neutro 1000cc');

    await page.getByPlaceholder('Buscar por nombre o SKU').fill('xyz123');
    await expect(page.getByText('No encontramos productos')).toBeVisible();
    await page.getByRole('link', { name: 'Limpiar filtros' }).first().click();
    await expect(page).toHaveURL(/\/tienda$/);
    await expect(page.getByTestId('store-count')).toHaveText(`${VISIBLE_COUNT} productos`);

    await page.getByRole('navigation', { name: 'Categorías' }).getByRole('link', { name: 'Máscaras' }).click();
    await expect(page).toHaveURL(/\/tienda\?categoria=mascaras$/);
    await expect(page.getByTestId('store-count')).toHaveText('1 producto en Máscaras');

    // la URL compartida reproduce la búsqueda sin JavaScript de por medio
    const shared = await page.request.get('/tienda?categoria=shampoos&q=balsamo');
    expect(await shared.text()).toContain('Bálsamo Lino');
  });

  test('disponibilidad en tres niveles y producto sin fotografía', async ({ page }) => {
    await page.goto('/tienda?mostrar=48');
    const card = (name: string) => page.getByTestId('store-card').filter({ hasText: name });
    await expect(card('Shampoo Neutro 1000cc').locator('.store-availability')).toHaveText('Disponible');
    await expect(card('Máscara Argán').locator('.store-availability')).toHaveText('Últimas unidades');
    await expect(card('Acondicionador Ácido').locator('.store-availability')).toHaveText('Sin stock');
    await expect(card('Bálsamo Lino').getByTestId('store-noimg')).toBeVisible();
    // la foto llega optimizada por next/image desde Supabase Storage
    await expect(card('Shampoo Neutro 1000cc').locator('img')).toHaveAttribute('src', /\/_next\/image\?url=.*storage%2Fv1%2Fobject%2Fpublic%2Fcatalogo/);
    // nunca se publica la cantidad exacta: el stock no viaja al navegador (ni en el HTML ni en el payload RSC)
    expect(await page.content()).not.toMatch(/\\?"stock\\?"\s*:/);
  });

  test('ficha completa: galería, textos, WhatsApp, relacionados y JSON-LD', async ({ page }) => {
    await page.goto('/tienda');
    await page.getByTestId('store-card').filter({ hasText: 'Shampoo Neutro 1000cc' }).click();
    await expect(page).toHaveURL(/\/tienda\/shampoo-neutro-1000cc$/);

    await expect(page.getByRole('heading', { level: 1, name: 'Shampoo Neutro 1000cc' })).toBeVisible();
    await expect(page.getByTestId('product-price')).toHaveText('$ 12.550');
    await expect(page.getByRole('navigation', { name: 'Ruta de navegación' })).toHaveText(/Tienda.*Shampoos.*Shampoo Neutro 1000cc/);
    await expect(page.getByText('Limpieza suave para uso diario.')).toBeVisible();
    for (const id of ['descripcion', 'beneficios', 'modo-de-uso', 'presentacion']) {
      await expect(page.getByTestId(`section-${id}`)).toBeVisible();
    }
    await page.getByTestId('section-presentacion').locator('summary').click();
    await expect(page.getByText('Botella de 1000 cc.')).toBeVisible();

    // galería: dos fotos, miniaturas en escritorio
    await expect(page.getByTestId('store-gallery').locator('img')).toHaveCount(2);
    await page.getByRole('button', { name: 'Ver foto 2' }).click();
    await expect(page.getByRole('button', { name: 'Ver foto 2' })).toHaveAttribute('aria-current', 'true');

    const whatsapp = page.getByTestId('whatsapp-consult');
    await expect(whatsapp).toHaveText('Consultar por WhatsApp');
    const href = new URL((await whatsapp.getAttribute('href'))!);
    expect(href.origin + href.pathname).toBe('https://wa.me/5492235590428');
    expect(href.searchParams.get('text')).toBe('Hola, quisiera consultar por el producto Shampoo Neutro 1000cc de Steffen.');
    await expect(page.getByRole('button', { name: /carrito/i })).toHaveCount(0);

    // relacionados: misma categoría, activos, sin el actual, hasta 4
    const related = page.getByTestId('related').getByTestId('store-card');
    await expect(related).toHaveCount(4);
    const relatedText = (await related.allTextContents()).join(' ');
    expect(relatedText).not.toContain('Shampoo Neutro 1000cc');
    expect(relatedText).not.toContain('Máscara Argán');
    expect(relatedText).not.toContain('Producto Inactivo');

    // datos estructurados
    const ld = JSON.parse((await page.locator('script[type="application/ld+json"]').textContent())!);
    const productLd = ld.find((x: { '@type': string }) => x['@type'] === 'Product');
    expect(productLd).toMatchObject({
      name: 'Shampoo Neutro 1000cc',
      sku: 'TND-NEUTRO',
      brand: { '@type': 'Brand', name: 'Steffen' },
      offers: { priceCurrency: 'ARS', price: '12550.00', availability: 'https://schema.org/InStock' },
    });
    expect(productLd.image).toHaveLength(2);
    expect(ld.find((x: { '@type': string }) => x['@type'] === 'BreadcrumbList').itemListElement).toHaveLength(3);

    // metadata
    await expect(page).toHaveTitle('Shampoo Neutro 1000cc | Steffen Cosmética Capilar');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://steffenargentina.com.ar/tienda/shampoo-neutro-1000cc');
    await expect(page.locator('meta[property="og:image"]').first()).toHaveAttribute('content', /storage\/v1\/object\/public\/catalogo/);
  });

  test('ficha sin textos opcionales no muestra encabezados vacíos', async ({ page }) => {
    await page.goto('/tienda/balsamo-lino');
    await expect(page.getByRole('heading', { level: 1, name: 'Bálsamo Lino' })).toBeVisible();
    await expect(page.locator('.store-sections')).toHaveCount(0);
    await expect(page.locator('.store-gallery').getByTestId('store-noimg')).toBeVisible();
    await page.goto('/tienda/mascara-argan');
    await expect(page.getByTestId('section-descripcion')).toBeVisible();
    await expect(page.getByTestId('section-beneficios')).toHaveCount(0);
    // única de su categoría: sin relacionados
    await expect(page.getByTestId('related')).toHaveCount(0);
  });

  test('404 para productos inexistentes, inactivos o de categorías inactivas', async ({ page }) => {
    for (const slug of ['no-existe', 'producto-inactivo', 'producto-categoria-oculta', 'Mayusculas']) {
      const res = await page.goto(`/tienda/${slug}`);
      expect(res?.status(), slug).toBe(404);
      await expect(page.getByRole('heading', { name: 'Este producto no está disponible' })).toBeVisible();
      await expect(page.getByRole('link', { name: 'Volver a la tienda' })).toHaveAttribute('href', '/tienda');
    }
  });

  test('sitemap con la tienda y solo productos activos', async ({ request }) => {
    const xml = await (await request.get('/sitemap.xml')).text();
    expect(xml).toContain('https://steffenargentina.com.ar/tienda</loc>');
    expect(xml).toContain('https://steffenargentina.com.ar/tienda/shampoo-neutro-1000cc</loc>');
    expect(xml).toContain('https://steffenargentina.com.ar/triples</loc>');
    expect(xml).not.toContain('producto-inactivo');
    expect(xml).not.toContain('producto-categoria-oculta');
  });

  test('destacados en el inicio: activos, con enlace a la ficha y a la tienda', async ({ page }) => {
    await page.goto('/');
    const featured = page.getByTestId('featured');
    await expect(featured.getByRole('heading', { name: 'PRODUCTOS DESTACADOS' })).toBeVisible();
    await expect(featured.getByText('Elegidos para vos')).toBeVisible();
    await expect(featured.getByTestId('store-card').locator('.store-card-name')).toHaveText([
      'Shampoo Neutro 1000cc',
      'Máscara Argán',
      'Acondicionador Ácido',
    ]);
    // las secciones institucionales siguen en su lugar y en orden
    const order = await page.evaluate(() =>
      ['productos', 'destacados-titulo', 'quienes', 'contacto'].map((id) => document.getElementById(id)?.getBoundingClientRect().top ?? -1),
    );
    expect(order.every((top, i) => top >= 0 && (i === 0 || top > order[i - 1]))).toBe(true);
    await expect(page.locator('.hero-flag video, .hero-flag')).not.toHaveCount(0);
    await expect(page.locator('.elastic-gallery .eg-item')).toHaveCount(6);

    await featured.getByRole('link', { name: 'Ver toda la tienda' }).click();
    await expect(page).toHaveURL(/\/tienda$/);
  });

  test('revalidación: cambios de precio, destacado y estado desde /admin se ven sin rebuild', async ({ page, browser }) => {
    const admin = await browser.newContext({ storageState: ADMIN_STATE });
    const adminPage = await admin.newPage();
    const row = (sku: string) => adminPage.getByTestId('product-row').filter({ hasText: sku });

    // la tienda y la ficha ya están en caché
    await page.goto('/tienda/shampoo-neutro-1000cc');
    await expect(page.getByTestId('product-price')).toHaveText('$ 12.550');

    // 1. precio
    await adminPage.goto('/admin/productos?q=TND-NEUTRO');
    await row('TND-NEUTRO').getByLabel(/^Precio de /).fill('13.999,50');
    await row('TND-NEUTRO').getByRole('button', { name: /^Guardar precio/ }).click();
    await expect(row('TND-NEUTRO').getByRole('status')).toHaveText('✓');
    await page.goto('/tienda/shampoo-neutro-1000cc');
    await expect(page.getByTestId('product-price')).toHaveText('$ 13.999,50');
    await page.goto('/tienda?q=neutro');
    await expect(page.getByTestId('store-card')).toContainText('$ 13.999,50');

    // 2. destacado
    await page.goto('/');
    await expect(page.getByTestId('featured')).toContainText('Máscara Argán');
    await adminPage.goto('/admin/productos?q=TND-ARGAN');
    await row('TND-ARGAN').getByRole('button', { name: /^Quitar de destacados/ }).click();
    await expect(row('TND-ARGAN').getByRole('button', { name: /^Marcar como destacado/ })).toBeVisible();
    await page.goto('/');
    await expect(page.getByTestId('featured')).not.toContainText('Máscara Argán');

    // 3. activo / inactivo
    await adminPage.goto('/admin/productos?q=TND-BALSAMO');
    await row('TND-BALSAMO').getByRole('button', { name: /^Desactivar / }).click();
    await expect(row('TND-BALSAMO').getByRole('button', { name: /^Activar / })).toBeVisible();
    expect((await page.goto('/tienda/balsamo-lino'))?.status()).toBe(404);
    await page.goto('/tienda?q=balsamo');
    await expect(page.getByText('No encontramos productos')).toBeVisible();
    expect(await (await page.request.get('/sitemap.xml')).text()).not.toContain('balsamo-lino');

    await row('TND-BALSAMO').getByRole('button', { name: /^Activar / }).click();
    await expect(row('TND-BALSAMO').getByRole('button', { name: /^Desactivar / })).toBeVisible();
    expect((await page.goto('/tienda/balsamo-lino'))?.status()).toBe(200);
    await admin.close();
  });

  test('sin destacados la sección del inicio no se muestra', async ({ page, browser }) => {
    localSql(`update public.products set is_featured = false`);
    await invalidateCatalog(browser);
    await page.goto('/');
    await expect(page.getByTestId('featured')).toHaveCount(0);
    await expect(page.getByText('PRODUCTOS DESTACADOS')).toHaveCount(0);
    await expect(page.locator('#quienes')).toBeVisible();
  });

  test('catálogo vacío', async ({ page, browser }) => {
    localSql(`update public.categories set is_active = false`);
    await invalidateCatalog(browser);
    await page.goto('/tienda');
    await expect(page.getByText('Todavía no hay productos en la tienda')).toBeVisible();
    await expect(page.getByTestId('store-card')).toHaveCount(0);
  });

  test.afterAll(async ({ browser }) => {
    // deja el catálogo de prueba completo para los specs siguientes
    seedStore();
    await uploadNeutroImages(browser);
    await invalidateCatalog(browser);
  });
});
