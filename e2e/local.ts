import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
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

/** Ejecuta SQL en la base LOCAL. Se niega a correr contra cualquier otro host. */
export function localSql(sql: string): unknown[] {
  const host = new URL(LOCAL_SUPABASE.dbUrl).hostname;
  if (host !== '127.0.0.1' && host !== 'localhost') throw new Error(`localSql solo corre contra la base local (recibió ${host})`);

  const dir = mkdtempSync(join(tmpdir(), 'steffen-e2e-'));
  const file = join(dir, 'q.sql');
  writeFileSync(file, sql);
  try {
    const out = execFileSync('npx', ['supabase', 'db', 'query', '--db-url', LOCAL_SUPABASE.dbUrl, '-f', file, '--output-format', 'json'], {
      encoding: 'utf8',
      shell: process.platform === 'win32',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    // las sentencias sin resultado (DO, INSERT…) no imprimen JSON
    const start = out.indexOf('{');
    if (start === -1 || !out.trim()) return [];
    const parsed = JSON.parse(out.slice(start));
    return parsed.rows ?? [];
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
