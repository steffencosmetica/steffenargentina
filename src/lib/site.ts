// Datos compartidos del sitio institucional

export const SITE_URL = 'https://steffenargentina.com.ar';
export const SITE_NAME = 'Steffen Cosmética Capilar';
export const SITE_DESCRIPTION =
  'Steffen Cosmética Capilar: más de 20 años desarrollando y fabricando en Argentina productos profesionales para el cuidado del cabello. Serums, bi-phases, emulsiones Triple Acción, shampoos, máscaras y finishing.';

export const WHATSAPP_URL = 'http://wa.link/vwkmy1';
export const WHATSAPP_NUMERO = '+54 9 223-559-0428';
export const EMAIL = 'info@steffenargentina.com.ar';
export const FACEBOOK_URL = 'http://www.facebook.com/www.steffenargentina.com.ar';
export const INSTAGRAM_URL = 'https://instagram.com/steffencosmetica/';
export const PORTAL_PROFESIONAL_URL = 'https://steffenprofesional.com';
export const FORMSPREE_URL = 'https://formspree.io/f/xlgwnnab';

// El PDF conserva su nombre y ruta originales porque puede estar compartido por fuera del sitio
export const CATALOGO_PDF = '/img/CATALOGO%20STEFFEN%20COSMETICA%20CAPILAR%202025.pdf';

// Menú de categorías (vertical, a la izquierda) de las páginas de productos
export const CATEGORIAS = [
  { href: '/reparadores', label: 'Serums' },
  { href: '/biphases', label: 'Bi-Phases' },
  { href: '/triples', label: 'Triple Acción' },
  { href: '/shampoos', label: 'Shampoos / Acondicionadores' },
  { href: '/cremas', label: 'Máscaras Capilares' },
  { href: '/finishing', label: 'Finishing' },
] as const;

export type CategoriaHref = (typeof CATEGORIAS)[number]['href'];
