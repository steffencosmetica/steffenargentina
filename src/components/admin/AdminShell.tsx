'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { logoutAction } from '@/app/(admin)/admin/auth-actions';
import { IconBox, IconClose, IconLogout, IconMenu, IconTag } from './icons';

const NAV = [
  { href: '/admin/productos', label: 'Productos', Icon: IconBox },
  { href: '/admin/categorias', label: 'Categorías', Icon: IconTag },
];

function Brand() {
  return (
    <Link href="/admin/productos" className="adm-brand">
      <img src="/img/logito.png" alt="" width={34} height={34} />
      <div>
        <strong>STEFFEN</strong>
        <span>Administración</span>
      </div>
    </Link>
  );
}

/** Estructura del panel: sidebar fija en desktop; en mobile, barra superior con menú desplegable. */
export default function AdminShell({ email, children }: { email: string; children: React.ReactNode }) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);

  // al navegar se cierra el menú mobile
  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  return (
    <div className="adm-app" data-menu={open ? 'open' : 'closed'}>
      <header className="adm-topbar">
        <Brand />
        <button
          type="button"
          className="adm-icon-btn"
          aria-label={open ? 'Cerrar menú' : 'Abrir menú'}
          aria-expanded={open}
          aria-controls="adm-sidebar"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? <IconClose /> : <IconMenu />}
        </button>
      </header>

      <aside className="adm-sidebar" id="adm-sidebar" aria-label="Menú del panel">
        <Brand />
        <nav className="adm-nav" aria-label="Secciones">
          {NAV.map(({ href, label, Icon }) => (
            <Link key={href} href={href} aria-current={pathname.startsWith(href) ? 'page' : undefined}>
              <Icon />
              {label}
            </Link>
          ))}
        </nav>
        <div className="adm-sidebar-footer">
          <div className="adm-user" title={email}>
            {email}
          </div>
          <form action={logoutAction}>
            <button type="submit" className="adm-btn adm-btn-sm adm-btn-ghost">
              <IconLogout /> Cerrar sesión
            </button>
          </form>
        </div>
      </aside>

      <button type="button" className="adm-backdrop" aria-label="Cerrar menú" tabIndex={-1} onClick={() => setOpen(false)} />

      <main className="adm-main" id="contenido">
        {children}
      </main>
    </div>
  );
}
