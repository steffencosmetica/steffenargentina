import type { Metadata } from 'next';
import { preload } from 'react-dom';
import '@/styles/montserrat.css';
import '@/styles/style.css';
import '@/styles/tienda.css';
import SiteShell from '@/components/layout/SiteShell';
import { baseMetadata } from '@/lib/metadata';

export const metadata: Metadata = baseMetadata;

// Layout raíz propio de la tienda: comparte header, footer y estilos con el sitio institucional,
// pero sus páginas no tocan ninguna del inicio ni de las secciones.
// Montserrat se sirve desde el propio sitio (montserrat.css) en lugar de Google Fonts: la tienda
// se pinta antes en celulares con conexión lenta.
export default function TiendaLayout({ children }: { children: React.ReactNode }) {
  preload('/fonts/montserrat-latin.woff2', { as: 'font', type: 'font/woff2', crossOrigin: 'anonymous' });
  return <SiteShell footerYear={2025}>{children}</SiteShell>;
}
