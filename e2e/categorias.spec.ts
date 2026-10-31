import { expect, test } from '@playwright/test';
import { ADMIN_STATE } from './helpers';
import { localSql } from './local';

test.use({ storageState: ADMIN_STATE });

test.describe.serial('categorías', () => {
  test('crear categoría', async ({ page }) => {
    await page.goto('/admin/categorias/nueva');
    await page.getByLabel('Nombre').fill('Finishing Pro');
    await expect(page.getByLabel('Slug (URL)')).toHaveValue('finishing-pro');
    await page.getByLabel('Descripción').fill('Terminaciones y brillo.');
    await page.getByRole('button', { name: 'Crear categoría' }).click();

    await expect(page).toHaveURL(/\/admin\/categorias\?creada=1$/);
    await expect(page.getByText('Categoría creada.')).toBeVisible();
    // las nuevas van al final
    await expect(page.getByTestId('category-row').last()).toContainText('Finishing Pro');
  });

  test('slug inválido y duplicado', async ({ page }) => {
    await page.goto('/admin/categorias/nueva');
    await page.getByLabel('Nombre').fill('Shampoos 2');
    await page.getByLabel('Slug (URL)').fill('con espacios');
    await page.getByRole('button', { name: 'Crear categoría' }).click();
    await expect(page.getByText('El slug solo puede tener minúsculas, números y guiones.')).toBeVisible();

    await page.getByLabel('Slug (URL)').fill('shampoos');
    await page.getByRole('button', { name: 'Crear categoría' }).click();
    await expect(page.getByText('Ya existe una categoría con ese slug.').first()).toBeVisible();
  });

  test('editar categoría', async ({ page }) => {
    await page.goto('/admin/categorias');
    await page.getByTestId('category-row').filter({ hasText: 'Finishing Pro' }).getByRole('link', { name: 'Editar' }).click();
    await page.getByLabel('Nombre').fill('Finishing Profesional');
    await page.getByRole('checkbox', { name: /Activa/ }).uncheck();
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Cambios guardados.')).toBeVisible();

    const [row] = localSql(`select name, slug, is_active, sort_order from public.categories where slug = 'finishing-pro'`) as Record<string, unknown>[];
    // editar no cambia el orden
    expect(row).toMatchObject({ name: 'Finishing Profesional', is_active: false, sort_order: 30 });
  });

  test('ordenar y activar', async ({ page }) => {
    await page.goto('/admin/categorias');
    const rows = page.getByTestId('category-row');
    await expect(rows).toHaveText([/Shampoos/, /Máscaras/, /Finishing Profesional/]);

    await rows.filter({ hasText: 'Finishing Profesional' }).getByRole('button', { name: 'Subir Finishing Profesional' }).click();
    await expect(rows).toHaveText([/Shampoos/, /Finishing Profesional/, /Máscaras/]);
    await rows.filter({ hasText: 'Shampoos' }).getByRole('button', { name: 'Bajar Shampoos' }).click();
    await expect(rows).toHaveText([/Finishing Profesional/, /Shampoos/, /Máscaras/]);
    // la primera no puede subir
    await expect(rows.first().getByRole('button', { name: /^Subir/ })).toBeDisabled();

    await rows.filter({ hasText: 'Finishing Profesional' }).getByRole('button', { name: 'Activar Finishing Profesional' }).click();
    await expect(rows.filter({ hasText: 'Finishing Profesional' }).getByRole('button', { name: /Desactivar/ })).toHaveText('Activa');

    const order = (localSql(`select slug from public.categories order by sort_order`) as { slug: string }[]).map((r) => r.slug);
    expect(order).toEqual(['finishing-pro', 'shampoos', 'mascaras']);
  });

  test('no se puede eliminar una categoría con productos', async ({ page }) => {
    await page.goto('/admin/categorias');
    const shampoos = page.getByTestId('category-row').filter({ hasText: 'Shampoos' });
    await expect(shampoos).toContainText('1 producto');
    await expect(shampoos.getByRole('button', { name: /No se puede eliminar Shampoos/ })).toBeDisabled();
  });

  test('eliminar una categoría vacía', async ({ page }) => {
    await page.goto('/admin/categorias');
    const row = page.getByTestId('category-row').filter({ hasText: 'Finishing Profesional' });
    await row.getByRole('button', { name: 'Eliminar Finishing Profesional' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Eliminar' }).click();
    await expect(page).toHaveURL(/\/admin\/categorias\?eliminada=1$/);
    await expect(page.getByTestId('category-row')).toHaveCount(2);
  });
});
