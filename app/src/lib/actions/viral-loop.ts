"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  SHARE_STATUS,
  SHARE_CASE_TYPE,
  isValidShareTransition,
  isShareAccessGranted,
  type ShareStatus,
  type ShareCaseType,
  type ViralShareRow,
} from "@/lib/viral-loop/constants";
import {
  checkShareScreenshot,
  type ScreenshotCheckResult,
} from "@/lib/ai/check-share-screenshot";
import { activateBsr } from "@/lib/actions/babysitting";
import { BRAND } from "@/lib/constants";
// AUTOFIRE T-040: disabled — share-gate is dead path; matchmaking now autofires on position creation
// via `autofireMatchmaking(positionId)` (see `./autofire-matchmaking.ts`). If reintroducing the
// share-gate, route through THAT wrapper rather than calling `activateDfyPosition` directly.
// import { activateDfyPosition } from '@/lib/actions/matching';

// ── Auth helper ──

async function getAuthUser() {
  const supabase = createClient();
  const {
    data: { user },
    error,
  } = await supabase.auth.getUser();
  if (error || !user) return null;
  return user;
}

// ── Get share for current user ──

export async function getShareForUser(
  caseType: ShareCaseType,
  referenceId: string,
): Promise<{ share: ViralShareRow | null; error: string | null }> {
  const user = await getAuthUser();
  if (!user) return { share: null, error: "Not authenticated" };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("viral_shares")
    .select("*")
    .eq("user_id", user.id)
    .eq("case_type", caseType)
    .eq("reference_id", referenceId)
    .maybeSingle();

  if (error) {
    console.error("[getShareForUser]", error);
    return { share: null, error: error.message };
  }

  return { share: data as ViralShareRow | null, error: null };
}

// ── Get all shares for current user ──

export async function getSharesForUser(): Promise<{
  shares: ViralShareRow[];
  error: string | null;
}> {
  const user = await getAuthUser();
  if (!user) return { shares: [], error: "Not authenticated" };

  const admin = createAdminClient();
  const { data, error } = await admin
    .from("viral_shares")
    .select("*")
    .eq("user_id", user.id)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[getSharesForUser]", error);
    return { shares: [], error: error.message };
  }

  return { shares: (data ?? []) as ViralShareRow[], error: null };
}

// ── Check if access is granted for a specific entity ──

export async function isViralAccessGranted(
  caseType: ShareCaseType,
  referenceId: string,
): Promise<boolean> {
  const { share } = await getShareForUser(caseType, referenceId);
  if (!share) return false;
  return isShareAccessGranted(share.share_status);
}

// ── Create share record ──
// Called when entity is created (nanny verified, position published, BSR submitted)

