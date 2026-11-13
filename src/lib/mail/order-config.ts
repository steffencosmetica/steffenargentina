type Env = Record<string,string|undefined>;
export function orderOfficeEnabled(env: Env) {
  return env.STEFFEN_ORDER_COMMS === '1' && !env.VERCEL && !env.VERCEL_ENV
    && ['http://localhost:55321','http://127.0.0.1:55321'].includes(env.NEXT_PUBLIC_SUPABASE_URL ?? '');
}
export function orderMailEnabled(env: Env) {
  if (!orderOfficeEnabled(env) || env.MAIL_TRANSPORT !== 'archivo') return false;
  try { const u=new URL(env.MAIL_LINK_BASE_URL??'');
    return u.protocol==='http:' && ['localhost','127.0.0.1'].includes(u.hostname)
      && u.origin===env.MAIL_LINK_BASE_URL && !u.username && !u.password;
  } catch { return false; }
}
