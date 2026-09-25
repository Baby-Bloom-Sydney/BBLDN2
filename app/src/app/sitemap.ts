import type { MetadataRoute } from 'next';
import { createAdminClient } from '@/lib/supabase/admin';
import { SITE_URL } from '@/lib/constants';

const BASE_URL = SITE_URL;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const supabase = createAdminClient();

  // Fetch dynamic content in parallel
  const [nannyRes, bsrRes, positionRes] = await Promise.all([
    supabase
      .from('nannies')
      .select('id, updated_at')
      .eq('profile_visible', true),
    supabase
      .from('babysitting_requests')
      .select('id, updated_at')
      .eq('status', 'active'),
    supabase
      .from('nanny_positions')
      .select('id, updated_at')
      .eq('status', 'active'),
  ]);

  // Static pages
  const staticPages: MetadataRoute.Sitemap = [
    {
      url: BASE_URL,
      lastModified: new Date(),
      changeFrequency: 'weekly',
      priority: 1.0,
    },
    {
      url: `${BASE_URL}/nannies`,
      lastModified: new Date(),
      changeFrequency: 'daily',
      priority: 0.9,
    },
    {
      url: `${BASE_URL}/about`,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/pricing`,
      changeFrequency: 'monthly',
      priority: 0.8,
    },
    {
      url: `${BASE_URL}/childcare-professionals`,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    {
      url: `${BASE_URL}/contact`,
      changeFrequency: 'monthly',
      priority: 0.5,
    },
    {
      url: `${BASE_URL}/how-it-works`,
      changeFrequency: 'monthly',
      priority: 0.7,
    },
    // Legal pages
    {
      url: `${BASE_URL}/legal/privacy-policy`,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/legal/client-terms`,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/legal/professional-terms`,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/legal/disclaimer`,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/legal/cookies`,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
    {
      url: `${BASE_URL}/legal/code-of-conduct`,
      changeFrequency: 'yearly',
      priority: 0.3,
    },
  ];

  // Nanny profile pages
  const nannyPages: MetadataRoute.Sitemap = (nannyRes.data ?? []).map((n) => ({
    url: `${BASE_URL}/nannies/${n.id}`,
    lastModified: n.updated_at ? new Date(n.updated_at) : undefined,
    changeFrequency: 'weekly' as const,
    priority: 0.7,
  }));

  // Active babysitting request pages
  const bsrPages: MetadataRoute.Sitemap = (bsrRes.data ?? []).map((b) => ({
    url: `${BASE_URL}/babysitting/${b.id}`,
    lastModified: b.updated_at ? new Date(b.updated_at) : undefined,
    changeFrequency: 'daily' as const,
    priority: 0.6,
  }));

  // Active position pages
  const positionPages: MetadataRoute.Sitemap = (positionRes.data ?? []).map((p) => ({
    url: `${BASE_URL}/position/${p.id}`,
    lastModified: p.updated_at ? new Date(p.updated_at) : undefined,
    changeFrequency: 'daily' as const,
    priority: 0.6,
  }));

  return [...staticPages, ...nannyPages, ...bsrPages, ...positionPages];
}
