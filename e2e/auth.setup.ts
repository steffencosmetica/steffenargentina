import { test as setup } from '@playwright/test';
import { ADMIN } from './local';
import { ADMIN_STATE, loginAsAdmin } from './helpers';

// Inicia sesión una vez como administrador y guarda las cookies para los tests que no prueban el login.
setup('sesión de administrador', async ({ page }) => {
  await loginAsAdmin(page, ADMIN.email, ADMIN.password);
  await page.context().storageState({ path: ADMIN_STATE });
});
