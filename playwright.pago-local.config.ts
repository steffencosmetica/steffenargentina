import { defineConfig, devices } from '@playwright/test';
import { LOCAL_SUPABASE, localSecretKey, MOCK_WEBHOOK_FIXTURE } from './e2e/local';

const origin = 'http://localhost:3103';

export default defineConfig({
  testDir: './e2e',
  testMatch: /checkout\.spec\.ts$/,
  grep: /@pago-local/,
  outputDir: 'test-results-pago-local',
  workers: 1,
  retries: 0,
  timeout: 45_000,
  expect: { timeout: 10_000 },
  globalSetup: './e2e/global-setup.ts',
  globalTeardown: './e2e/global-teardown.ts',
  use: { baseURL: origin, locale: 'es-AR', trace: 'retain-on-failure' },
  projects: [
    { name: 'pago-desktop', use: devices['Desktop Chrome'] },
    { name: 'pago-mobile', use: devices['Pixel 7'] },
  ],
  webServer: {
    command: 'npm run dev -- --hostname localhost --port 3103',
    url: origin + '/tienda',
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      NEXT_DIST_DIR: '.next-e2e-pago-local',
      NEXT_PUBLIC_SUPABASE_URL: LOCAL_SUPABASE.url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: LOCAL_SUPABASE.publishableKey,
      SUPABASE_SECRET_KEY: localSecretKey(),
      STEFFEN_CART_ENABLED: '1',
      STEFFEN_LEGAL_PAGES: '1',
      STEFFEN_REVOCATION_ENABLED: '1',
      STEFFEN_MP_MODE: 'mock',
      STEFFEN_MP_LOCAL_ORIGIN: origin,
      STEFFEN_MP_RECONCILIATION: '1',
      STEFFEN_MP_AFTER_SALES: '1',
      STEFFEN_MP_MOCK_WEBHOOK_SECRET: MOCK_WEBHOOK_FIXTURE,
    },
  },
});
