import type { Metadata, Viewport } from 'next';
import '@/styles/admin.css';

// Layout raíz propio del panel: no comparte estilos ni componentes con el sitio institucional.
export const metadata: Metadata = {
  title: { default: 'Administración', template: '%s · Administración Steffen' },
  robots: { index: false, follow: false },
  icons: { icon: '/img/logito.png' },
};

export const viewport: Viewport = {
  themeColor: '#f7f6f3',
  colorScheme: 'light',
};

export default function AdminRootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es-AR">
      <body className="adm">{children}</body>
    </html>
  );
}
