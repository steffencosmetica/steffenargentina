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

// Fotos del catálogo: solo el bucket público "catalogo" del proyecto de Supabase configurado.
// Sin la variable (por ejemplo, en un build del sitio institucional solo) no se permite ningún host.
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL) : null;
const catalogoImages = supabaseUrl
  ? [
      {
        protocol: supabaseUrl.protocol.replace(':', '') as 'http' | 'https',
        hostname: supabaseUrl.hostname,
        port: supabaseUrl.port,
        pathname: '/storage/v1/object/public/catalogo/**',
      },
    ]
  : [];
// Supabase local (pruebas e2e) sirve las fotos desde 127.0.0.1, que Next bloquea por defecto.
// Se habilita solo cuando el propio Supabase configurado es local; en producción queda bloqueado.
const supabaseLocal = supabaseUrl?.hostname === '127.0.0.1' || supabaseUrl?.hostname === 'localhost';

// Los previews de Vercel no se indexan; producción (Vercel o Dokploy) sí
const isPreview = process.env.VERCEL_ENV === 'preview' || process.env.VERCEL_ENV === 'development';

const nextConfig: NextConfig = {
  // Servidor autónomo para poder empaquetarlo en Docker (Dokploy)
  output: 'standalone',
  // las pruebas end-to-end compilan contra Supabase local en otra carpeta, para no pisar el build real
  distDir: process.env.NEXT_DIST_DIR || '.next',
  poweredByHeader: false,
  images: {
    remotePatterns: catalogoImages,
    formats: ['image/avif', 'image/webp'],
    qualities: [75],
    // cada subida tiene una ruta nueva (UUID), así que una foto optimizada nunca queda vieja
    minimumCacheTTL: 2678400,
    dangerouslyAllowLocalIP: supabaseLocal,
  },
  async headers() {
    return isPreview ? [{ source: '/:path*', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] }] : [];
  },
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
