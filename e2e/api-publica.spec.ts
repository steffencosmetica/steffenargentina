import { expect, request as playwrightRequest, test, type APIRequestContext } from '@playwright/test';
import { ADMIN, CLIENTE, LOCAL_SUPABASE, localSql } from './local';
import { seedBaseCatalog } from './global-setup';
import { STORE, invalidateCatalog, seedStore } from './tienda-data';

// El stock exacto no es público: pruebas contra la API REST real de Supabase local, con la clave
// publicable (visitante) y con la sesión de un administrador.

const REST = `${LOCAL_SUPABASE.url}/rest/v1`;

async function anonApi() {
  return playwrightRequest.newContext({ extraHTTPHeaders: { apikey: LOCAL_SUPABASE.publishableKey } });
}

/** Sesión real de Supabase Auth de un usuario de prueba (solo local). */
async function userApi(user: { email: string; password: string }): Promise<APIRequestContext> {
  const auth = await playwrightRequest.newContext({ extraHTTPHeaders: { apikey: LOCAL_SUPABASE.publishableKey } });
  const res = await auth.post(`${LOCAL_SUPABASE.url}/auth/v1/token?grant_type=password`, {
    data: { email: user.email, password: user.password },
  });
  expect(res.ok()).toBe(true);
  const { access_token } = await res.json();
  await auth.dispose();
  return playwrightRequest.newContext({
    extraHTTPHeaders: { apikey: LOCAL_SUPABASE.publishableKey, Authorization: `Bearer ${access_token}` },
  });
}

function stockOf(sku: string) {
  const [row] = localSql(`select stock, price_ars::text as price from public.products where sku = '${sku}'`) as { stock: number; price: string }[];
  return row;
}

