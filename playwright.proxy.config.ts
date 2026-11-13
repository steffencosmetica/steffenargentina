import { defineConfig } from '@playwright/test';
import { LOCAL_SUPABASE, PROXY_E2E, localSecretKey } from './e2e/local';

// Build de Next en modo STEFFEN_TRUSTED_PROXY=traefik detrás de Traefik REAL (Docker), contra Supabase local.
//   npx playwright test --config playwright.proxy.config.ts
// Las requests las hacen contenedores curl con IPs distintas dentro de la red Docker del arnés. Los clientes
// usan direcciones privadas de esa red, por eso SOLO este build define STEFFEN_PROXY_ALLOW_PRIVATE_CLIENTS=1.
// El arrepentimiento se enciende para ejercitar la IP en una operación real. Además sirve de regresión del
// enclavamiento 4B.8: carrito encendido y clave de servidor presentes, pero páginas legales APAGADAS → sin checkout.

export default defineConfig({
  testDir: './e2e',
  testMatch: /proxy-traefik\.spec\.ts$/,
  // carpeta propia: no borra los artefactos de fallos de las otras suites
  outputDir: 'test-results-proxy',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 90_000,
  reporter: [['list']],
  globalSetup: './e2e/proxy-global.ts',
  use: { baseURL: `http://localhost:${PROXY_E2E.port}`, trace: 'retain-on-failure' },
  webServer: {
    command: `npm run build && npm run start -- -p ${PROXY_E2E.port}`,
    url: `http://localhost:${PROXY_E2E.port}/tienda`,
    timeout: 240_000,
    reuseExistingServer: false,
    env: {
      NEXT_DIST_DIR: '.next-e2e-proxy',
      NEXT_PUBLIC_SUPABASE_URL: LOCAL_SUPABASE.url,
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: LOCAL_SUPABASE.publishableKey,
      SUPABASE_SECRET_KEY: localSecretKey(),
      STEFFEN_ORDER_COMMS: '0',
      MAIL_TRANSPORT: 'desactivado',
      STEFFEN_CART_ENABLED: '1',
      STEFFEN_LEGAL_PAGES: '0',
      STEFFEN_REVOCATION_ENABLED: '1',
      STEFFEN_TRUSTED_PROXY: 'traefik',
      STEFFEN_PROXY_SECRET: PROXY_E2E.secret,
      STEFFEN_PROXY_ALLOW_PRIVATE_CLIENTS: '1',
      STEFFEN_PROXY_DIAGNOSTIC_TOKEN: PROXY_E2E.diagnosticToken,
    },
  },
});
