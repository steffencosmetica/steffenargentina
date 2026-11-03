import { execFileSync } from 'node:child_process';

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
