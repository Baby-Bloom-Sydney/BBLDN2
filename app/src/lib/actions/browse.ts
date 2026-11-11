"use server";

import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import type { NannyCardData } from "@/components/NannyCard";
import { publicNannyCard } from "@/lib/nanny-card";

/** The parent's browse list is for signed-in parents (and admins). */
const BROWSE_ROLES = ["parent", "admin", "super_admin"];
/** The most cards one call returns (the browse tab loads up to this many at once to sort them). */
const MAX_PAGE = 1000;

async function mayBrowse(): Promise<boolean> {
  const {
    data: { user },
  } = await createClient().auth.getUser();
  if (!user) return false;
  const { data: role } = await createAdminClient().from("user_roles").select("role").eq("user_id", user.id).maybeSingle();
  return BROWSE_ROLES.includes((role as { role?: string } | null)?.role ?? "");
}

export async function fetchBrowseNannies(
  page: number = 1,
  limit: number = 10,
): Promise<{ nannies: NannyCardData[]; total: number; error: string | null }> {
  if (!(await mayBrowse())) return { nannies: [], total: 0, error: "Not authorised" };
  const supabase = createAdminClient();
  const size = Math.min(Math.max(1, Math.floor(limit) || 1), MAX_PAGE);
  const pageNo = Math.max(1, Math.floor(page) || 1);

  // Get total count first
  const { count, error: countError } = await supabase
    .from("nannies")
    .select("id", { count: "exact", head: true })
    .eq("profile_visible", true);

  if (countError) {
    console.error("Error counting nannies:", countError);
    return { nannies: [], total: 0, error: countError.message };
  }

  const total = count ?? 0;
  if (total === 0) return { nannies: [], total: 0, error: null };

  const from = (pageNo - 1) * size;
  const to = from + size - 1;

  const { data: nannies, error } = await supabase
    .from("nannies")
    .select("id, user_id, hourly_rate_min, nanny_experience_years, total_experience_years, under_3_experience_years, newborn_experience_years, verification_tier, verification_level, drivers_license, vaccination_status, languages, role_types_preferred, ai_content")
    .eq("profile_visible", true)
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error || !nannies?.length) {
    if (error) console.error("Error fetching nannies:", error);
    return { nannies: [], total, error: error?.message || null };
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

  const profileMap = new Map((profiles || []).map((p) => [p.user_id, p]));
  const qualMap = new Map((credentials || []).map((c) => [c.nanny_id, c.qualification_type as string]));

  const mapped = nannies
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

  return { nannies: mapped, total, error: null };
}
