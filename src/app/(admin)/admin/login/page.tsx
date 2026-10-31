import type { Metadata } from 'next';
import LoginForm from '@/components/admin/LoginForm';
import { safeNextPath } from '@/lib/admin/routes';

export const metadata: Metadata = { title: 'Iniciar sesión' };

const MOTIVOS: Record<string, { kind: 'info' | 'warning'; text: string }> = {
  expirada: { kind: 'warning', text: 'Tu sesión expiró. Volvé a iniciar sesión para continuar.' },
  'sin-permiso': { kind: 'warning', text: 'Esa cuenta no tiene acceso al panel de administración.' },
  salida: { kind: 'info', text: 'Cerraste sesión correctamente.' },
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const motivo = typeof params.motivo === 'string' ? MOTIVOS[params.motivo] : undefined;
  const next = typeof params.next === 'string' ? safeNextPath(params.next) : undefined;

  return (
    <main className="adm-login">
      <div className="adm-card adm-login-card">
        <div className="adm-card-body">
          <div className="adm-login-brand">
            <img src="/img/logito.png" alt="" width={56} height={56} />
            <h1>Panel de administración</h1>
            <p>Steffen Cosmética Capilar</p>
          </div>
          <LoginForm next={next} notice={motivo} />
        </div>
      </div>
    </main>
  );
}
