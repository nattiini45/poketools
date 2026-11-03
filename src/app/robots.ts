import type { MetadataRoute } from 'next';
import { ROBOTS_DISALLOW } from '@/lib/seo/robots';
import { siteUrl } from '@/lib/site-url';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: '*', allow: '/', disallow: [...ROBOTS_DISALLOW] },
    sitemap: new URL('/sitemap.xml', siteUrl()).toString(),
  };
}
