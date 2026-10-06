/**
 * /nanny/onboarding-verification (server) — picks the wizard's starting step from the stored verification row.
 * Unit 3b (BB-LDN-3b-061026, brief change 1): the DBS part reads `getDbsDisplayState` — a fail card or a bar sends
 * her to /nanny/verification; a submitted certificate shows processing (step 4); only `clear` (30/40) counts as done
 * and redirects to the hub. Never: treats status 21 (review) as complete.
 */
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getVerificationData } from "@/lib/actions/verification";
import { applyStartAtFloor } from "@/lib/onboarding/resume-step";
import { getDbsDisplayState, isDbsFailState } from "@/lib/dbs/nanny-display";
import { OnboardingVerificationClient } from "./OnboardingVerificationClient";

export default async function OnboardingVerificationPage({
  searchParams,
}: {
  searchParams?: { startAt?: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) {
    redirect("/login");
  }

  // Fetch verification state, user profile, and nanny data in parallel
  const admin = createAdminClient();

  const [verificationResult, profileResult, nannyResult] = await Promise.all([
    getVerificationData(),
    admin
      .from("user_profiles")
      .select(
        "first_name, last_name, date_of_birth, mobile_number, suburb, postcode, profile_picture_url",
      )
      .eq("user_id", user.id)
      .single(),
    admin
      .from("nannies")
      .select("nationality, ai_content")
      .eq("user_id", user.id)
      .single(),
  ]);

  const verification = verificationResult.data;
  const profile = profileResult.data;
  const nanny = nannyResult.data;

  // Extract headline from AI content JSONB and strip HTML tags
  const aiContent = nanny?.ai_content as Record<string, unknown> | null;
  const rawHeadline =
    typeof aiContent?.headline === "string" ? aiContent.headline : null;
  const headline = rawHeadline?.replace(/<[^>]*>/g, "").trim() || null;

  // Determine initial step based on existing verification state
  let initialStep = 0; // Default: Account Secured interstitial

  if (verification) {
    // Has a verifications record — at least identity was submitted once

    if (
      verification.contact_status === "saved" &&
      verification.identity_status === "not_started"
    ) {
      initialStep = 2; // Location done but identity not started — show identity
    }

    // Identity failed/rejected — redirect to existing verification page for retry
    if (
      verification.identity_status === "failed" ||
      verification.identity_status === "rejected"
    ) {
      redirect("/nanny/verification");
    }

    if (verification.identity_status !== "not_started") {
      initialStep = 3; // Identity submitted — show the DBS step
    }

    // If identity is done but contact wasn't saved (edge case: contact submit failed)
    if (
      verification.identity_status !== "not_started" &&
      verification.contact_status !== "saved"
    ) {
      initialStep = 1; // Go back to location to re-submit
    }

    // DBS step: one decoder for every nanny screen (3b, brief change 1)
    const dbsState = getDbsDisplayState(verification);

    if (dbsState !== "not_started") {
      initialStep = 4; // Certificate submitted — show processing
    }

    // A DBS outcome that needs her (fail card, two buttons) or a bar — the verification page shows it
    if (isDbsFailState(dbsState) || dbsState === "barred") {
      redirect("/nanny/verification");
    }

    // Full completion: "You're verified!" is only ever the `clear` state (30/40)
    const allDone =
      verification.identity_status === "verified" &&
      dbsState === "clear" &&
      verification.contact_status === "saved";

    if (allDone) {
      redirect("/nanny");
    }
  }

  // T-022 — Honour `?startAt=N` from upstream navigators (the new
  // contributions page sends `?startAt=1` to skip AccountSecured and
  // land at Step 1 Location). Floor semantics — a returning user at
  // Step 3 (DBS) is NEVER downgraded by a stale URL. Pure helper
  // covers the NaN / negative / float / out-of-range edge cases.
  initialStep = applyStartAtFloor(initialStep, searchParams?.startAt);

  return (
    <OnboardingVerificationClient
      initialStep={initialStep}
      verification={verification}
      profile={{
        firstName: profile?.first_name ?? "",
        lastName: profile?.last_name ?? "",
        dateOfBirth: profile?.date_of_birth ?? "",
        mobileNumber: profile?.mobile_number ?? "",
        suburb: profile?.suburb ?? "",
        postcode: profile?.postcode ?? "",
        profilePictureUrl: profile?.profile_picture_url ?? null,
        bioSnippet: headline,
        nationality: nanny?.nationality ?? null,
      }}
      userId={user.id}
    />
  );
}
