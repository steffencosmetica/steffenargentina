import { expect, test } from '@playwright/test';
import { ADMIN_STATE } from './helpers';

test.use({ storageState: ADMIN_STATE });

test.describe('navegación responsive', () => {
  test('desktop: sidebar fija con la sección actual marcada', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await page.goto('/admin/productos');
    const nav = page.getByRole('navigation', { name: 'Secciones' });
    await expect(nav).toBeVisible();
    await expect(page.getByRole('button', { name: 'Abrir menú' })).toBeHidden();
    await expect(nav.getByRole('link', { name: 'Productos' })).toHaveAttribute('aria-current', 'page');
    await nav.getByRole('link', { name: 'Categorías' }).click();
    await expect(page).toHaveURL(/\/admin\/categorias$/);
    await expect(nav.getByRole('link', { name: 'Categorías' })).toHaveAttribute('aria-current', 'page');
  });

  test('mobile: menú desplegable, tabla como tarjetas y sin scroll horizontal', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/admin/productos');

    const menuButton = page.getByRole('button', { name: 'Abrir menú' });
    await expect(menuButton).toBeVisible();
    // la sidebar está fuera de pantalla hasta abrir el menú
    await expect(page.getByRole('navigation', { name: 'Secciones' })).not.toBeInViewport();

    await menuButton.click();
    await expect(page.getByRole('navigation', { name: 'Secciones' })).toBeInViewport();
    await page.getByRole('navigation', { name: 'Secciones' }).getByRole('link', { name: 'Categorías' }).click();
    await expect(page).toHaveURL(/\/admin\/categorias$/);
    // al navegar el menú se cierra
    await expect(page.getByRole('button', { name: 'Abrir menú' })).toHaveAttribute('aria-expanded', 'false');

    await page.goto('/admin/productos');
    await expect(page.locator('.adm-table thead')).toBeHidden();
    await expect(page.getByTestId('product-row').first()).toBeVisible();

    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow).toBeLessThanOrEqual(0);

    // Escape cierra el menú
    await page.getByRole('button', { name: 'Abrir menú' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Abrir menú' })).toHaveAttribute('aria-expanded', 'false');
  });
});
