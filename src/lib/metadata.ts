import type { Metadata } from 'next';
import { SITE_DESCRIPTION, SITE_NAME, SITE_URL } from './site';

// Metadata común a todas las páginas institucionales
export const baseMetadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: SITE_NAME,
    template: `%s | ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  icons: { icon: '/img/logito.png' },
  openGraph: {
    type: 'website',
    locale: 'es_AR',
    siteName: SITE_NAME,
    images: [{ url: '/video/hero-fondo-poster.jpg' }],
  },
};

// Título, descripción y URL canónica de una página
export function pageMetadata(title: string, description: string, path: string): Metadata {
  return {
    title,
    description,
    alternates: { canonical: path },
    // openGraph no se combina con el del layout, así que se repiten los datos comunes
    openGraph: { ...baseMetadata.openGraph, title: `${title} | ${SITE_NAME}`, description, url: path },
  };
}
