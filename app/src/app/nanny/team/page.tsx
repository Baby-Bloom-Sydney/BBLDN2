import { createAdminClient } from "@/lib/supabase/admin";
import { NannyCard, NannyCardData, EmptyNannyState } from "@/components/NannyCard";
import { publicNannyCard } from "@/lib/nanny-card";

async function getNannies(): Promise<NannyCardData[]> {
  const supabase = createAdminClient();

  const { data: nannies, error } = await supabase
    .from("nannies")
    .select("id, user_id, hourly_rate_min, nanny_experience_years, total_experience_years, under_3_experience_years, newborn_experience_years, verification_tier, verification_level, drivers_license, vaccination_status, languages, role_types_preferred, ai_content")
    .eq("profile_visible", true)
    .order("created_at", { ascending: false, nullsFirst: false })
    .limit(40);

  if (error || !nannies?.length) {
    if (error) console.error("Error fetching nannies:", error);
    return [];
  }

  const userIds = nannies.map((n) => n.user_id);
  const nannyIds = nannies.map((n) => n.id);

  const [{ data: profiles }, { data: credentials }] = await Promise.all([
    supabase
      .from("user_profiles")
      .select("user_id, first_name, last_name, suburb, profile_picture_url, date_of_birth")
      .in("user_id", userIds),
    supabase
      .from("nanny_credentials")
      .select("nanny_id, qualification_type")
      .in("nanny_id", nannyIds)
      .eq("credential_category", "qualification"),
  ]);

  const profileMap = new Map(
    (profiles || []).map((p) => [p.user_id, p])
  );
  const qualMap = new Map(
    (credentials || []).map((c) => [c.nanny_id, c.qualification_type as string])
  );

  return nannies
    .map((nanny) => {
      const profile = profileMap.get(nanny.user_id);
      if (!profile) return null;
      const ai = nanny.ai_content as Record<string, unknown> | null;
      return {
        id: nanny.id,
        user_id: nanny.user_id,
        first_name: profile.first_name,
        last_name: profile.last_name,
        suburb: profile.suburb,
        profile_picture_url: profile.profile_picture_url,
        hourly_rate_min: nanny.hourly_rate_min,
        nanny_experience_years: nanny.nanny_experience_years,
        total_experience_years: nanny.total_experience_years,
        under_3_experience_years: nanny.under_3_experience_years,
        newborn_experience_years: nanny.newborn_experience_years,
        highest_qualification: qualMap.get(nanny.id) || null,
        verification_tier: nanny.verification_tier,
        verification_level: nanny.verification_level ?? 0,
        drivers_license: nanny.drivers_license,
        vaccination_status: nanny.vaccination_status,
        languages: nanny.languages,
        role_types_preferred: nanny.role_types_preferred,
        ai_headline: (ai?.headline as string) || null,
        date_of_birth: profile.date_of_birth || null,
      } as NannyCardData;
    })
    .filter((n): n is NannyCardData => n !== null)
    .map(publicNannyCard);
}

export default async function OurTeamPage() {
  const nannies = await getNannies();

  return (
    <div className="min-h-screen">
      {/* Header */}
      <div className="border-b border-slate-200 bg-white">
        <div className="px-4 md:px-6 py-8 md:py-10">
          <h1 className="text-2xl md:text-3xl font-bold text-slate-900">
            Our Team
          </h1>
          <p className="mt-2 text-slate-600">
            Browse through our amazing team of nannies.
          </p>
        </div>
      </div>

      {/* Nanny Grid */}
      <div className="px-4 md:px-6 py-8">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {nannies.length > 0 ? (
            nannies.map((nanny) => (
              <NannyCard key={nanny.id} nanny={nanny} />
            ))
          ) : (
            <EmptyNannyState />
          )}
        </div>

        {nannies.length > 0 && (
          <div className="mt-12 text-center">
            <p className="text-sm text-slate-500">
              Showing {nannies.length} team member{nannies.length === 1 ? "" : "s"}
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
