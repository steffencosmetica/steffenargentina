import type { Metadata } from 'next';
import '@/styles/style.css';
import SiteShell from '@/components/layout/SiteShell';
import { baseMetadata } from '@/lib/metadata';

export const metadata: Metadata = baseMetadata;

// El inicio pide más pesos e itálicas de Montserrat que el resto de las páginas
const FONT_INICIO =
  'https://fonts.googleapis.com/css2?family=Montserrat:ital,wght@0,300;0,400;0,500;0,700;0,800;1,300;1,400&display=swap';

export default function InicioLayout({ children }: { children: React.ReactNode }) {
  return (
    <SiteShell fontHref={FONT_INICIO} footerYear={2024}>
      {children}
    </SiteShell>
  );
}
