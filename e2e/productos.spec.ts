import { expect, test } from '@playwright/test';
import { ADMIN_STATE, tinyPng } from './helpers';
import { localSql } from './local';

test.use({ storageState: ADMIN_STATE });

test.describe.serial('productos', () => {
  let productUrl = '';

  test('validación en el navegador antes de enviar', async ({ page }) => {
    await page.goto('/admin/productos/nuevo');
    await page.getByLabel('Nombre').fill('Máscara Nutritiva 250 ml');
    // el slug se completa solo desde el nombre
    await expect(page.getByLabel('Slug (URL)')).toHaveValue('mascara-nutritiva-250-ml');
    await page.getByLabel('Precio público').fill('12,500.50');
    await page.getByLabel('Stock').fill('-2');
    await page.getByRole('button', { name: 'Crear producto' }).click();

    await expect(page.getByText('Revisá los campos marcados.')).toBeVisible();
    await expect(page.getByText('El SKU es obligatorio.')).toBeVisible();
    await expect(page.getByText('Escribí el precio como 12.500 o 12.500,50.')).toBeVisible();
    await expect(page.getByText('Elegí una categoría.')).toBeVisible();
    await expect(page.getByText(/El stock debe ser un número entero/)).toBeVisible();
    await expect(page).toHaveURL(/\/admin\/productos\/nuevo$/);
  });

  test('crear producto', async ({ page }) => {
    await page.goto('/admin/productos/nuevo');
    await page.getByLabel('Nombre').fill('Máscara Nutritiva 250 ml');
    await page.getByLabel('SKU').fill('E2E-MAS-250');
    await page.getByLabel('Categoría').selectOption({ label: 'Máscaras' });
    await page.getByLabel('Precio público').fill('12.500,50');
    await page.getByLabel('Stock').fill('8');
    await page.getByLabel('Descripción corta').fill('Hidratación profunda.');
    await page.getByLabel('Peso (g)').fill('280');
    await page.getByRole('button', { name: 'Crear producto' }).click();

    await expect(page).toHaveURL(/\/admin\/productos\/[0-9a-f-]{36}\?creado=1$/);
    await expect(page.getByText('Producto creado. Ahora podés agregarle imágenes.')).toBeVisible();
    productUrl = page.url().replace(/\?.*$/, '');

    const [row] = localSql(`select sku, price_ars::text as price, stock, weight_grams, is_active from public.products where sku = 'E2E-MAS-250'`) as Record<string, unknown>[];
    expect(row).toMatchObject({ sku: 'E2E-MAS-250', price: '12500.50', stock: 8, weight_grams: 280, is_active: true });
  });

  test('SKU duplicado muestra el error en el campo', async ({ page }) => {
    await page.goto('/admin/productos/nuevo');
    await page.getByLabel('Nombre').fill('Otro producto');
    await page.getByLabel('SKU').fill('E2E-MAS-250');
    await page.getByLabel('Categoría').selectOption({ label: 'Máscaras' });
    await page.getByLabel('Precio público').fill('100');
    await page.getByRole('button', { name: 'Crear producto' }).click();
    await expect(page.getByText('Ya existe un producto con ese SKU.').first()).toBeVisible();
  });

  test('editar producto', async ({ page }) => {
    await page.goto(productUrl);
    await page.getByLabel('Nombre').fill('Máscara Nutritiva 300 ml');
    // en un producto existente el slug no cambia solo
    await expect(page.getByLabel('Slug (URL)')).toHaveValue('mascara-nutritiva-250-ml');
    await page.getByLabel('Slug (URL)').fill('mascara-nutritiva-300-ml');
    await page.getByLabel('Precio público').fill('14.990');
    await page.getByLabel('Alto (mm)').fill('120');
    await page.getByRole('checkbox', { name: /Destacado/ }).check();
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Cambios guardados.')).toBeVisible();

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Máscara Nutritiva 300 ml', level: 1 })).toBeVisible();
    await expect(page.getByLabel('Precio público')).toHaveValue('14.990');
    await expect(page.getByLabel('Alto (mm)')).toHaveValue('120');
    await expect(page.getByRole('checkbox', { name: /Destacado/ })).toBeChecked();
  });

  test('edición rápida de precio, stock, estado y destacado desde el listado', async ({ page }) => {
    await page.goto('/admin/productos');
    const row = page.getByTestId('product-row').filter({ hasText: 'E2E-MAS-250' });

    await row.getByLabel(/^Precio de /).fill('15.500,75');
    await row.getByRole('button', { name: /^Guardar precio/ }).click();
    await expect(row.getByRole('status')).toHaveText('✓');

    await row.getByLabel(/^Stock de /).fill('25');
    await row.getByRole('button', { name: /^Guardar stock/ }).click();
    await expect(row.getByRole('status').first()).toHaveText('✓');

    await row.getByLabel(/^Stock de /).fill('-1');
    await row.getByRole('button', { name: /^Guardar stock/ }).click();
    await expect(row.getByRole('alert')).toHaveText(/entero mayor o igual a cero/);

    await row.getByRole('button', { name: /^Desactivar / }).click();
    await expect(row.getByRole('button', { name: /^Activar / })).toHaveText('Inactivo');

    await row.getByRole('button', { name: /^Quitar de destacados/ }).click();
    await expect(row.getByRole('button', { name: /^Marcar como destacado/ })).toBeVisible();

    const [db] = localSql(`select price_ars::text as price, stock, is_active, is_featured from public.products where sku = 'E2E-MAS-250'`) as Record<string, unknown>[];
    expect(db).toMatchObject({ price: '15500.75', stock: 25, is_active: false, is_featured: false });
  });

  test('filtros del listado', async ({ page }) => {
    await page.goto('/admin/productos?estado=inactivos');
    await expect(page.getByTestId('product-row')).toHaveCount(1);
    await expect(page.getByTestId('product-row')).toContainText('E2E-MAS-250');
    await page.goto('/admin/productos?q=base');
    await expect(page.getByTestId('product-row')).toHaveCount(1);
    await expect(page.getByTestId('product-row')).toContainText('E2E-BASE');
  });

  test('imágenes: subida con URL firmada, principal, orden y borrado', async ({ page }) => {
    await page.goto(productUrl);
    await expect(page.getByText('Este producto todavía no tiene imágenes.')).toBeVisible();

    // la subida va directo del navegador a Storage, sin pasar por el servidor de Next
    const storageUploads: string[] = [];
    page.on('request', (req) => {
      if (req.method() === 'PUT' && req.url().includes('/storage/v1/object/upload/sign/catalogo/')) storageUploads.push(req.url());
    });

    await page.getByLabel('Elegir imágenes para subir').setInputFiles([
      { name: 'frente.png', mimeType: 'image/png', buffer: tinyPng([200, 160, 75]) },
      { name: 'dorso.png', mimeType: 'image/png', buffer: tinyPng([30, 30, 30]) },
    ]);
    await expect(page.getByTestId('product-image')).toHaveCount(2);
    expect(storageUploads).toHaveLength(2);

    const images = page.getByTestId('product-image');
    // la primera subida queda como principal
    await expect(images.nth(0)).toHaveAttribute('data-primary', 'true');
    await expect(images.nth(1)).toHaveAttribute('data-primary', 'false');

    const firstSrc = await images.nth(0).locator('img').getAttribute('src');
    await images.nth(1).getByRole('button', { name: /Usar imagen 2 como principal/ }).click();
    await expect(images.nth(1)).toHaveAttribute('data-primary', 'true');
    await expect(images.nth(0)).toHaveAttribute('data-primary', 'false');

    // orden: la primera pasa al segundo lugar
    await images.nth(0).getByRole('button', { name: 'Mover imagen 1 después' }).click();
    await expect(images.nth(1).locator('img')).toHaveAttribute('src', firstSrc!);

    // un archivo que no es imagen se rechaza en el navegador
    await page.getByLabel('Elegir imágenes para subir').setInputFiles([{ name: 'notas.txt', mimeType: 'text/plain', buffer: Buffer.from('hola') }]);
    await expect(page.getByText('Formato no admitido (JPG, PNG, WebP o AVIF).')).toBeVisible();

    // borrar la principal (ahora en primer lugar): pide confirmación y la otra pasa a ser principal
    await expect(images.nth(0)).toHaveAttribute('data-primary', 'true');
    await images.nth(0).getByRole('button', { name: 'Eliminar imagen 1' }).click();
    await expect(page.getByRole('dialog', { name: '¿Eliminar esta imagen?' })).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click();
    await expect(images).toHaveCount(2);

    await images.nth(0).getByRole('button', { name: 'Eliminar imagen 1' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Eliminar' }).click();
    await expect(page.getByText('Imagen eliminada.')).toBeVisible();
    await expect(images).toHaveCount(1);
    await expect(images.nth(0)).toHaveAttribute('data-primary', 'true');

    const rows = localSql(
      `select i.storage_path, i.is_primary, (select count(*) from storage.objects o where o.bucket_id = 'catalogo' and o.name = i.storage_path) as en_storage
       from public.product_images i join public.products p on p.id = i.product_id where p.sku = 'E2E-MAS-250'`,
    ) as { storage_path: string; is_primary: boolean; en_storage: number }[];
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ is_primary: true, en_storage: 1 });
    expect(rows[0].storage_path).toMatch(/^productos\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.png$/);
  });

  test('eliminar producto con confirmación borra también sus archivos', async ({ page }) => {
    const [{ storage_path }] = localSql(
      `select i.storage_path from public.product_images i join public.products p on p.id = i.product_id where p.sku = 'E2E-MAS-250'`,
    ) as { storage_path: string }[];

    await page.goto(productUrl);
    await page.getByRole('button', { name: 'Eliminar producto' }).click();
    const dialog = page.getByRole('dialog', { name: /¿Eliminar «Máscara Nutritiva 300 ml»\?/ });
    await expect(dialog).toBeVisible();
    await dialog.getByRole('button', { name: 'Eliminar producto' }).click();

    await expect(page).toHaveURL(/\/admin\/productos\?eliminado=1$/);
    await expect(page.getByText('Producto eliminado.')).toBeVisible();
    await expect(page.getByTestId('product-row').filter({ hasText: 'E2E-MAS-250' })).toHaveCount(0);

    const [left] = localSql(
      `select (select count(*) from public.products where sku = 'E2E-MAS-250') as productos,
              (select count(*) from storage.objects where bucket_id = 'catalogo' and name = '${storage_path}') as archivos`,
    ) as Record<string, number>[];
    expect(left).toEqual({ productos: 0, archivos: 0 });
  });

  test('un producto inexistente muestra la página de no encontrado', async ({ page }) => {
    await page.goto('/admin/productos/00000000-0000-4000-8000-000000000000');
    await expect(page.getByText('No encontramos lo que buscabas')).toBeVisible();
  });
});