export async function createShareRecord(
  caseType: ShareCaseType,
  referenceId: string,
  userId?: string,
): Promise<{ share: ViralShareRow | null; error: string | null }> {
  // If userId not provided, get from auth
  let targetUserId = userId;
  if (!targetUserId) {
    const user = await getAuthUser();
    if (!user) return { share: null, error: "Not authenticated" };
    targetUserId = user.id;
  }

  const admin = createAdminClient();

  // Check if record already exists
  const { data: existing } = await admin
    .from("viral_shares")
    .select("id")
    .eq("user_id", targetUserId)
    .eq("case_type", caseType)
    .eq("reference_id", referenceId)
    .maybeSingle();

  if (existing) {
    // Already exists — return it
    const { data, error } = await admin
      .from("viral_shares")
      .select("*")
      .eq("id", existing.id)
      .single();

    if (error) return { share: null, error: error.message };
    return { share: data as ViralShareRow, error: null };
  }

  // Create new record at READY (10)
  const { data, error } = await admin
    .from("viral_shares")
    .insert({
      user_id: targetUserId,
      case_type: caseType,
      reference_id: referenceId,
      share_status: SHARE_STATUS.READY,
      ready_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error) {
    console.error("[createShareRecord]", error);
    return { share: null, error: error.message };
  }

  return { share: data as ViralShareRow, error: null };
}

// ── Mark as shared (browser confirmed FB share) ──

export async function markShareCompleted(
  shareId: string,
): Promise<{ success: boolean; error: string | null }> {
  const user = await getAuthUser();
  if (!user) return { success: false, error: "Not authenticated" };

  const admin = createAdminClient();

  // Get current record
  const { data: share, error: fetchErr } = await admin
    .from("viral_shares")
    .select("share_status, user_id")
    .eq("id", shareId)
    .single();

  if (fetchErr || !share) return { success: false, error: "Share not found" };
  if (share.user_id !== user.id)
    return { success: false, error: "Not authorized" };

  if (share.share_status === SHARE_STATUS.SHARED) {
    // Already shared — no-op, return success
    return { success: true, error: null };
  }

  if (
    !isValidShareTransition(
      share.share_status as ShareStatus,
      SHARE_STATUS.SHARED,
    )
  ) {
    // Already past shared status — still return success silently
    return { success: true, error: null };
  }

  const { error } = await admin
    .from("viral_shares")
    .update({
      share_status: SHARE_STATUS.SHARED,
      shared_at: new Date().toISOString(),
    })
    .eq("id", shareId);

  if (error) return { success: false, error: error.message };
  return { success: true, error: null };
}

// ── Submit screenshot ──

export async function submitShareScreenshot(
  shareId: string,
  screenshotUrl: string,
): Promise<{ success: boolean; error: string | null }> {
  const user = await getAuthUser();
  if (!user) return { success: false, error: "Not authenticated" };

  if (!screenshotUrl?.trim()) {
    return { success: false, error: "Screenshot URL is required" };
  }

  const admin = createAdminClient();

  // Get current record
  const { data: share, error: fetchErr } = await admin
    .from("viral_shares")
    .select("share_status, user_id, retry_count")
    .eq("id", shareId)
    .single();

  if (fetchErr || !share) return { success: false, error: "Share not found" };
  if (share.user_id !== user.id)
    return { success: false, error: "Not authorized" };

  if (
    !isValidShareTransition(
      share.share_status as ShareStatus,
      SHARE_STATUS.SUBMITTED,
    )
  ) {
    return {
      success: false,
      error: `Cannot submit screenshot from status ${share.share_status}`,
    };
  }

  const isRetry = share.share_status === SHARE_STATUS.FAILED;
  const skippedShare = share.share_status === SHARE_STATUS.READY;
  const now = new Date().toISOString();

  const { error } = await admin
    .from("viral_shares")
    .update({
      share_status: SHARE_STATUS.SUBMITTED,
      screenshot_url: screenshotUrl,
      submitted_at: now,
      ...(skippedShare && { shared_at: now }),
      retry_count: isRetry
        ? (share.retry_count ?? 0) + 1
        : (share.retry_count ?? 0),
    })
    .eq("id", shareId);

  if (error) return { success: false, error: error.message };

  // TODO: Trigger AI screenshot check (async)
  // For now, the check will be triggered by a separate call to checkShareScreenshot

  return { success: true, error: null };
}

// ── Begin AI screenshot check ──

export async function beginScreenshotCheck(
  shareId: string,
): Promise<{ success: boolean; error: string | null }> {
  const admin = createAdminClient();

  const { data: share, error: fetchErr } = await admin
    .from("viral_shares")
    .select("share_status")
    .eq("id", shareId)
    .single();

  if (fetchErr || !share) return { success: false, error: "Share not found" };

  if (
    !isValidShareTransition(
      share.share_status as ShareStatus,
      SHARE_STATUS.PROCESSING,
    )
  ) {
    return {
      success: false,
      error: `Cannot begin check from status ${share.share_status}`,
    };
  }

  const { error } = await admin
    .from("viral_shares")
    .update({
      share_status: SHARE_STATUS.PROCESSING,
      processing_at: new Date().toISOString(),
    })
    .eq("id", shareId);

  if (error) return { success: false, error: error.message };
  return { success: true, error: null };
}

// ── Record AI check result ──

export async function recordCheckResult(
  shareId: string,
  result: ScreenshotCheckResult,
): Promise<{ success: boolean; error: string | null }> {
  const admin = createAdminClient();

  const { data: share, error: fetchErr } = await admin
    .from("viral_shares")
    .select("share_status, case_type, reference_id")
    .eq("id", shareId)
    .single();

  if (fetchErr || !share) return { success: false, error: "Share not found" };

  const now = new Date().toISOString();

  if (result.verdict === "approved") {
    const { error } = await admin
      .from("viral_shares")
      .update({
        share_status: SHARE_STATUS.APPROVED,
        check_result: result,
        checked_at: now,
        approved_at: now,
      })
      .eq("id", shareId);

    if (error) return { success: false, error: error.message };
  } else {
    // Failed — store user-friendly guidance as the visible fail_reason
    const failReason =
      result.user_guidance ??
      "Please check that your screenshot clearly shows your post in a Sydney childcare Facebook group with your Baby Bloom link visible.";

    const { error } = await admin
      .from("viral_shares")
      .update({
        share_status: SHARE_STATUS.FAILED,
        check_result: result, // full technical details stored here for admin review
        checked_at: now,
        failed_at: now,
        fail_reason: failReason,
      })
      .eq("id", shareId);

    if (error) return { success: false, error: error.message };
  }

  return { success: true, error: null };
}

// ── Full check pipeline (submit → process → check → result) ──
// Convenience function that runs the entire AI check flow

export async function processScreenshotCheck(
  shareId: string,
): Promise<{
  success: boolean;
  approved: boolean;
  error: string | null;
  failReason: string | null;
}> {
  // 1. Mark as processing
  const beginResult = await beginScreenshotCheck(shareId);
  if (!beginResult.success) {
    return {
      success: false,
      approved: false,
      error: beginResult.error,
      failReason: null,
    };
  }

  // 2. Get share details + user name for the check
  const admin = createAdminClient();
  const { data: share, error: fetchErr } = await admin
    .from("viral_shares")
    .select("screenshot_url, case_type, user_id, reference_id")
    .eq("id", shareId)
    .single();

  if (fetchErr || !share?.screenshot_url) {
    return {
      success: false,
      approved: false,
      error: "Screenshot not found",
      failReason: null,
    };
  }

  const isBsr = share.case_type === SHARE_CASE_TYPE.PARENT_BSR;
  const isPosition = share.case_type === SHARE_CASE_TYPE.PARENT_POSITION;

  // Get user's name for name-matching check (all share types)
  let expectedName: string | undefined;
  const { data: profile } = await admin
    .from("user_profiles")
    .select("first_name, last_name")
    .eq("user_id", share.user_id)
    .maybeSingle();

  if (profile?.first_name) {
    expectedName = [profile.first_name, profile.last_name]
      .filter(Boolean)
      .join(" ");
  }

  // For BSR and position shares, use last 5 chars of the reference ID as reference code
  const needsReferenceCode = isBsr || isPosition;
  const referenceCode =
    needsReferenceCode && share.reference_id
      ? share.reference_id.slice(-5)
      : undefined;

  // 3. Run AI check
  const checkResult = await checkShareScreenshot(
    share.screenshot_url,
    share.case_type as ShareCaseType,
    expectedName,
    referenceCode,
  );

  // 4. Record result
  const recordResult = await recordCheckResult(shareId, checkResult);
  if (!recordResult.success) {
    return {
      success: false,
      approved: false,
      error: recordResult.error,
      failReason: null,
    };
  }

  // If BSR share approved, activate the BSR (pending_payment → open + notify nannies)
  // MUST await — fire-and-forget gets killed when serverless function terminates
  if (checkResult.verdict === "approved" && isBsr && share.reference_id) {
    try {
      await activateBsr(share.reference_id);
    } catch (err) {
      console.error("[viral-loop] Failed to activate BSR:", err);
    }
  }

  // AUTOFIRE T-040: parent_position share-gate is now a dead path — matchmaking autofires
  // when the position is created (see `./autofire-matchmaking.ts`). DO NOT uncomment without
  // first deleting the autofire seams; otherwise matchmaking would double-fire.
  // The block below is preserved verbatim only as a forensic record of the previous behaviour.
  // if (checkResult.verdict === 'approved' && isPosition && share.reference_id) {
  //   try {
  //     await activateDfyPosition(share.reference_id, 'priority');
  //   } catch (err) {
  //     console.error('[viral-loop] Failed to activate DFY position:', err);
  //   }
  // }

  const failReason =
    checkResult.verdict === "approved"
      ? null
      : (checkResult.user_guidance ??
        "Please check that your screenshot clearly shows your post in a Sydney childcare Facebook group with your Baby Bloom link visible.");

  return {
    success: true,
    approved: checkResult.verdict === "approved",
    error: null,
    failReason,
  };
}

// ── Admin bypass ──

export async function adminBypassShare(
  shareId: string,
): Promise<{ success: boolean; error: string | null }> {
  const user = await getAuthUser();
  if (!user) return { success: false, error: "Not authenticated" };

  // Verify admin role
  const admin = createAdminClient();
  const { data: role } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", user.id)
    .in("role", ["admin", "super_admin"])
    .maybeSingle();

  if (!role) return { success: false, error: "Admin access required" };

  const now = new Date().toISOString();

  const { error } = await admin
    .from("viral_shares")
    .update({
      share_status: SHARE_STATUS.BYPASSED,
      bypassed_at: now,
      bypassed_by: user.id,
      approved_at: now, // so access gating queries work the same
    })
    .eq("id", shareId);

  if (error) return { success: false, error: error.message };
  return { success: true, error: null };
}

// ── Case-specific creators ──

/** Create nanny profile share — called when nanny verification completes */
export async function createNannyProfileShare(
  nannyId: string,
  userId: string,
): Promise<{ share: ViralShareRow | null; error: string | null }> {
  return createShareRecord(SHARE_CASE_TYPE.NANNY_PROFILE, nannyId, userId);
}

/** Create parent position share — called when position is published */
export async function createParentPositionShare(
  positionId: string,
  userId?: string,
): Promise<{ share: ViralShareRow | null; error: string | null }> {
  return createShareRecord(SHARE_CASE_TYPE.PARENT_POSITION, positionId, userId);
}

/** Create parent BSR share — called when BSR is created */
export async function createParentBsrShare(
  bsrId: string,
  userId?: string,
): Promise<{ share: ViralShareRow | null; error: string | null }> {
  return createShareRecord(SHARE_CASE_TYPE.PARENT_BSR, bsrId, userId);
}

// ── Get nanny share page data ──

export async function getNannySharePageData(): Promise<{
  data: {
    nannyId: string;
    firstName: string;
    age: number | null;
    profilePicUrl: string | null;
    suburb: string | null;
    parentPitch: string | null;
    share: ViralShareRow | null;
  } | null;
  error: string | null;
}> {
  const user = await getAuthUser();
  if (!user) return { data: null, error: "Not authenticated" };

  const admin = createAdminClient();

  // Get nanny record with ai_content
  const { data: nanny, error: nannyErr } = await admin
    .from("nannies")
    .select("id, ai_content")
    .eq("user_id", user.id)
    .maybeSingle();

  if (nannyErr || !nanny)
    return { data: null, error: "Nanny profile not found" };

  // Get user profile for name, pic, and suburb
  const { data: profile } = await admin
    .from("user_profiles")
    .select("first_name, profile_picture_url, suburb, date_of_birth")
    .eq("user_id", user.id)
    .maybeSingle();

  // Get existing share record
  const { data: share } = await admin
    .from("viral_shares")
    .select("*")
    .eq("user_id", user.id)
    .eq("case_type", SHARE_CASE_TYPE.NANNY_PROFILE)
    .eq("reference_id", nanny.id)
    .maybeSingle();

  const aiContent = nanny.ai_content as Record<string, unknown> | null;
  const parentPitch = aiContent?.parent_pitch as string | null;

  let age: number | null = null;
  if (profile?.date_of_birth) {
    const dob = new Date(profile.date_of_birth);
    const computed = Math.floor(
      (Date.now() - dob.getTime()) / (365.25 * 24 * 60 * 60 * 1000),
    );
    if (computed > 0 && computed < 100) age = computed;
  }

  return {
    data: {
      nannyId: nanny.id,
      firstName: profile?.first_name ?? "Nanny",
      age,
      profilePicUrl: profile?.profile_picture_url ?? null,
      suburb: profile?.suburb ?? null,
      parentPitch,
      share: share as ViralShareRow | null,
    },
    error: null,
  };
}

// ── Get BSR share page data ──

export async function getBsrSharePageData(bsrId: string): Promise<{
  data: {
    bsrId: string;
    firstName: string;
    lastName: string | null;
    profilePicUrl: string | null;
    suburb: string;
    sharePost: string | null;
    timeSlots: Array<{
      slot_date: string;
      start_time: string;
      end_time: string;
    }>;
    hourlyRate: number | null;
    children: Array<{ ageMonths: number; gender?: string }>;
    bsrStatus: string;
    share: ViralShareRow | null;
  } | null;
  error: string | null;
}> {
  const user = await getAuthUser();
  if (!user) return { data: null, error: "Not authenticated" };

  const admin = createAdminClient();

  // Get BSR and verify ownership via parent_id → parents.user_id
  const { data: bsr, error: bsrErr } = await admin
    .from("babysitting_requests")
    .select(
      "id, parent_id, suburb, hourly_rate, status, ai_content, children, special_requirements",
    )
    .eq("id", bsrId)
    .maybeSingle();

  if (bsrErr || !bsr)
    return { data: null, error: "Babysitting request not found" };

  // Verify the authenticated user owns this BSR
  const { data: parent } = await admin
    .from("parents")
    .select("user_id")
    .eq("id", bsr.parent_id)
    .single();

  if (!parent || parent.user_id !== user.id)
    return { data: null, error: "Not authorized" };

  // Get user profile
  const { data: profile } = await admin
    .from("user_profiles")
    .select("first_name, last_name, profile_picture_url")
    .eq("user_id", user.id)
    .maybeSingle();

  // Get time slots
  const { data: slots } = await admin
    .from("bsr_time_slots")
    .select("slot_date, start_time, end_time")
    .eq("babysitting_request_id", bsrId)
    .order("slot_date", { ascending: true });

  // Get existing share record
  const { data: share } = await admin
    .from("viral_shares")
    .select("*")
    .eq("user_id", user.id)
    .eq("case_type", SHARE_CASE_TYPE.PARENT_BSR)
    .eq("reference_id", bsrId)
    .maybeSingle();

  const aiContent = bsr.ai_content as Record<string, unknown> | null;
  const sharePost = aiContent?.share_post as string | null;
  const children =
    (bsr.children as Array<{ ageMonths: number; gender?: string }>) ?? [];

  return {
    data: {
      bsrId: bsr.id,
      firstName: profile?.first_name ?? "Parent",
      lastName: profile?.last_name ?? null,
      profilePicUrl: profile?.profile_picture_url ?? null,
      suburb: bsr.suburb,
      sharePost,
      timeSlots: slots ?? [],
      hourlyRate: bsr.hourly_rate ? Number(bsr.hourly_rate) : null,
      children,
      bsrStatus: bsr.status,
      share: share as ViralShareRow | null,
    },
    error: null,
  };
}

// ── Access gating queries ──

/** Is a nanny's profile share approved? (gates BSR pool access) */
export async function isNannyViralCompliant(nannyId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("viral_shares")
    .select("id")
    .eq("case_type", SHARE_CASE_TYPE.NANNY_PROFILE)
    .eq("reference_id", nannyId)
    .in("share_status", [SHARE_STATUS.APPROVED, SHARE_STATUS.BYPASSED])
    .maybeSingle();

  return !!data;
}

/** Is a parent position share approved? (gates matchmaking) */
export async function isPositionViralCompliant(
  positionId: string,
): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("viral_shares")
    .select("id")
    .eq("case_type", SHARE_CASE_TYPE.PARENT_POSITION)
    .eq("reference_id", positionId)
    .in("share_status", [SHARE_STATUS.APPROVED, SHARE_STATUS.BYPASSED])
    .maybeSingle();

  return !!data;
}

