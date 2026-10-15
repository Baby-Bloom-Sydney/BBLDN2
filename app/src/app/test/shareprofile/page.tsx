import { createAdminClient } from "@/lib/supabase/admin";
import { SHARE_CASE_TYPE } from "@/lib/viral-loop/constants";
import { NannyShareClient } from "@/app/nanny/share/NannyShareClient";
import { notFound } from "next/navigation";
import { shareLoopEnabled } from "@/lib/features/flags";

const TEST_EMAIL = "baileywright.eu@gmail.com";

export default async function TestShareProfilePage() {
  // 5b (P-23): the share loop is hidden unless SHARE_LOOP_ENABLED is "true" — 404 before any read.
  if (!shareLoopEnabled()) notFound();

  const admin = createAdminClient();

  // Look up user by email
  const { data: profile } = await admin
    .from("user_profiles")
    .select("user_id, first_name, profile_picture_url, suburb, date_of_birth")
    .eq("email", TEST_EMAIL)
    .single();

  if (!profile) {
    return <div className="p-8 text-red-600">Profile not found for {TEST_EMAIL}</div>;
  }

  // Get nanny record
  const { data: nanny } = await admin
    .from("nannies")
    .select("id, ai_content")
    .eq("user_id", profile.user_id)
    .single();

  if (!nanny) {
    return <div className="p-8 text-red-600">Nanny record not found</div>;
  }

  // Get share record
  const { data: share } = await admin
    .from("viral_shares")
    .select("*")
    .eq("user_id", profile.user_id)
    .eq("case_type", SHARE_CASE_TYPE.NANNY_PROFILE)
    .eq("reference_id", nanny.id)
    .maybeSingle();

  const aiContent = nanny.ai_content as Record<string, unknown> | null;
  const parentPitch = aiContent?.parent_pitch as string | null;

  let age: number | null = null;
  if (profile.date_of_birth) {
    const dob = new Date(profile.date_of_birth);
    const computed = Math.floor((Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000));
    if (computed > 0 && computed < 100) age = computed;
  }

  return (
    <div className="p-6">
      <NannyShareClient
        initialData={{
          nannyId: nanny.id,
          firstName: profile.first_name ?? "Nanny",
          age,
          profilePicUrl: profile.profile_picture_url ?? null,
          suburb: profile.suburb ?? null,
          parentPitch,
          share: share ?? null,
        }}
      />
    </div>
  );
}
