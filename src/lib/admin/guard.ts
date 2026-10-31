import 'server-only';
import { redirect } from 'next/navigation';
import { AdminAuthError, requireAdmin } from '@/lib/catalog/admin';
import { loginPath } from './routes';

/** requireAdmin() para páginas: si no hay sesión de administrador, redirige al login. */
export async function requireAdminPage() {
  try {
    return await requireAdmin();
  } catch (error) {
    if (error instanceof AdminAuthError) {
      redirect(loginPath({ reason: error.message.includes('permisos') ? 'sin-permiso' : 'expirada' }));
    }
    throw error;
  }
}