/** Is a BSR share approved? (gates nanny notifications) */
export async function isBsrViralCompliant(bsrId: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("viral_shares")
    .select("id")
    .eq("case_type", SHARE_CASE_TYPE.PARENT_BSR)
    .eq("reference_id", bsrId)
    .in("share_status", [SHARE_STATUS.APPROVED, SHARE_STATUS.BYPASSED])
    .maybeSingle();

  return !!data;
}

// ── Get position share page data ──

export async function getPositionSharePageData(): Promise<{
  data: {
    positionId: string;
    firstName: string;
    lastName: string | null;
    profilePicUrl: string | null;
    suburb: string;
    sharePost: string | null;
    children: Array<{ ageMonths: number; gender?: string }>;
    daysRequired: string[] | null;
    hoursPerWeek: number | null;
    hourlyRate: number | null;
    scheduleType: string | null;
    share: ViralShareRow | null;
  } | null;
  error: string | null;
}> {
  const user = await getAuthUser();
  if (!user) return { data: null, error: "Not authenticated" };

  const admin = createAdminClient();

  // Find parent record
  const { data: parent } = await admin
    .from("parents")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (!parent) return { data: null, error: "Parent not found" };

  // Get active position
  const { data: position, error: posErr } = await admin
    .from("nanny_positions")
    .select(
      "id, parent_id, suburb, hourly_rate, hours_per_week, days_required, schedule_type",
    )
    .eq("parent_id", parent.id)
    .in("status", ["active", "filled"])
    .maybeSingle();

  if (posErr || !position)
    return { data: null, error: posErr?.message ?? "No active position found" };

  const positionId = position.id;

  // Get position children
  const { data: children } = await admin
    .from("position_children")
    .select("age_months, gender")
    .eq("position_id", positionId)
    .order("display_order", { ascending: true });

  // Get user profile
  const { data: profile } = await admin
    .from("user_profiles")
    .select("first_name, last_name, profile_picture_url")
    .eq("user_id", user.id)
    .maybeSingle();

  // Get existing share record
  const { data: share } = await admin
    .from("viral_shares")
    .select("*")
    .eq("user_id", user.id)
    .eq("case_type", SHARE_CASE_TYPE.PARENT_POSITION)
    .eq("reference_id", positionId)
    .maybeSingle();

  return {
    data: {
      positionId: position.id,
      firstName: profile?.first_name ?? "Parent",
      lastName: profile?.last_name ?? null,
      profilePicUrl: profile?.profile_picture_url ?? null,
      suburb: position.suburb ?? BRAND.city,
      sharePost: null,
      children: (children ?? []).map((c) => ({
        ageMonths: c.age_months,
        gender: c.gender ?? undefined,
      })),
      daysRequired: position.days_required,
      hoursPerWeek: position.hours_per_week
        ? Number(position.hours_per_week)
        : null,
      hourlyRate: position.hourly_rate ? Number(position.hourly_rate) : null,
      scheduleType: position.schedule_type,
      share: share as ViralShareRow | null,
    },
    error: null,
  };
}
