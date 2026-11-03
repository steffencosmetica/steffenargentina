import { defineConfig, devices } from '@playwright/test';
import { LOCAL_SUPABASE, localSecretKey } from './e2e/local';

// Build aparte SIN STEFFEN_CART_ENABLED: verifica que el carrito no aparece en ninguna página pública y
// que la ruta de cotización responde 404. Usa Supabase local, otra carpeta de build y otro puerto.
//   npm run test:e2e:carrito-apagado

const PORT = 3101;

export default defineConfig({
  testDir: './e2e',
  testMatch: /carrito-apagado\.spec\.ts$/,
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: [['list']],
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: { baseURL: `http://localhost:${PORT}`, locale: 'es-AR', ...devices['Desktop Chrome'] },
  webServer: {
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}/tienda`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      NEXT_DIST_DIR: '.next-e2e-off',
      NEXT_PUBLIC_SUPABASE_URL: LOCAL_SUPABASE.url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: LOCAL_SUPABASE.publishableKey,
      // explícitamente apagado (aunque la variable existiera en el entorno de quien corre las pruebas)
      STEFFEN_CART_ENABLED: '0',
      // con la clave de servidor presente: el checkout tiene que quedar oculto por el interruptor, no por falta de clave
      SUPABASE_SECRET_KEY: localSecretKey(),
    },
  },
});
