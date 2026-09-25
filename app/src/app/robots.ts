import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/constants';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: [
          '/api/',
          '/nanny/',
          '/parent/',
          '/admin/',
          '/login',
          '/signup',
          '/forgot-password',
          '/reset-password',
          // The six demo and test surfaces. They stay reachable and clickable
          // (Q-10, BAI 2026-09-25); each also carries `robots: { index: false }`
          // on its own layout, so a crawler is told twice. 12.09.
          '/test',
          '/ui',
          '/ui2',
          '/brandkit1',
          '/bb/test',
          '/nanny/profiletest',
        ],
      },
      {
        userAgent: 'GPTBot',
        disallow: '/',
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
  };
}
