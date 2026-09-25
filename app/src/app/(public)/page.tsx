import type { Metadata } from "next";
import { HeroSection } from "@/components/landing/HeroSection";
import { QuickMatch } from "@/components/landing/QuickMatch";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { BrowsePreview } from "@/components/landing/BrowsePreview";
import { NannyCTA } from "@/components/landing/NannyCTA";
import { MissionTeaser } from "@/components/landing/MissionTeaser";
import { createAdminClient } from "@/lib/supabase/admin";
import type { NannyPreview } from "@/components/landing/NannyPreviewCard";
import { BRAND, OG_LOCALE, SITE_DESCRIPTION, SITE_NAME, SITE_URL } from "@/lib/constants";

const HOME_TITLE = `${SITE_NAME} — Verified Nannies for ${BRAND.city} Families`;

export const metadata: Metadata = {
  title: { absolute: HOME_TITLE },
  description: SITE_DESCRIPTION,
  alternates: { canonical: '/' },
  openGraph: {
    locale: OG_LOCALE,
    title: HOME_TITLE,
    description: SITE_DESCRIPTION,
  },
};

const QUAL_RANK: Record<string, number> = {
  "Bachelor of Early Childhood Education (Or Equivalent)": 5,
  "Diploma of Early Childhood Education and Care": 4,
  "Certificate IV in Education Support": 3,
  "Certificate III in Early Childhood Education and Care": 2,
  "No Qualifications": 1,
};

function computeAge(dob: string | null | undefined): number | null {
  if (!dob) return null;
  const birth = new Date(dob);
  const now = new Date();
  let years = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) years--;
  return years > 0 && years < 120 ? years : null;
}

async function getTopNannies(limit: number): Promise<NannyPreview[]> {
  const supabase = createAdminClient();

  const { data: nannies, error } = await supabase
    .from("nannies")
    .select("id, user_id, hourly_rate_min, total_experience_years, under_3_experience_years, newborn_experience_years, verification_tier, verification_level, ai_content")
    .eq("profile_visible", true);

  if (error || !nannies?.length) return [];

  const userIds = nannies.map((n) => n.user_id);
  const nannyIds = nannies.map((n) => n.id);

  const [{ data: profiles }, { data: credentials }] = await Promise.all([
    supabase
      .from("user_profiles")
      .select("user_id, first_name, suburb, profile_picture_url, date_of_birth")
      .in("user_id", userIds),
    supabase
      .from("nanny_credentials")
      .select("nanny_id, qualification_type")
      .in("nanny_id", nannyIds)
      .eq("credential_category", "qualification"),
  ]);

  const profileMap = new Map((profiles || []).map((p) => [p.user_id, p]));
  const qualMap = new Map((credentials || []).map((c) => [c.nanny_id, c.qualification_type as string]));

  const mapped: NannyPreview[] = nannies
    .map((nanny) => {
      const profile = profileMap.get(nanny.user_id);
      if (!profile) return null;
      const ai = nanny.ai_content as Record<string, unknown> | null;
      const qual = qualMap.get(nanny.id) || null;
      return {
        id: nanny.id,
        first_name: profile.first_name,
        suburb: profile.suburb,
        profile_picture_url: profile.profile_picture_url,
        age: computeAge(profile.date_of_birth),
        total_experience_years: nanny.total_experience_years,
        under_3_experience_years: nanny.under_3_experience_years,
        newborn_experience_years: nanny.newborn_experience_years,
        highest_qualification: qual,
        verified: (nanny.verification_level ?? 0) >= 3,
        ai_headline: (ai?.headline as string) || null,
      };
    })
    .filter((n): n is NannyPreview => n !== null);

  mapped.sort((a, b) => {
    const expDiff = (b.total_experience_years ?? 0) - (a.total_experience_years ?? 0);
    if (expDiff !== 0) return expDiff;
    const qualA = a.highest_qualification ? (QUAL_RANK[a.highest_qualification] ?? 0) : 0;
    const qualB = b.highest_qualification ? (QUAL_RANK[b.highest_qualification] ?? 0) : 0;
    return qualB - qualA;
  });

  return mapped.slice(0, limit);
}

const websiteJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'WebSite',
  name: SITE_NAME,
  url: SITE_URL,
};

const serviceJsonLd = {
  '@context': 'https://schema.org',
  '@type': 'Service',
  name: `Verified Nanny Matching — ${BRAND.city}`,
  serviceType: 'Nanny and Childcare Matching Service',
  description: `Baby Bloom matches ${BRAND.city} families with background-checked, ID-verified nannies and babysitters.`,
  provider: {
    '@type': 'Organization',
    name: SITE_NAME,
    url: SITE_URL,
  },
  areaServed: {
    '@type': 'City',
    name: BRAND.city,
    addressRegion: 'England',
    addressCountry: BRAND.countryCode,
  },
  hasOfferCatalog: {
    '@type': 'OfferCatalog',
    name: 'Childcare Services',
    itemListElement: [
      { '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'Permanent Nanny Matching', description: 'Find a verified permanent nanny matched to your family\'s needs' } },
      { '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'Part-Time Nanny Matching', description: `Flexible part-time nanny arrangements for ${BRAND.city} families` } },
      { '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'Casual Babysitting', description: 'On-demand babysitting from verified sitters in your area' } },
      { '@type': 'Offer', itemOffered: { '@type': 'Service', name: 'After-School Care', description: 'Verified nannies for school pickups and after-school care' } },
    ],
  },
};

export default async function HomePage() {
  const topNannies = await getTopNannies(3);

  return (
    <main>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(websiteJsonLd).replace(/</g, '\\u003c'),
        }}
      />
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{
          __html: JSON.stringify(serviceJsonLd).replace(/</g, '\\u003c'),
        }}
      />
      <QuickMatch />
      <MissionTeaser />
      <HowItWorks />
      <BrowsePreview nannies={topNannies} />
      <NannyCTA />
    </main>
  );
}
