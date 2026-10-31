import { defineConfig, devices } from '@playwright/test';
import { LOCAL_SUPABASE } from './e2e/local';

// Pruebas end-to-end del panel /admin.
// Corren SIEMPRE contra Supabase local (npm run db:start): la app se compila con la URL y la clave
// locales en una carpeta propia (.next-e2e), así que nunca usan .env.local ni el proyecto de Cloud.
// e2e/global-setup.ts carga los datos de prueba en la base local y e2e/global-teardown.ts los borra al terminar.

const PORT = 3100;

export default defineConfig({
  testDir: './e2e',
  // los tests comparten la base local: uno a la vez
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  reporter: [['list'], ['html', { open: 'never' }]],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: {
    baseURL: `http://localhost:${PORT}`,
    locale: 'es-AR',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'setup', testMatch: /auth\.setup\.ts/ },
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      dependencies: ['setup'],
    },
  ],
  webServer: {
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}/admin/login`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      NEXT_DIST_DIR: '.next-e2e',
      NEXT_PUBLIC_SUPABASE_URL: LOCAL_SUPABASE.url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: LOCAL_SUPABASE.publishableKey,
    },
  },
});