test.describe.serial('stock privado en la API pública', () => {
  test.beforeAll(async ({ browser }) => {
    seedStore();
    await invalidateCatalog(browser);
  });

  // los specs del panel que corren después esperan el catálogo de partida
  test.afterAll(() => seedBaseCatalog());

  test('el visitante consulta productos activos y ve solo la disponibilidad', async () => {
    const api = await anonApi();
    const res = await api.get(`${REST}/products?select=sku,name,price_ars,availability&sku=in.(TND-NEUTRO,TND-ARGAN,TND-ACIDO)&order=sku`);
    expect(res.status()).toBe(200);
    expect(await res.json()).toEqual([
      { sku: 'TND-ACIDO', name: 'Acondicionador Ácido', price_ars: 9000, availability: 'sin-stock' },
      { sku: 'TND-ARGAN', name: 'Máscara Argán', price_ars: 15000, availability: 'ultimas' },
      { sku: 'TND-NEUTRO', name: 'Shampoo Neutro 1000cc', price_ars: 12550, availability: 'disponible' },
    ]);
    // la consulta que usa la tienda (con categoría e imágenes embebidas) sigue funcionando
    const tienda = await api.get(
      `${REST}/products?select=id,sku,availability,updated_at,category:categories!inner(id,slug,is_active),images:product_images(id,storage_path)&is_active=eq.true&category.is_active=eq.true`,
    );
    expect(tienda.status()).toBe(200);
    expect((await tienda.json()).length).toBe(26);
    await api.dispose();
  });

  test('el visitante no puede obtener el stock por ninguna vía', async () => {
    const api = await anonApi();
    const intentos: Record<string, string> = {
      'select explícito': `${REST}/products?select=sku,stock`,
      'select *': `${REST}/products?select=*`,
      'select sin columnas (equivale a *)': `${REST}/products`,
      'filtro por stock': `${REST}/products?select=sku&stock=gt.10`,
      'orden por stock': `${REST}/products?select=sku&order=stock.desc`,
      'embebido desde imágenes': `${REST}/product_images?select=id,products(stock)`,
      'embebido desde categorías': `${REST}/categories?select=slug,products(sku,stock)`,
      'embebido con *': `${REST}/categories?select=slug,products(*)`,
      'filtro embebido': `${REST}/categories?select=slug,products!inner(sku)&products.stock=gt.0`,
    };
    for (const [nombre, url] of Object.entries(intentos)) {
      const res = await api.get(url);
      expect(res.status(), nombre).toBe(401);
      const body = await res.json();
      expect(body.code, nombre).toBe('42501');
      expect(JSON.stringify(body), nombre).not.toMatch(/"stock"\s*:\s*\d/);
    }
    // funciones públicas existentes: ninguna devuelve stock
    const rpc = await api.post(`${REST}/rpc/is_admin`, { data: {} });
    expect(await rpc.json()).toBe(false);
    // GraphQL (si estuviera habilitado tampoco podría leer la columna)
    const gql = await api.post(`${LOCAL_SUPABASE.url}/graphql/v1`, {
      data: { query: '{ productsCollection { edges { node { sku stock } } } }' },
    });
    expect(await gql.text()).not.toMatch(/"stock"\s*:\s*\d/);
    await api.dispose();
  });

  test('el visitante no puede modificar stock ni precios', async () => {
    const api = await anonApi();
    const antes = stockOf('TND-NEUTRO');
    for (const data of [{ stock: 0 }, { price_ars: 1 }]) {
      const res = await api.patch(`${REST}/products?sku=eq.TND-NEUTRO`, { data });
      expect(res.status(), JSON.stringify(data)).toBe(401);
    }
    // availability es una columna generada: se rechaza antes incluso de mirar permisos
    expect((await api.patch(`${REST}/products?sku=eq.TND-NEUTRO`, { data: { availability: 'disponible' } })).ok()).toBe(false);
    const insert = await api.post(`${REST}/products`, {
      data: { sku: 'ANON', name: 'x', slug: 'anon', category_id: STORE.shampoos, price_ars: 1, stock: 1 },
    });
    expect(insert.status()).toBe(401);
    expect(stockOf('TND-NEUTRO')).toEqual(antes);
    await api.dispose();
  });

  test('productos inactivos y de categorías inactivas siguen ocultos', async () => {
    const api = await anonApi();
    for (const sku of ['TND-INACTIVO', 'TND-OCULTO']) {
      const res = await api.get(`${REST}/products?select=sku,availability&sku=eq.${sku}`);
      expect(res.status()).toBe(200);
      expect(await res.json(), sku).toEqual([]);
    }
    const cats = await api.get(`${REST}/categories?select=slug&order=slug`);
    expect((await cats.json()).map((c: { slug: string }) => c.slug)).toEqual(['mascaras', 'shampoos']);
    await api.dispose();
  });

  test('un usuario logueado que no es administrador tampoco ve el stock', async () => {
    const api = await userApi(CLIENTE);
    for (const url of [
      `${REST}/products?select=sku,stock`,
      `${REST}/products?select=*`,
      `${REST}/products?select=sku&stock=gt.0`,
      `${REST}/product_images?select=id,products(stock)`,
    ]) {
      const res = await api.get(url);
      expect(res.status(), url).toBe(403);
      expect((await res.json()).code, url).toBe('42501');
    }
    const rpc = await api.post(`${REST}/rpc/admin_product_stock`, { data: {} });
    expect(rpc.ok()).toBe(false);
    expect((await rpc.json()).code).toBe('42501');
    // ve lo mismo que un visitante: lo activo, con su disponibilidad
    const visible = await api.get(`${REST}/products?select=sku,availability&sku=in.(TND-NEUTRO,TND-INACTIVO)`);
    expect(await visible.json()).toEqual([{ sku: 'TND-NEUTRO', availability: 'disponible' }]);
    await api.dispose();
  });

  test('el administrador lee y edita el stock exacto por la API', async () => {
    const api = await userApi(ADMIN);
    // el stock exacto se lee solo con la función que verifica is_admin(), no con SELECT
    expect((await api.get(`${REST}/products?select=sku,stock`)).status()).toBe(403);
    const rpc = await api.post(`${REST}/rpc/admin_product_stock`, { data: { p_ids: [STORE.neutro, STORE.inactivo] } });
    expect(rpc.status()).toBe(200);
    expect(((await rpc.json()) as { id: string; stock: number }[]).sort((a, b) => a.id.localeCompare(b.id))).toEqual([
      { id: STORE.neutro, stock: 20 },
      { id: STORE.inactivo, stock: 10 },
    ]);
    const edicion = await api.patch(`${REST}/products?sku=eq.TND-NEUTRO&select=sku,availability`, {
      data: { stock: 3 },
      headers: { Prefer: 'return=representation' },
    });
    expect(edicion.status()).toBe(200);
    expect(await edicion.json()).toEqual([{ sku: 'TND-NEUTRO', availability: 'ultimas' }]);
    expect(stockOf('TND-NEUTRO').stock).toBe(3);
    // la disponibilidad no se puede forzar a mano ni siquiera como admin
    const forzar = await api.patch(`${REST}/products?sku=eq.TND-NEUTRO`, { data: { availability: 'disponible' } });
    expect(forzar.ok()).toBe(false);
    // y la regla de stock no negativo sigue vigente
    const negativo = await api.patch(`${REST}/products?sku=eq.TND-NEUTRO`, { data: { stock: -1 } });
    expect((await negativo.json()).code).toBe('23514');
    await api.patch(`${REST}/products?sku=eq.TND-NEUTRO`, { data: { stock: 20 } });
    await api.dispose();
  });
});
