import { defineConfig, devices } from '@playwright/test';
import { LOCAL_SUPABASE, SMTP_CANARY, localSecretKey, mailEnv } from './e2e/local';

// Pruebas end-to-end del panel /admin.
// Corren SIEMPRE contra Supabase local (npm run db:start): la app se compila con la URL y la clave
// locales en una carpeta propia (.next-e2e), así que nunca usan .env.local ni el proyecto de Cloud.
// e2e/global-setup.ts carga los datos de prueba en la base local y e2e/global-teardown.ts los borra al terminar.

const PORT = 3100;

export default defineConfig({
  testDir: './e2e',
  // el carrito apagado se prueba con su propio build (playwright.carrito-apagado.config.ts)
  // el arnés de Traefik real necesita su red Docker y su propio build (playwright.proxy.config.ts)
  testIgnore: /(carrito-apagado|proxy-traefik)\.spec\.ts$/,
  grepInvert: /@pago-local/,
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
      // carrito visible solo en este build local (src/lib/cart/flag.ts exige además Supabase local y fuera de Vercel)
      STEFFEN_CART_ENABLED: '1',
      // checkout (Fase 4B.5): clave secreta del stack LOCAL, leída de `supabase status` (no está en el repo).
      // Las compras siguen deshabilitadas en la base salvo en e2e/checkout.spec.ts, que las activa y las restaura.
      SUPABASE_SECRET_KEY: localSecretKey(),
      // correo (Fase 4B.7): transporte a archivos locales, nunca SMTP real (ver e2e/local.ts)
      ...mailEnv(),
      // canario: si este valor aparece en los assets públicos, la auditoría del build falla
      MAIL_SMTP_PASSWORD: SMTP_CANARY,
      // páginas legales y Botón de Arrepentimiento: apagados por defecto, encendidos solo en este build local
      STEFFEN_LEGAL_PAGES: '1',
      STEFFEN_REVOCATION_ENABLED: '1',
      // Incluso con la configuración del simulador, next start tiene que dejarlo apagado.
      STEFFEN_MP_MODE: 'mock',
      STEFFEN_MP_LOCAL_ORIGIN: `http://localhost:${PORT}`,
    },
  },
});
