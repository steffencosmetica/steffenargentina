import AdminShell from '@/components/admin/AdminShell';
import { requireAdminPage } from '@/lib/admin/guard';

// Todo lo que está dentro de (panel) exige una sesión de administrador.
// El proxy ya filtró la request; esta verificación es la que manda (getUser + is_admin).
export default async function PanelLayout({ children }: { children: React.ReactNode }) {
  const { user } = await requireAdminPage();
  return <AdminShell email={user.email ?? 'Administrador'}>{children}</AdminShell>;
}
