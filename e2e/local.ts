import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// Supabase local levantado con `npm run db:start` (puertos de supabase/config.toml).
// La clave publicable se lee de `supabase status` del stack local en ejecución: no hay claves en el repo.
let localKey: string | undefined;

export const LOCAL_SUPABASE = {
  url: 'http://127.0.0.1:55321',
  dbUrl: 'postgresql://postgres:postgres@127.0.0.1:55322/postgres',
  get publishableKey() {
    if (!localKey) {
      const out = execFileSync('npx', ['supabase', 'status', '-o', 'json'], {
        encoding: 'utf8',
        shell: process.platform === 'win32',
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      const status = JSON.parse(out.slice(out.indexOf('{')));
      if (status.API_URL !== 'http://127.0.0.1:55321' || !status.PUBLISHABLE_KEY) {
        throw new Error('Supabase local no está levantado (npm run db:start).');
      }
      localKey = status.PUBLISHABLE_KEY as string;
    }
    return localKey;
  },
};

// Usuarios que global-setup crea solo en la base local. Las contraseñas se generan al azar en cada
// corrida (global-setup las deja en process.env, que heredan los workers): no hay ninguna escrita en el repo.
export const ADMIN = {
  email: 'admin@steffen.test',
  get password() {
    return requiredEnv('E2E_ADMIN_PASSWORD');
  },
};
export const CLIENTE = {
  email: 'cliente@steffen.test',
  get password() {
    return requiredEnv('E2E_CLIENTE_PASSWORD');
  },
};

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`${name} no está definida: la genera e2e/global-setup.ts`);
  return value;
}

/** Clave secreta del stack LOCAL (para el checkout en las pruebas). Se lee de `supabase status`, nunca del repo. */
let localSecret: string | undefined;
export function localSecretKey(): string {
  if (!localSecret) {
    const out = execFileSync('npx', ['supabase', 'status', '-o', 'json'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    const status = JSON.parse(out.slice(out.indexOf('{')));
    if (status.API_URL !== LOCAL_SUPABASE.url || !status.SECRET_KEY) throw new Error('Supabase local no está levantado (npm run db:start).');
    localSecret = status.SECRET_KEY as string;
  }
  return localSecret;
}

/** Texto que hay que escribir para confirmar que se habilita el checkout en ESTA base (scripts/checkout-local.ts). */
export function localCheckoutConfirmation(): string {
  const db = new URL(LOCAL_SUPABASE.dbUrl);
  return `local:${db.hostname}:${db.port}`;
}

/**
 * Habilita o deshabilita las compras SOLO en la base local (store_settings.checkout_enabled). Lo cambia el rol
 * postgres, el único que el trigger store_settings_bloquear_checkout deja; localSql no corre contra otro host.
 * Supabase Cloud no se toca nunca desde acá.
 */
export function setLocalCheckout(enabled: boolean): void {
  localSql(`update public.store_settings set checkout_enabled = ${enabled ? 'true' : 'false'} where id`);
}

export function localCheckoutEnabled(): boolean {
  const rows = localSql('select checkout_enabled from public.store_settings where id') as { checkout_enabled: boolean }[];
  return rows[0]?.checkout_enabled === true;
}

/** Ejecuta SQL en la base LOCAL. Se niega a correr contra cualquier otro host. */
export function localSql(sql: string): unknown[] {
  const host = new URL(LOCAL_SUPABASE.dbUrl).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`localSql solo corre contra la base local (recibió ${host})`);

  // El CLI db query puede fallar al abrir conexiones durante las carreras del checkout.
  // psql usa el mismo contenedor local que la suite de concurrencia, sin shell ni archivos temporales.
  // Los SELECT de los fixtures devuelven filas JSON; las mutaciones y bloques DO no devuelven filas.
  const select = /^\s*select\b/i.test(sql);
  const input = select
    ? `select coalesce(json_agg(row_to_json(fixture_rows)), '[]'::json) from (${sql.replace(/;\s*$/, '')}) fixture_rows;`
    : sql;
  const out = execFileSync('docker', ['exec', '-i', 'supabase_db_steffen-web', 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-Atq', '-v', 'ON_ERROR_STOP=1'], {
    input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'],
  });
  return select ? JSON.parse(out.trim()) : [];
}

/**
 * Correo de las pruebas (Fase 4B.7): transporte «archivo», que escribe cada email como JSON en una carpeta
 * local y nunca abre conexiones de red. El token del monitor es un valor fijo SOLO de pruebas locales.
 */
export const MAIL_E2E = {
  captureDir: join(process.cwd(), '.mail-capturas-e2e'),
  from: 'Steffen Cosmética Capilar <info@steffenargentina.com.ar>',
  linkBaseUrl: 'http://localhost:3100',
  healthToken: 'e2e-monitor-local-0123456789abcdefghijklmnop',
};

export function mailEnv(): Record<string, string> {
  return {
    MAIL_TRANSPORT: 'archivo',
    MAIL_CAPTURE_DIR: MAIL_E2E.captureDir,
    MAIL_FROM: MAIL_E2E.from,
    MAIL_LINK_BASE_URL: MAIL_E2E.linkBaseUrl,
    MAIL_HEALTH_TOKEN: MAIL_E2E.healthToken,
  };
}

/** Valor ficticio (no es un secreto) que se pasa como MAIL_SMTP_PASSWORD al build de pruebas para auditar el bundle. */
export const SMTP_CANARY = 'canario-smtp-no-es-secreto-4b7';

/**
 * Arnés de Traefik real (Fase 4B.8): red Docker propia con un Traefik bien configurado, otro deliberadamente
 * mal configurado (forwardedHeaders.insecure) y clientes con IPs distintas. El secreto es un valor fijo SOLO
 * de pruebas locales (no es una credencial).
 */
export const PROXY_E2E = {
  port: 3102,
  network: 'steffen-proxy-e2e',
  subnet4: '172.31.250.0/24',
  subnet6: 'fd5e:12::/64',
  traefikImage: 'traefik:v3.5.6',
  curlImage: 'curlimages/curl:8.16.0',
  traefik: { name: 'steffen-proxy-traefik', ip4: '172.31.250.2', ip6: 'fd5e:12::2' },
  insecure: { name: 'steffen-proxy-traefik-inseguro', ip4: '172.31.250.3' },
  clients: { a: '172.31.250.11', b: '172.31.250.12', c6: 'fd5e:12::13' },
  secret: 'e2e-proxy-traefik-local-0123456789abcdefghij',
  diagnosticToken: 'e2e-diagnostico-proxy-local-0123456789abcdef',
};
