import type { Metadata } from 'next';
import '@/styles/style.css';
import SiteShell from '@/components/layout/SiteShell';
import { baseMetadata } from '@/lib/metadata';

export const metadata: Metadata = baseMetadata;

// Las páginas de productos y catálogo cargan solo los pesos 400 y 700, como en el sitio original
const FONT_SECCIONES = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&display=swap';

export default function SeccionesLayout({ children }: { children: React.ReactNode }) {
  return (
    <SiteShell fontHref={FONT_SECCIONES} footerYear={2025}>
      {children}
    </SiteShell>
  );
}
