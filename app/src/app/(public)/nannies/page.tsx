import type { Metadata } from "next";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ArrowRight, ChevronLeft } from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { NannyPreviewCard, type NannyPreview } from "@/components/landing/NannyPreviewCard";
import { BRAND, OG_LOCALE, SITE_NAME } from "@/lib/constants";

export const dynamic = "force-dynamic";

const BROWSE_TITLE = `Browse Verified Nannies in ${BRAND.city}`;
const BROWSE_DESCRIPTION = `Browse trusted, verified nannies available in ${BRAND.city}. Every nanny on ${SITE_NAME} is background-checked, ID-verified, and education-focused.`;

export const metadata: Metadata = {
  title: BROWSE_TITLE,
  description: BROWSE_DESCRIPTION,
  alternates: { canonical: '/nannies' },
  openGraph: {
    locale: OG_LOCALE,
    title: `${BROWSE_TITLE} | Baby Bloom`,
    description: BROWSE_DESCRIPTION,
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

async function getTopNannies(): Promise<NannyPreview[]> {
  const supabase = createAdminClient();

  const { data: nannies, error } = await supabase
    .from("nannies")
    .select("id, user_id, hourly_rate_min, total_experience_years, under_3_experience_years, verification_tier, verification_level, ai_content")
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
        highest_qualification: qual,
        verified: (nanny.verification_level ?? 0) >= 3,
        ai_headline: (ai?.headline as string) || null,
      };
    })
    .filter((n): n is NannyPreview => n !== null);

  // Sort: highest experience first, then highest qualification as tiebreaker
  mapped.sort((a, b) => {
    const expDiff = (b.total_experience_years ?? 0) - (a.total_experience_years ?? 0);
    if (expDiff !== 0) return expDiff;
    const qualA = a.highest_qualification ? (QUAL_RANK[a.highest_qualification] ?? 0) : 0;
    const qualB = b.highest_qualification ? (QUAL_RANK[b.highest_qualification] ?? 0) : 0;
    return qualB - qualA;
  });

  return mapped.slice(0, 10);
}

export default async function BrowseNanniesPage() {
  const nannies = await getTopNannies();

  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link
        href="/"
        className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600 transition-colors mb-4"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Home
      </Link>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900">Our Top Nannies</h1>
        <p className="mt-1 text-sm text-slate-500">
          Our most experienced and qualified nannies in {BRAND.city}.
          Sign up to see availability and connect.
        </p>
      </div>

      {nannies.length > 0 ? (
        <div className="space-y-3">
          {nannies.map((nanny) => (
            <NannyPreviewCard key={nanny.id} nanny={nanny} />
          ))}
        </div>
      ) : (
        <div className="rounded-xl border border-slate-200 bg-white p-8 text-center">
          <p className="text-sm text-slate-500">No nannies available right now. Check back soon!</p>
        </div>
      )}

      <div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm text-center space-y-3">
        <h2 className="text-base font-semibold text-slate-900">
          Want to find your perfect match?
        </h2>
        <p className="text-sm text-slate-500">
          Try our free matchmaking to find nannies who fit your schedule and location.
        </p>
        <Button asChild className="bg-violet-500 hover:bg-violet-600">
          <Link href="/#quick-match">
            Try Free Matchmaking
            <ArrowRight className="ml-1.5 w-4 h-4" />
          </Link>
        </Button>
      </div>
    </div>
  );
}
