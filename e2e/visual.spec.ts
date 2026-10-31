import { expect, test, type Page } from '@playwright/test';
import { invalidateCatalog, seedStore, uploadNeutroImages } from './tienda-data';

// Comparación visual responsive: captura las páginas en 390, 768 y 1440 px (quedan adjuntas al
// reporte de Playwright y en test-results/) y verifica que ninguna tenga scroll horizontal.
// Carga su propio catálogo de prueba (Supabase local), así no depende del orden de los specs.

test.beforeAll(async ({ browser }) => {
  seedStore();
  await uploadNeutroImages(browser);
  await invalidateCatalog(browser);
});

const WIDTHS = [
  { name: 'mobile-390', width: 390, height: 844 },
  { name: 'tablet-768', width: 768, height: 1024 },
  { name: 'desktop-1440', width: 1440, height: 900 },
];

const PAGES = [
  { name: 'inicio', path: '/' },
  { name: 'tienda', path: '/tienda' },
  { name: 'ficha', path: '/tienda/shampoo-neutro-1000cc' },
  { name: 'productos', path: '/productos' },
  { name: 'triples', path: '/triples' },
];

async function capture(page: Page, file: string) {
  // las animaciones de aparición se muestran completas y el scroll no se anima (captura estable)
  await page.addStyleTag({ content: '.js .reveal{opacity:1!important;transform:none!important} html{scroll-behavior:auto!important}' });
  await page.waitForLoadState('networkidle');
  await test.info().attach(file, { body: await page.screenshot(), contentType: 'image/png' });
  await page.screenshot({ path: test.info().outputPath(`${file}.png`) });
}

for (const size of WIDTHS) {
  test.describe(`vista ${size.name}`, () => {
    test.use({ viewport: { width: size.width, height: size.height }, reducedMotion: 'reduce' });

    for (const p of PAGES) {
      test(`${p.name}`, async ({ page }) => {
        await page.goto(p.path);
        await capture(page, `${size.name}-${p.name}`);
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow).toBeLessThanOrEqual(0);
      });
    }

    test('inicio: galería elástica y destacados', async ({ page }) => {
      await page.goto('/');
      await page.locator('#productos').scrollIntoViewIfNeeded();
      await page.evaluate(() => document.getElementById('productos')!.scrollIntoView({ behavior: 'instant' }));
      await capture(page, `${size.name}-inicio-galeria`);
      await page.evaluate(() => document.querySelector('[data-testid="featured"]')!.scrollIntoView({ behavior: 'instant' }));
      await capture(page, `${size.name}-inicio-destacados`);
      const visibleCards = await page.getByTestId('featured').getByTestId('store-card').evaluateAll((cards) => {
        const track = cards[0].closest('ul')!.getBoundingClientRect();
        return cards.filter((c) => {
          const r = c.getBoundingClientRect();
          return r.left >= track.left - 1 && r.right <= track.right + 1;
        }).length;
      });
      // hay 3 destacados de prueba: entran completos en tablet (3 columnas) y escritorio (4 columnas);
      // en mobile es un carrusel con una tarjeta completa y la siguiente asomando
      expect(visibleCards).toBe(size.width > 600 ? 3 : 1);
    });
  });
}
