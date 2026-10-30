import type { Metadata } from 'next';
import Link from 'next/link';
import '@/styles/style.css';
import SiteShell from '@/components/layout/SiteShell';
import { SITE_NAME } from '@/lib/site';

export const metadata: Metadata = {
  title: `Página no encontrada | ${SITE_NAME}`,
  robots: { index: false },
  icons: { icon: '/img/logito.png' },
};

const FONT = 'https://fonts.googleapis.com/css2?family=Montserrat:wght@400;700&display=swap';

// 404 para cualquier URL que no exista; reutiliza el aviso de las páginas en construcción
export default function GlobalNotFound() {
  return (
    <SiteShell fontHref={FONT} footerYear={2025}>
      <section className="construccion">
        <div className="texto">
          <h1>PAGINA NO ENCONTRADA</h1>
          <h2>
            <Link href="/">Volver al inicio</Link>
          </h2>
        </div>
      </section>
    </SiteShell>
  );
}
