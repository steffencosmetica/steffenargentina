import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    // el panel de administración además responde con X-Robots-Tag: noindex (src/proxy.ts)
    rules: { userAgent: '*', allow: '/', disallow: '/admin' },
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
