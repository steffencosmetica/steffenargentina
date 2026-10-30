import type { NextConfig } from 'next';

// Páginas del sitio original (.html) que ahora viven en rutas limpias
const paginasHtml = [
  'productos',
  'reparadores',
  'biphases',
  'triples',
  'shampoos',
  'cremas',
  'finishing',
  'catalogo',
];

const nextConfig: NextConfig = {
  // Servidor autónomo para poder empaquetarlo en Docker (Dokploy)
  output: 'standalone',
  poweredByHeader: false,
  experimental: {
    // El sitio tiene dos layouts raíz (inicio y secciones), así que el 404 necesita el suyo propio
    globalNotFound: true,
  },
  async redirects() {
    return [
      { source: '/index.html', destination: '/', statusCode: 301 },
      // el contacto ya vivía en el inicio: contacto.html redirigía a index.html#contacto
      { source: '/contacto.html', destination: '/#contacto', statusCode: 301 },
      { source: '/contacto', destination: '/#contacto', statusCode: 301 },
      ...paginasHtml.map((pagina) => ({
        source: `/${pagina}.html`,
        destination: `/${pagina}`,
        statusCode: 301 as const,
      })),
    ];
  },
};

export default nextConfig;
