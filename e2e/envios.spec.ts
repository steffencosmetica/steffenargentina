import { expect, request as playwrightRequest, test, type Page } from '@playwright/test';
import { ADMIN_STATE } from './helpers';
import { CLIENTE, LOCAL_SUPABASE, localSql } from './local';

// Panel /admin/envios contra Supabase local: zonas, tarifas, cobertura por provincia y cotización.

const REST = `${LOCAL_SUPABASE.url}/rest/v1`;

function zones() {
  return localSql(
    `select z.name, z.price_ars::text as price, z.free_from_ars::text as free_from, z.is_active,
            coalesce((select array_agg(zp.province_code order by zp.province_code) from public.shipping_zone_provinces zp where zp.zone_id = z.id), '{}') as provinces
       from public.shipping_zones z order by z.sort_order`,
  ) as { name: string; price: string; free_from: string | null; is_active: boolean; provinces: string[] }[];
}

function clearShipping() {
  localSql(`do $$ begin delete from public.shipping_zone_provinces; delete from public.shipping_zones; end $$`);
}

async function fillZone(page: Page, data: { name?: string; price?: string; free?: string | null; provinces?: string[] }) {
  if (data.name !== undefined) await page.getByLabel('Nombre de la zona').fill(data.name);
  if (data.price !== undefined) await page.getByLabel('Tarifa de envío').fill(data.price);
  if (data.free !== undefined) {
    const toggle = page.getByRole('checkbox', { name: /Envío gratis/ });
    if (data.free === null) await toggle.uncheck();
    else {
      await toggle.check();
      await page.getByLabel('Gratis desde').fill(data.free);
    }
  }
  for (const name of data.provinces ?? []) await page.getByRole('checkbox', { name: new RegExp(`^${name}`) }).check();
}

test.use({ storageState: ADMIN_STATE });

