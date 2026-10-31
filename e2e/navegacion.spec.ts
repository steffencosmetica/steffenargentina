import { expect, test, type Page } from '@playwright/test';

// Header institucional: TIENDA en el menú de escritorio y barra compacta con menú en mobile.

const MOBILE_LINKS = ['Inicio', 'Productos', 'Tienda', 'Catálogo', 'Quiénes somos', 'Contacto', 'Sumar a mi salón', 'Portal Profesional'];

async function overflowX(page: Page) {
  return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

test.describe('header en escritorio', () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test('TIENDA después de PRODUCTOS, sin la barra mobile', async ({ page }) => {
    await page.goto('/');
    const nav = page.locator('.main-nav');
    await expect(nav.getByRole('link')).toHaveText(['INICIO', 'PRODUCTOS', 'TIENDA', 'QUIÉNES SOMOS', 'CATÁLOGO', 'CONTACTO']);
    await expect(page.locator('.btn-salon')).toBeVisible();
    await expect(page.locator('.mnav-bar')).toBeHidden();
    await expect(page.getByRole('button', { name: 'Abrir menú' })).toBeHidden();
    // el header queda por debajo de cualquier modal futuro (z-index 1100, no un valor máximo)
    expect(await page.locator('.site-header').evaluate((el) => getComputedStyle(el).zIndex)).toBe('1100');

    await nav.getByRole('link', { name: 'TIENDA' }).click();
    await expect(page).toHaveURL(/\/tienda$/);
    await expect(page.locator('.main-nav')).toBeVisible();
  });
});

test.describe('header en tablet (768 px)', () => {
  test.use({ viewport: { width: 768, height: 1024 } });

  test('usa la barra compacta con acceso directo a la tienda', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.mnav-bar')).toBeVisible();
    await expect(page.locator('.main-nav')).toBeHidden();
    await expect(page.locator('.mnav-bar').getByRole('link', { name: 'Tienda' })).toBeVisible();
    expect(await overflowX(page)).toBeLessThanOrEqual(0);
  });
});

test.describe('header en mobile (390 px)', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('barra compacta: logo, Tienda y menú cerrado', async ({ page }) => {
    await page.goto('/');
    await expect(page.locator('.main-nav')).toBeHidden();
    await expect(page.locator('.btn-salon')).toBeHidden();
    await expect(page.getByRole('link', { name: 'Steffen, ir al inicio' })).toBeVisible();
    const toggle = page.getByRole('button', { name: 'Abrir menú' });
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toHaveAttribute('aria-controls', 'menu-mobile');
    await expect(page.locator('#menu-mobile')).toBeHidden();
    const barHeight = await page.locator('.mnav-bar').evaluate((el) => el.getBoundingClientRect().height);
    expect(barHeight).toBeLessThanOrEqual(64);
  });

  test('el menú abre, se recorre con teclado y se cierra con Escape', async ({ page }) => {
    await page.goto('/');
    const toggle = page.getByRole('button', { name: 'Abrir menú' });
    await toggle.click();
    const panel = page.getByRole('navigation', { name: 'Menú principal' });
    await expect(panel).toBeVisible();
    await expect(page.getByRole('button', { name: 'Cerrar menú' }).first()).toHaveAttribute('aria-expanded', 'true');
    await expect(panel.getByRole('link')).toHaveText(MOBILE_LINKS);
    await expect(panel.getByRole('link', { name: 'Portal Profesional' })).toHaveAttribute('href', 'https://steffenprofesional.com');
    await expect(panel.getByRole('link', { name: 'Catálogo' })).toHaveAttribute('href', /CATALOGO/);
    // el foco entra al panel y Tab no se escapa del menú
    await expect(panel.getByRole('link', { name: 'Inicio' })).toBeFocused();
    for (let i = 0; i < MOBILE_LINKS.length; i++) await page.keyboard.press('Tab');
    await expect(page.locator('.mnav-toggle')).toBeFocused();
    // la página de fondo no se desplaza mientras el menú está abierto
    expect(await page.evaluate(() => document.documentElement.classList.contains('mnav-open'))).toBe(true);
    expect(await overflowX(page)).toBeLessThanOrEqual(0);

    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(page.locator('.mnav-toggle')).toBeFocused();
    await expect(page.locator('.mnav-toggle')).toHaveAttribute('aria-expanded', 'false');
    expect(await page.evaluate(() => document.documentElement.classList.contains('mnav-open'))).toBe(false);
  });

  test('el menú se cierra al navegar', async ({ page }) => {
    await page.goto('/tienda');
    await page.getByRole('button', { name: 'Abrir menú' }).click();
    await page.getByRole('navigation', { name: 'Menú principal' }).getByRole('link', { name: 'Quiénes somos' }).click();
    await expect(page).toHaveURL(/\/#quienes$/);
    await expect(page.locator('#menu-mobile')).toBeHidden();

    await page.getByRole('button', { name: 'Abrir menú' }).click();
    await page.getByRole('navigation', { name: 'Menú principal' }).getByRole('link', { name: 'Tienda' }).click();
    await expect(page).toHaveURL(/\/tienda$/);
    await expect(page.locator('#menu-mobile')).toBeHidden();

    // acceso directo desde la barra
    await page.goto('/triples');
    await page.locator('.mnav-bar').getByRole('link', { name: 'Tienda' }).click();
    await expect(page).toHaveURL(/\/tienda$/);
  });

  test('sin scroll horizontal en las páginas principales', async ({ page }) => {
    for (const path of ['/', '/tienda', '/productos', '/triples', '/shampoos']) {
      await page.goto(path);
      expect(await overflowX(page), path).toBeLessThanOrEqual(0);
    }
  });
});
