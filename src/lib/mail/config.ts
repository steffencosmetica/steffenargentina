// Configuración del correo saliente, leída de variables de entorno de SERVIDOR (nunca NEXT_PUBLIC_).
//
//   MAIL_TRANSPORT = desactivado (predeterminado) | archivo | smtp
//     desactivado: no se envía nada; las comunicaciones quedan pendientes en la base (duraderas).
//     archivo:     desarrollo y pruebas. Escribe cada mensaje como JSON en MAIL_CAPTURE_DIR; nunca sale a la red.
//     smtp:        Zoho (Mail o ZeptoMail/CPaaS). Exige MAIL_ALLOW_REAL_SEND=1 para evitar envíos reales por error.
//
// Ver docs/zoho-correo.md. Las credenciales SMTP son de una casilla/servicio dedicado, nunca una contraseña personal.

export type MailConfig =
  | { transport: 'desactivado' }
  | { transport: 'archivo'; captureDir: string; from: string; replyTo?: string; linkBaseUrl: string }
  | {
      transport: 'smtp';
      from: string;
      replyTo?: string;
      linkBaseUrl: string;
      smtp: { host: string; port: number; secure: boolean; user: string; password: string };
    };

export type MailConfigResult = { ok: true; config: MailConfig } | { ok: false; error: string };

const ADDRESS = /^(?:[^<>@\r\n]*<)?[^\s<>@]+@[^\s<>@]+\.[^\s<>@]+>?$/;

export function fromDomain(from: string): string {
  const match = /@([^\s<>@]+?)>?$/.exec(from.trim());
  return match ? match[1].toLowerCase() : 'localhost';
}

export function mailConfigFromEnv(env: Record<string, string | undefined>): MailConfigResult {
  const transport = (env.MAIL_TRANSPORT ?? 'desactivado').trim() || 'desactivado';
  if (transport === 'desactivado') return { ok: true, config: { transport } };
  const from = env.MAIL_FROM?.trim() ?? '';
  if (!ADDRESS.test(from)) return { ok: false, error: 'MAIL_FROM no es una dirección válida' };
  const replyTo = env.MAIL_REPLY_TO?.trim() || undefined;
  if (replyTo && !ADDRESS.test(replyTo)) return { ok: false, error: 'MAIL_REPLY_TO no es una dirección válida' };
  const linkBaseUrl = (env.MAIL_LINK_BASE_URL ?? '').trim();
  let link: URL;
  try {
    link = new URL(linkBaseUrl);
  } catch {
    return { ok: false, error: 'MAIL_LINK_BASE_URL no es una URL válida' };
  }
  const localLink = ['localhost', '127.0.0.1'].includes(link.hostname);
  if (link.protocol !== 'https:' && !localLink) return { ok: false, error: 'MAIL_LINK_BASE_URL debe usar https' };

  let supabaseHost = '';
  try {
    supabaseHost = new URL(env.NEXT_PUBLIC_SUPABASE_URL ?? '').hostname.toLowerCase();
  } catch {
    return { ok: false, error: 'Falta NEXT_PUBLIC_SUPABASE_URL' };
  }
  const localSupabase = supabaseHost === '127.0.0.1' || supabaseHost === 'localhost';

  if (transport === 'archivo') {
    if (env.VERCEL) return { ok: false, error: 'El transporte archivo no se usa en Vercel' };
    // Escribe emails (con enlaces privados) en disco: solo con la base local de desarrollo.
    if (!localSupabase) return { ok: false, error: 'El transporte archivo solo se usa con Supabase local' };
    const captureDir = env.MAIL_CAPTURE_DIR?.trim();
    if (!captureDir) return { ok: false, error: 'Falta MAIL_CAPTURE_DIR' };
    return { ok: true, config: { transport, captureDir, from, replyTo, linkBaseUrl } };
  }
  if (transport === 'smtp') {
    if (env.MAIL_ALLOW_REAL_SEND !== '1') return { ok: false, error: 'SMTP exige MAIL_ALLOW_REAL_SEND=1 (protección contra envíos reales accidentales)' };
    if (localLink) return { ok: false, error: 'SMTP no se usa con enlaces locales' };
    // Nunca correos reales con datos de prueba de la base local.
    if (localSupabase) return { ok: false, error: 'SMTP no se usa con Supabase local' };
    // Atadura explícita al proyecto: el ejecutor no procesa la cola de otro proyecto por un .env equivocado.
    const expected = (env.MAIL_SUPABASE_HOST ?? '').trim().toLowerCase();
    if (!expected || expected !== supabaseHost) return { ok: false, error: 'MAIL_SUPABASE_HOST no coincide con el proyecto de Supabase configurado' };
    const host = env.MAIL_SMTP_HOST?.trim() ?? '';
    const port = Number(env.MAIL_SMTP_PORT ?? '465');
    const secure = (env.MAIL_SMTP_SECURE ?? (port === 465 ? 'true' : 'false')) === 'true';
    const user = env.MAIL_SMTP_USER?.trim() ?? '';
    const password = env.MAIL_SMTP_PASSWORD ?? '';
    if (!/^[a-z0-9.-]+$/i.test(host)) return { ok: false, error: 'Falta MAIL_SMTP_HOST' };
    if (![465, 587].includes(port)) return { ok: false, error: 'MAIL_SMTP_PORT debe ser 465 (SSL) o 587 (STARTTLS)' };
    if (!user || !password) return { ok: false, error: 'Faltan MAIL_SMTP_USER o MAIL_SMTP_PASSWORD' };
    return { ok: true, config: { transport, from, replyTo, linkBaseUrl, smtp: { host, port, secure, user, password } } };
  }
  return { ok: false, error: 'MAIL_TRANSPORT no reconocido' };
}
