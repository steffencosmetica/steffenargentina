import { expect, test } from '@playwright/test';
import { IDS } from './global-setup';
import { ADMIN_STATE } from './helpers';
import { localSql } from './local';

// Fase 4B.3 — concurrencia entre el panel y las reservas de compradores.
// El administrador abre un producto con stock 20; mientras tanto un comprador reserva 3 unidades
// (crear_pedido real, en la base local); el administrador guarda el 20 que tenía en pantalla.
// Resultado esperado: el panel detecta el conflicto, no guarda nada, muestra el stock actual (17) y
// recién al volver a guardar sobre el valor actual se acepta. Igual para la edición rápida del listado.

test.use({ storageState: ADMIN_STATE });

const PRODUCT = '00000000-0000-4000-8000-00000000e2f1';
const ZONE = '00000000-0000-4000-8000-00000000e2f2';
let compras = 0;

function stockEnBase() {
  const [row] = localSql(`select stock, price_ars::text as price from public.products where id = '${PRODUCT}'`) as { stock: number; price: string }[];
  return row;
}

/** Un comprador reserva unidades con crear_pedido (el checkout se habilita solo dentro de esta transacción). */
function compradorReserva(unidades: number) {
  compras++;
  const key = `e2e-stock-${Date.now()}-${compras}-${'x'.repeat(20)}`;
  localSql(`
do $$
declare r jsonb;
begin
  update public.store_settings set checkout_enabled = true;
  r := public.crear_pedido('${key}',
    '{"name":"Comprador E2E","email":"comprador${compras}@steffen.test","phone":"1155550000"}',
    '{"street":"Calle","number":"1","city":"Ushuaia","postal_code":"9410","province_code":"AR-V"}',
    '[{"product_id":"${PRODUCT}","quantity":${unidades}}]',
    -- el total que "vio" el comprador: precio vigente + envío de la zona de prueba
    (select price_ars * ${unidades} + 500 from public.products where id = '${PRODUCT}'), '10.20.0.${compras}');
  update public.store_settings set checkout_enabled = false;
  if r ->> 'status' <> 'created' then raise exception 'reserva fallida: %', r; end if;
end
$$`);
}

test.describe.serial('stock: panel y reservas simultáneas', () => {
  test.beforeAll(() => {
    localSql(`
do $$
begin
  delete from public.shipping_zone_provinces where province_code = 'AR-V';
  insert into public.shipping_zones (id, name, price_ars) values ('${ZONE}', 'E2E stock', 500);
  insert into public.shipping_zone_provinces (province_code, zone_id) values ('AR-V', '${ZONE}');
  insert into public.products (id, sku, name, slug, category_id, price_ars, stock, is_active) values
    ('${PRODUCT}', 'E2E-STOCK', 'Producto Stock E2E', 'producto-stock-e2e', '${IDS.shampoos}', 1000, 20, true);
end
$$`);
  });

  test.afterAll(() => {
    localSql(`
do $$
begin
  delete from public.orders where id in (select order_id from public.order_items where product_id = '${PRODUCT}');
  delete from public.checkout_attempts;
  delete from public.products where id = '${PRODUCT}';
  delete from public.shipping_zone_provinces where zone_id = '${ZONE}';
  delete from public.shipping_zones where id = '${ZONE}';
  update public.store_settings set checkout_enabled = false;
end
$$`);
  });

  test('formulario completo: guardar un stock desactualizado se rechaza y no pisa la reserva', async ({ page }) => {
    // 1. el admin abre el producto con stock 20
    await page.goto(`/admin/productos/${PRODUCT}`);
    await expect(page.getByLabel('Stock', { exact: true })).toHaveValue('20');

    // 2. un comprador reserva 3 unidades
    compradorReserva(3);
    expect(stockEnBase().stock).toBe(17);

    // 3. el admin edita otro campo y guarda con el 20 que tiene en pantalla
    await page.getByLabel('Precio público').fill('1.200');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();

    // 4. conflicto detectado, con mensaje claro y el valor actual cargado en el campo
    await expect(page.getByText(/El stock cambió mientras editabas/).first()).toBeVisible();
    await expect(page.getByText(/Ahora hay 17 unidades disponibles/).first()).toBeVisible();
    await expect(page.getByLabel('Stock', { exact: true })).toHaveValue('17');

    // 5. el stock sigue en 17 y no se guardó nada del formulario (todo o nada)
    expect(stockEnBase()).toEqual({ stock: 17, price: '1000.00' });

    // volver a guardar, ahora sobre el valor actual
    await page.getByLabel('Precio público').fill('1.200');
    await page.getByRole('button', { name: 'Guardar cambios' }).click();
    await expect(page.getByText('Cambios guardados.')).toBeVisible();
    expect(stockEnBase()).toEqual({ stock: 17, price: '1200.00' });
  });

  test('edición rápida: el stock desactualizado se rechaza y el campo se recarga', async ({ page }) => {
    await page.goto('/admin/productos');
    const row = page.getByTestId('product-row').filter({ hasText: 'E2E-STOCK' });
    await expect(row.getByLabel(/^Stock de /)).toHaveValue('17');

    compradorReserva(2);
    expect(stockEnBase().stock).toBe(15);

    await row.getByLabel(/^Stock de /).fill('30');
    await row.getByRole('button', { name: /^Guardar stock/ }).click();
    await expect(row.getByRole('alert')).toHaveText(/El stock cambió mientras editabas.*Ahora hay 15 unidades/);
    await expect(row.getByLabel(/^Stock de /)).toHaveValue('15');
    expect(stockEnBase().stock).toBe(15);

    // con el valor actual a la vista, el admin decide y guarda
    await row.getByLabel(/^Stock de /).fill('30');
    await row.getByRole('button', { name: /^Guardar stock/ }).click();
    await expect(row.getByRole('status').first()).toHaveText('✓');
    expect(stockEnBase().stock).toBe(30);

    // y una reserva posterior se descuenta del valor nuevo
    compradorReserva(1);
    expect(stockEnBase().stock).toBe(29);
  });
});