test.describe.serial('envíos', () => {
  test.beforeAll(clearShipping);
  test.afterAll(clearShipping);

  test('sin zonas: estado vacío y ninguna provincia con cobertura', async ({ page }) => {
    await page.goto('/admin/envios');
    await expect(page.getByRole('heading', { name: 'Envíos', level: 1 })).toBeVisible();
    await expect(page.getByText('Todavía no hay zonas de envío')).toBeVisible();
    await expect(page.getByTestId('coverage').getByRole('heading')).toHaveText('Cobertura: 0 de 24 provincias');
    await expect(page.getByRole('list', { name: 'Provincias sin cobertura' }).getByRole('listitem')).toHaveCount(24);
    // acceso desde el menú del panel
    await expect(page.getByRole('navigation', { name: 'Secciones' }).getByRole('link', { name: 'Envíos' })).toHaveAttribute('aria-current', 'page');
  });

  test('validación: tarifa negativa, envío gratis en cero y nombre vacío', async ({ page }) => {
    await page.goto('/admin/envios/nueva');
    await fillZone(page, { name: '', price: '-100', free: '0' });
    await page.getByRole('button', { name: 'Crear zona' }).click();
    await expect(page.getByText('El nombre es obligatorio.')).toBeVisible();
    await expect(page.getByText('Escribí la tarifa como 5.000 o 5.000,50.')).toBeVisible();
    await expect(page.getByText('El envío gratis tiene que empezar desde un importe mayor a cero.')).toBeVisible();
    expect(zones()).toEqual([]);
  });

  test('crear zonas con tarifa, envío gratis y provincias', async ({ page }) => {
    await page.goto('/admin/envios/nueva');
    await fillZone(page, { name: 'AMBA', price: '5.000', free: '60.000', provinces: ['Ciudad Autónoma de Buenos Aires', 'Buenos Aires'] });
    await page.getByRole('button', { name: 'Crear zona' }).click();
    await expect(page).toHaveURL(/\/admin\/envios\?creada=1$/);

    await page.goto('/admin/envios/nueva');
    await fillZone(page, { name: 'Interior', price: '9.000,50', provinces: ['Córdoba', 'Santa Fe'] });
    await page.getByRole('button', { name: 'Crear zona' }).click();
    await expect(page).toHaveURL(/\/admin\/envios\?creada=1$/);

    expect(zones()).toEqual([
      { name: 'AMBA', price: '5000.00', free_from: '60000.00', is_active: true, provinces: ['AR-B', 'AR-C'] },
      { name: 'Interior', price: '9000.50', free_from: null, is_active: true, provinces: ['AR-S', 'AR-X'] },
    ]);
    await expect(page.getByTestId('coverage').getByRole('heading')).toHaveText('Cobertura: 4 de 24 provincias');
    const amba = page.getByTestId('zone-row').filter({ hasText: 'AMBA' });
    await expect(amba).toContainText('$ 5.000 · gratis desde $ 60.000');
    await expect(amba).toContainText('2 provincias: Buenos Aires, Ciudad Autónoma de Buenos Aires');
  });

  test('nombre duplicado rechazado sin cambiar nada', async ({ page }) => {
    await page.goto('/admin/envios/nueva');
    await fillZone(page, { name: 'AMBA', price: '1' });
    await page.getByRole('button', { name: 'Crear zona' }).click();
    await expect(page.getByText('Ya existe una zona con ese nombre.').first()).toBeVisible();
    expect(zones()).toHaveLength(2);
  });

  test('mover una provincia de otra zona pide confirmación', async ({ page }) => {
    await page.goto('/admin/envios');
    await page.getByTestId('zone-row').filter({ hasText: 'Interior' }).getByRole('link', { name: 'Editar' }).click();
    // CABA está en AMBA: se indica al lado
    const caba = page.locator('.adm-check').filter({ hasText: 'Ciudad Autónoma de Buenos Aires' });
    await expect(caba).toContainText('en AMBA');
    await caba.getByRole('checkbox').check();
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    const dialog = page.getByRole('dialog', { name: '¿Confirmás los cambios de cobertura?' });
    await expect(dialog).toContainText('Se mueven a esta zona: Ciudad Autónoma de Buenos Aires (desde AMBA)');

    // «Revisar» no guarda nada
    await dialog.getByRole('button', { name: 'Revisar' }).click();
    expect(zones().find((z) => z.name === 'AMBA')!.provinces).toEqual(['AR-B', 'AR-C']);

    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await dialog.getByRole('button', { name: 'Confirmar y guardar' }).click();
    await expect(page.getByText(/Cambios guardados\. .*1 movida desde otra zona/)).toBeVisible();
    expect(zones().map((z) => z.provinces)).toEqual([['AR-B'], ['AR-C', 'AR-S', 'AR-X']]);
  });

  test('quitar provincias avisa que quedan sin cobertura', async ({ page }) => {
    await page.goto('/admin/envios');
    await page.getByTestId('zone-row').filter({ hasText: 'AMBA' }).getByRole('link', { name: 'Editar' }).click();
    await page.getByRole('checkbox', { name: /^Buenos Aires/ }).uncheck();
    await page.getByLabel('Tarifa de envío').fill('5.500');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    const dialog = page.getByRole('dialog', { name: '¿Confirmás los cambios de cobertura?' });
    await expect(dialog).toContainText('Quedan sin cobertura: Buenos Aires');
    await dialog.getByRole('button', { name: 'Confirmar y guardar' }).click();
    await expect(page.getByText(/Cambios guardados\. .*1 quitada/)).toBeVisible();
    expect(zones()[0]).toMatchObject({ name: 'AMBA', price: '5500.00', provinces: [] });

    await page.goto('/admin/envios');
    await expect(page.getByTestId('coverage').getByRole('heading')).toHaveText('Cobertura: 3 de 24 provincias');
    await expect(page.getByRole('list', { name: 'Provincias sin cobertura' })).toContainText('Buenos Aires');
  });

  test('cotización: tarifa, umbral exacto, sin cobertura y zona inactiva', async ({ page }) => {
    // AMBA vuelve a cubrir Buenos Aires para probar el envío gratis
    await page.goto('/admin/envios');
    await page.getByTestId('zone-row').filter({ hasText: 'AMBA' }).getByRole('link', { name: 'Editar' }).click();
    await page.getByRole('checkbox', { name: /^Buenos Aires/ }).check();
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText(/Cambios guardados/)).toBeVisible();

    await page.goto('/admin/envios');
    const sim = page.getByTestId('quote-simulator');
    const cotizar = async (provincia: string, subtotal: string) => {
      await sim.getByLabel('Provincia').selectOption({ label: provincia });
      await sim.getByLabel('Subtotal de productos').fill(subtotal);
      await sim.getByRole('button', { name: 'Cotizar' }).click();
    };
    await cotizar('Buenos Aires', '59.999,99');
    await expect(sim.getByRole('status')).toHaveText('Envío $ 5.500 (zona AMBA, gratis desde $ 60.000)');
    await cotizar('Buenos Aires', '60.000');
    await expect(sim.getByRole('status')).toHaveText('Envío gratis (zona AMBA: gratis desde $ 60.000)');
    await cotizar('Córdoba', '1.000.000');
    await expect(sim.getByRole('status')).toHaveText('Envío $ 9.000,50 (zona Interior)');
    await cotizar('Tierra del Fuego, Antártida e Islas del Atlántico Sur', '1.000');
    await expect(sim.getByRole('alert')).toContainText('Sin cobertura');

    // desactivar la zona quita la cobertura de sus provincias
    await page.getByTestId('zone-row').filter({ hasText: 'Interior' }).getByRole('button', { name: 'Desactivar Interior' }).click();
    await expect(page.getByTestId('zone-row').filter({ hasText: 'Interior' }).getByRole('button', { name: 'Activar Interior' })).toBeVisible();
    await expect(page.getByTestId('coverage').getByRole('heading')).toHaveText('Cobertura: 1 de 24 provincias');
    await expect(page.getByRole('list', { name: 'Provincias sin cobertura' })).toContainText('Córdoba (zona Interior inactiva)');
    await cotizar('Córdoba', '1.000');
    await expect(sim.getByRole('alert')).toContainText('Sin cobertura');
    await page.getByTestId('zone-row').filter({ hasText: 'Interior' }).getByRole('button', { name: 'Activar Interior' }).click();
    await expect(page.getByTestId('coverage').getByRole('heading')).toHaveText('Cobertura: 4 de 24 provincias');
  });

  test('ordenar zonas', async ({ page }) => {
    await page.goto('/admin/envios');
    const rows = page.getByTestId('zone-row');
    await expect(rows).toHaveText([/AMBA/, /Interior/]);
    await rows.filter({ hasText: 'Interior' }).getByRole('button', { name: 'Subir Interior' }).click();
    await expect(rows).toHaveText([/Interior/, /AMBA/]);
    expect(zones().map((z) => z.name)).toEqual(['Interior', 'AMBA']);
  });

  test('una zona con provincias no se borra; sin provincias, sí', async ({ page }) => {
    await page.goto('/admin/envios/nueva');
    await fillZone(page, { name: 'Temporal', price: '0' });
    await page.getByRole('button', { name: 'Crear zona' }).click();
    await expect(page).toHaveURL(/\?creada=1$/);

    await expect(page.getByTestId('zone-row').filter({ hasText: 'AMBA' }).getByRole('button', { name: /No se puede eliminar AMBA/ })).toBeDisabled();
    await page.getByTestId('zone-row').filter({ hasText: 'Temporal' }).getByRole('button', { name: 'Eliminar Temporal' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Eliminar' }).click();
    await expect(page).toHaveURL(/\?eliminada=1$/);
    expect(zones().map((z) => z.name)).toEqual(['Interior', 'AMBA']);
  });

  test('API: el visitante cotiza pero no ve ni modifica la configuración', async () => {
    const api = await playwrightRequest.newContext({ extraHTTPHeaders: { apikey: LOCAL_SUPABASE.publishableKey } });
    for (const url of [`${REST}/shipping_zones?select=*`, `${REST}/shipping_zone_provinces?select=*`, `${REST}/shipping_zones?select=name,price_ars`]) {
      expect((await api.get(url)).status(), url).toBe(401);
    }
    expect((await api.post(`${REST}/shipping_zones`, { data: { name: 'x', price_ars: 1 } })).status()).toBe(401);
    expect((await api.patch(`${REST}/shipping_zones?name=eq.AMBA`, { data: { price_ars: 0 } })).status()).toBe(401);
    const save = await api.post(`${REST}/rpc/admin_save_zone`, {
      data: { p_id: null, p_name: 'x', p_price_ars: 1, p_free_from_ars: null, p_is_active: true, p_codes: [] },
    });
    expect(save.status()).toBe(401);

    const quote = await api.post(`${REST}/rpc/cotizar_envio`, { data: { p_province_code: 'AR-C', p_subtotal_ars: '1000.00' } });
    expect(quote.status()).toBe(200);
    expect(await quote.json()).toEqual([
      expect.objectContaining({ has_coverage: true, zone_name: 'Interior', is_free: false, cost_ars: 9000.5 }),
    ]);
    const invalid = await api.post(`${REST}/rpc/cotizar_envio`, { data: { p_province_code: 'XX', p_subtotal_ars: 1 } });
    expect((await invalid.json()).code).toBe('22023');
    const coverage = await api.post(`${REST}/rpc/provincias_cobertura`, { data: {} });
    const list = (await coverage.json()) as { code: string; has_coverage: boolean }[];
    expect(list).toHaveLength(24);
    expect(list.filter((p) => p.has_coverage).map((p) => p.code).sort()).toEqual(['AR-B', 'AR-C', 'AR-S', 'AR-X']);
    expect(Object.keys(list[0]).sort()).toEqual(['code', 'has_coverage', 'name']);
    expect(zones()[1]).toMatchObject({ name: 'AMBA', price: '5500.00' });
    await api.dispose();
  });

  test('API: un usuario logueado que no es administrador tampoco', async () => {
    const auth = await playwrightRequest.newContext({ extraHTTPHeaders: { apikey: LOCAL_SUPABASE.publishableKey } });
    const token = (await (await auth.post(`${LOCAL_SUPABASE.url}/auth/v1/token?grant_type=password`, { data: CLIENTE })).json()).access_token;
    await auth.dispose();
    const api = await playwrightRequest.newContext({
      extraHTTPHeaders: { apikey: LOCAL_SUPABASE.publishableKey, Authorization: `Bearer ${token}` },
    });
    expect(await (await api.get(`${REST}/shipping_zones?select=name`)).json()).toEqual([]);
    const insert = await api.post(`${REST}/shipping_zones`, { data: { name: 'x', price_ars: 1 } });
    expect((await insert.json()).code).toBe('42501');
    const save = await api.post(`${REST}/rpc/admin_save_zone`, {
      data: { p_id: null, p_name: 'x', p_price_ars: 1, p_free_from_ars: null, p_is_active: true, p_codes: [] },
    });
    expect((await save.json()).code).toBe('42501');
    expect(zones()).toHaveLength(2);
    await api.dispose();
  });

  for (const size of [
    { name: 'mobile-390', width: 390, height: 844 },
    { name: 'tablet-768', width: 768, height: 1024 },
    { name: 'desktop-1440', width: 1440, height: 900 },
  ]) {
    test(`responsive ${size.name}`, async ({ page }) => {
      await page.setViewportSize({ width: size.width, height: size.height });
      for (const [nombre, path] of [
        ['listado', '/admin/envios'],
        ['nueva', '/admin/envios/nueva'],
      ] as const) {
        await page.goto(path);
        await page.screenshot({ path: test.info().outputPath(`envios-${nombre}-${size.name}.png`), fullPage: true });
        const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
        expect(overflow, `${nombre} ${size.name}`).toBeLessThanOrEqual(0);
      }
    });
  }
});
