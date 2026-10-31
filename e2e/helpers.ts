import { expect, type BrowserContext, type Page } from '@playwright/test';

export const ADMIN_STATE = 'e2e/.auth/admin.json';

export async function login(page: Page, email: string, password: string) {
  await page.goto('/admin/login');
  await page.getByLabel('Email').fill(email);
  await page.getByLabel('Contraseña').fill(password);
  await page.getByRole('button', { name: 'Ingresar' }).click();
}

export async function loginAsAdmin(page: Page, email: string, password: string) {
  await login(page, email, password);
  await expect(page).toHaveURL(/\/admin\/productos$/);
  await expect(page.getByRole('heading', { name: 'Productos', level: 1 })).toBeVisible();
}

// ---------------------------------------------------------------------------
// Cookies de sesión de Supabase (sb-<ref>-auth-token, posiblemente partida en .0, .1…)
// ---------------------------------------------------------------------------

export async function authCookies(context: BrowserContext) {
  const cookies = await context.cookies();
  return cookies
    .filter((c) => /^sb-.+-auth-token(\.\d+)?$/.test(c.name))
    .sort((a, b) => a.name.localeCompare(b.name, 'en', { numeric: true }));
}

type Session = { access_token: string; refresh_token: string; expires_at: number; [key: string]: unknown };

export async function readSession(context: BrowserContext): Promise<Session> {
  const cookies = await authCookies(context);
  if (!cookies.length) throw new Error('No hay cookie de sesión');
  const raw = cookies.map((c) => c.value).join('');
  const json = raw.startsWith('base64-') ? Buffer.from(raw.slice(7), 'base64url').toString('utf8') : decodeURIComponent(raw);
  return JSON.parse(json);
}

/** Reemplaza la sesión guardada en las cookies (para simular un token vencido o revocado). */
export async function writeSession(context: BrowserContext, session: Session) {
  const cookies = await authCookies(context);
  const [first] = cookies;
  const base = first.name.replace(/\.\d+$/, '');
  await context.clearCookies({ name: new RegExp(`^${base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}`) });
  await context.addCookies([
    {
      name: base,
      value: 'base64-' + Buffer.from(JSON.stringify(session), 'utf8').toString('base64url'),
      domain: first.domain,
      path: first.path,
      httpOnly: first.httpOnly,
      secure: first.secure,
      sameSite: first.sameSite,
      expires: first.expires,
    },
  ]);
}

/** PNG de 1×1 válido con un color, para probar subidas sin archivos externos. */
export function tinyPng(rgb: [number, number, number]) {
  // PNG mínimo armado a mano: firma + IHDR + IDAT (zlib sin compresión) + IEND
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.from([0, 0, 0, 1, 0, 0, 0, 1, 8, 2, 0, 0, 0]);
  const raw = Buffer.from([0, ...rgb]);
  const adler = (() => {
    let a = 1;
    let b = 0;
    for (const x of raw) {
      a = (a + x) % 65521;
      b = (b + a) % 65521;
    }
    const out = Buffer.alloc(4);
    out.writeUInt32BE(((b << 16) | a) >>> 0);
    return out;
  })();
  const zlib = Buffer.concat([Buffer.from([0x78, 0x01, 0x01, raw.length, 0, ~raw.length & 0xff, 0xff]), raw, adler]);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}
