import type { MetadataRoute } from 'next';
import { CATEGORIAS, SITE_URL } from '@/lib/site';
import { listStoreProducts } from '@/lib/catalog/queries';
import { isSupabaseConfigured } from '@/lib/supabase/env';

// Productos de la tienda: solo los activos de categorías activas (lo mismo que ve un visitante).
// La consulta queda cacheada con el tag "catalogo", así que el sitemap se renueva con el panel.
async function productos(): Promise<MetadataRoute.Sitemap> {
  if (!isSupabaseConfigured()) return [];
  try {
    return (await listStoreProducts()).map((p) => ({
      url: `${SITE_URL}/tienda/${p.slug}`,
      lastModified: new Date(p.updatedAt),
      changeFrequency: 'weekly',
      priority: 0.6,
    }));
  } catch (error) {
    // sin Supabase el sitemap sigue publicando las páginas institucionales
    console.error('Sitemap sin productos de la tienda:', error instanceof Error ? error.message : error);
    return [];
  }
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const paginas = ['/', '/productos', ...CATEGORIAS.map((c) => c.href), '/catalogo'];
  const institucionales: MetadataRoute.Sitemap = paginas.map((path) => ({
    url: `${SITE_URL}${path === '/' ? '' : path}`,
    changeFrequency: 'monthly',
    priority: path === '/' ? 1 : 0.7,
  }));
  const tienda: MetadataRoute.Sitemap = [{ url: `${SITE_URL}/tienda`, changeFrequency: 'daily', priority: 0.8 }];
  return [...institucionales, ...tienda, ...(await productos())];
}
