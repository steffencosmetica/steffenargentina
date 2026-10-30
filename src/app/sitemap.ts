import type { MetadataRoute } from 'next';
import { CATEGORIAS, SITE_URL } from '@/lib/site';

export default function sitemap(): MetadataRoute.Sitemap {
  const paginas = ['/', '/productos', ...CATEGORIAS.map((c) => c.href), '/catalogo'];
  return paginas.map((path) => ({
    url: `${SITE_URL}${path === '/' ? '' : path}`,
    changeFrequency: 'monthly',
    priority: path === '/' ? 1 : 0.7,
  }));
}
