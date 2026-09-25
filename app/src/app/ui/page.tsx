import { createAdminClient } from "@/lib/supabase/admin";
import type { NannyCardData } from "@/components/NannyCard";
import { UIShowcaseClient } from "./UIShowcaseClient";
import {
  FALLBACK_NANNY,
  FALLBACK_NANNY_2,
  FALLBACK_NANNY_3,
  FALLBACK_PARENT,
  MOCK_NANNY_SCHEDULE,
} from "./mock-data";
import type { MockParentData } from "./mock-data";

const NANNY_EMAIL = "baileywright.eu@gmail.com";
const PARENT_EMAIL = "baileywright.ref@gmail.com";

export default async function UIShowcasePage() {
  let nannyCard: NannyCardData = FALLBACK_NANNY;
  const nannyCard2: NannyCardData = FALLBACK_NANNY_2;
  const nannyCard3: NannyCardData = FALLBACK_NANNY_3;
  let parentData: MockParentData = FALLBACK_PARENT;
  let nannySchedule: Record<string, string[]> = MOCK_NANNY_SCHEDULE;
  let nannyProfilePic: string | null = null;

  try {
    const admin = createAdminClient();

    // Fetch nanny user
    const { data: nannyProfile } = await admin
      .from("user_profiles")
      .select(
        "user_id, first_name, last_name, suburb, profile_picture_url, date_of_birth"
      )
      .eq("email", NANNY_EMAIL)
      .single();

    if (nannyProfile) {
      const { data: nanny } = await admin
        .from("nannies")
        .select(
          "id, hourly_rate_min, nanny_experience_years, total_experience_years, verification_tier, verification_level, drivers_license, wwcc_verified, languages, role_types_preferred, ai_content"
        )
        .eq("user_id", nannyProfile.user_id)
        .single();

      const { data: availability } = await admin
        .from("nanny_availability")
        .select("schedule")
        .eq("user_id", nannyProfile.user_id)
        .single();

      if (nanny) {
        const aiContent = nanny.ai_content as Record<string, unknown> | null;
        nannyCard = {
          id: nanny.id,
          user_id: nannyProfile.user_id,
          first_name: nannyProfile.first_name ?? "Bailey",
          last_name: nannyProfile.last_name ?? "Wright",
          suburb: nannyProfile.suburb ?? "Clapham",
          profile_picture_url: nannyProfile.profile_picture_url,
          hourly_rate_min: nanny.hourly_rate_min,
          nanny_experience_years: nanny.nanny_experience_years,
          total_experience_years: nanny.total_experience_years,
          verification_tier: nanny.verification_tier ?? "tier1",
          verification_level: nanny.verification_level ?? 0,
          drivers_license: nanny.drivers_license,
          vaccination_status: null,
          languages: nanny.languages,
          role_types_preferred: nanny.role_types_preferred,
          ai_headline: (aiContent?.headline as string) ?? null,
          under_3_experience_years: null,
          newborn_experience_years: null,
          highest_qualification: null,
        };
        nannyProfilePic = nannyProfile.profile_picture_url;
      }

      if (availability?.schedule) {
        nannySchedule = availability.schedule as Record<string, string[]>;
      }
    }

    // Fetch parent user
    const { data: parentProfile } = await admin
      .from("user_profiles")
      .select("user_id, first_name, last_name, suburb, profile_picture_url")
      .eq("email", PARENT_EMAIL)
      .single();

    if (parentProfile) {
      parentData = {
        first_name: parentProfile.first_name ?? "Bailey",
        last_name: parentProfile.last_name ?? "Wright",
        suburb: parentProfile.suburb ?? "Hackney",
        profile_picture_url: parentProfile.profile_picture_url,
      };
    }
  } catch {
    // Silently fall back to mock data
  }

  return (
    <UIShowcaseClient
      nannyCard={nannyCard}
      nannyCard2={nannyCard2}
      nannyCard3={nannyCard3}
      parentData={parentData}
      nannySchedule={nannySchedule}
      nannyProfilePic={nannyProfilePic}
    />
  );
}
