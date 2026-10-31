import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  // los previews de Vercel no se indexan (además responden con X-Robots-Tag: noindex, ver next.config.ts)
  if (process.env.VERCEL_ENV === 'preview' || process.env.VERCEL_ENV === 'development') {
    return { rules: { userAgent: '*', disallow: '/' } };
  }
  return {
    // el panel de administración además responde con X-Robots-Tag: noindex (src/proxy.ts)
    rules: { userAgent: '*', allow: '/', disallow: '/admin' },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
