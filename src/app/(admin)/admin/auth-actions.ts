'use server';

import { redirect } from 'next/navigation';
import { createSessionClient } from '@/lib/supabase/server';
import type { ActionState } from '@/lib/admin/action-state';
import { loginPath, safeNextPath } from '@/lib/admin/routes';

// Mismo mensaje para credenciales incorrectas y para cuentas sin permiso de administrador:
// no se revela qué emails existen ni cuáles tienen contraseña válida.
const INVALID = 'Email o contraseña incorrectos.';

export async function loginAction(_prev: ActionState, formData: FormData): Promise<ActionState> {
  const email = String(formData.get('email') ?? '').trim();
  const password = String(formData.get('password') ?? '');
  const next = safeNextPath(String(formData.get('next') ?? ''));

  const fieldErrors: Record<string, string> = {};
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fieldErrors.email = 'Ingresá un email válido.';
  if (!password) fieldErrors.password = 'Ingresá la contraseña.';
  if (Object.keys(fieldErrors).length) return { status: 'error', message: 'Revisá los datos ingresados.', fieldErrors };

  const supabase = await createSessionClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) {
    if (error.status === 429 || error.code === 'over_request_rate_limit') {
      return { status: 'error', message: 'Demasiados intentos. Esperá unos minutos y volvé a probar.' };
    }
    if (error.status && error.status >= 500) {
      console.error('Error de Supabase Auth en el login', error.status, error.code);
      return { status: 'error', message: 'El servicio de autenticación no responde. Intentá de nuevo en unos minutos.' };
    }
    return { status: 'error', message: INVALID };
  }

  const { data: isAdmin, error: rpcError } = await supabase.rpc('is_admin');
  if (rpcError || !isAdmin) {
    // la cuenta existe pero no administra el catálogo: se cierra la sesión recién creada
    await supabase.auth.signOut({ scope: 'local' });
    if (rpcError) console.error('No se pudo verificar el rol de administrador', rpcError.code);
    return { status: 'error', message: INVALID };
  }

  redirect(next);
}

export async function logoutAction() {
  const supabase = await createSessionClient();
  // scope local: cierra esta sesión; las de otros dispositivos siguen hasta que venzan
  await supabase.auth.signOut({ scope: 'local' });
  redirect(loginPath({ reason: 'salida' }));
}
