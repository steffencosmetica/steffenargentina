import { expect, test } from '@playwright/test';
import { ADMIN, CLIENTE } from './local';
import { authCookies, login, loginAsAdmin, readSession, writeSession } from './helpers';

test.describe('autenticación', () => {
  test('sin sesión, cualquier ruta del panel redirige al login conservando el destino', async ({ page }) => {
    await page.goto('/admin/categorias');
    await expect(page).toHaveURL(/\/admin\/login\?next=%2Fadmin%2Fcategorias$/);
    await expect(page.getByRole('heading', { name: 'Panel de administración' })).toBeVisible();

    await page.goto('/admin');
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test('el panel no se indexa', async ({ request }) => {
    const res = await request.get('/admin/login');
    expect(res.headers()['x-robots-tag']).toBe('noindex, nofollow');
    const robots = await (await request.get('/robots.txt')).text();
    expect(robots).toContain('Disallow: /admin');
  });

  test('credenciales incorrectas muestran un error genérico', async ({ page }) => {
    await login(page, ADMIN.email, 'contraseña-equivocada');
    await expect(page.getByRole('alert').filter({ hasText: 'Email' })).toHaveText('Email o contraseña incorrectos.');
    await expect(page).toHaveURL(/\/admin\/login/);
    expect(await authCookies(page.context())).toHaveLength(0);
  });

  test('un usuario que no es administrador no puede entrar y no le queda sesión', async ({ page }) => {
    await login(page, CLIENTE.email, CLIENTE.password);
    // mismo mensaje que con una contraseña incorrecta
    await expect(page.getByRole('alert').filter({ hasText: 'Email' })).toHaveText('Email o contraseña incorrectos.');
    expect(await authCookies(page.context())).toHaveLength(0);
    await page.goto('/admin/productos');
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test('login, cookies seguras, redirección al destino y logout', async ({ page }) => {
    await page.goto('/admin/categorias');
    await page.getByLabel('Email').fill(ADMIN.email);
    await page.getByLabel('Contraseña').fill(ADMIN.password);
    await page.getByRole('button', { name: 'Ingresar' }).click();
    await expect(page).toHaveURL(/\/admin\/categorias$/);

    const cookies = await authCookies(page.context());
    expect(cookies.length).toBeGreaterThan(0);
    for (const c of cookies) {
      expect(c.httpOnly, `${c.name} es httpOnly`).toBe(true);
      expect(c.sameSite).toBe('Lax');
      expect(c.path).toBe('/');
    }
    // el JavaScript de la página no ve la sesión
    expect(await page.evaluate(() => document.cookie)).not.toContain('auth-token');

    // con sesión, el login lleva al panel
    await page.goto('/admin/login');
    await expect(page).toHaveURL(/\/admin\/productos$/);

    await page.getByRole('button', { name: 'Cerrar sesión' }).click();
    await expect(page).toHaveURL(/\/admin\/login\?motivo=salida$/);
    await expect(page.getByText('Cerraste sesión correctamente.')).toBeVisible();
    expect(await authCookies(page.context())).toHaveLength(0);

    await page.goto('/admin/productos');
    await expect(page).toHaveURL(/\/admin\/login/);
  });

  test('un access token vencido se renueva solo con el refresh token', async ({ page }) => {
    await loginAsAdmin(page, ADMIN.email, ADMIN.password);
    const before = await readSession(page.context());

    // simula que pasó la hora de validez del access token
    await writeSession(page.context(), { ...before, expires_at: Math.floor(Date.now() / 1000) - 60 });
    await page.goto('/admin/categorias');
    await expect(page.getByRole('heading', { name: 'Categorías', level: 1 })).toBeVisible();

    const after = await readSession(page.context());
    expect(after.access_token).not.toBe(before.access_token);
    expect(after.refresh_token).not.toBe(before.refresh_token);
    expect(after.expires_at).toBeGreaterThan(Math.floor(Date.now() / 1000));
    for (const c of await authCookies(page.context())) expect(c.httpOnly).toBe(true);
  });

  test('una sesión expirada o revocada vuelve al login con aviso', async ({ page }) => {
    await loginAsAdmin(page, ADMIN.email, ADMIN.password);
    const session = await readSession(page.context());

    // access token vencido y refresh token inválido: no se puede renovar
    await writeSession(page.context(), {
      ...session,
      expires_at: Math.floor(Date.now() / 1000) - 60,
      refresh_token: 'refresh-token-revocado',
    });
    await page.goto('/admin/categorias');
    await expect(page).toHaveURL(/\/admin\/login\?next=%2Fadmin%2Fcategorias&motivo=expirada$/);
    await expect(page.getByText('Tu sesión expiró')).toBeVisible();
  });

  test('regresión: el login nunca redirige a destinos inválidos', async ({ page }) => {
    // caso real: la URL del login copiada con un punto final
    await page.goto('/admin/login.');
    await expect(page).toHaveURL(/\/admin\/login$/);

    // destinos inválidos pasados a mano en ?next=: después del login siempre se llega al inicio del panel
    for (const next of ['/admin/login.', '/admin/xyz', 'https://malicioso.com', '//malicioso.com/admin', '/shampoos']) {
      await page.context().clearCookies();
      await page.goto(`/admin/login?next=${encodeURIComponent(next)}`);
      await page.getByLabel('Email').fill(ADMIN.email);
      await page.getByLabel('Contraseña').fill(ADMIN.password);
      await page.getByRole('button', { name: 'Ingresar' }).click();
      await expect(page, `next=${next}`).toHaveURL(/^http:\/\/localhost:\d+\/admin\/productos$/);
    }
  });

  test('una cookie de sesión manipulada no da acceso', async ({ page, context }) => {
    await context.addCookies([
      {
        name: 'sb-127-auth-token',
        value: 'base64-' + Buffer.from(JSON.stringify({ access_token: 'falso', refresh_token: 'falso', expires_at: 9999999999 })).toString('base64url'),
        domain: 'localhost',
        path: '/',
      },
    ]);
    await page.goto('/admin/productos');
    await expect(page).toHaveURL(/\/admin\/login/);
  });
});
