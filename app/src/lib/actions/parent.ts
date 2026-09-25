"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath } from "next/cache";
import { getStripeClient } from "@/lib/stripe/client";
import {
  POSITION_STAGE,
  POSITION_STATUS,
  CONNECTION_STAGE,
} from "@/lib/position/constants";
import { funnelLog } from "@/lib/position/logger";
import { createInboxMessage } from "./connection-helpers";
import { autofireMatchmaking } from "./autofire-matchmaking";
import { isUkMobile, normaliseUkMobile } from "@/lib/uk-contact";

export interface Position {
  id: string;
  parent_id: string;
  title: string | null;
  description: string | null;

  // Timeline
  urgency: string | null;
  start_date: string | null;
  placement_length: string | null;
  end_date: string | null;

  // Schedule
  schedule_type: string | null;
  hours_per_week: number | null;
  days_required: string[] | null;
  schedule_details: string | null;

  // Nanny Requirements
  language_preference: string | null;
  language_preference_details: string | null;
  minimum_age_requirement: number | null;
  years_of_experience: number | null;
  qualification_requirement: string | null;
  certificate_requirements: string[] | null;
  assurances_required: string[] | null;
  residency_status_requirement: string | null;

  // Booleans
  vaccination_required: boolean | null;
  drivers_license_required: boolean | null;
  car_required: boolean | null;
  comfortable_with_pets_required: boolean | null;
  non_smoker_required: boolean | null;
  other_requirements_exist: boolean | null;
  other_requirements_details: string | null;

  // Compensation
  hourly_rate: number | null;
  pay_frequency: string[] | null;

  // Reason & Support
  reason_for_nanny: string[] | null;
  level_of_support: string[] | null;

  // Location
  suburb: string | null;
  postcode: number | null;

  // Details (JSONB)
  details: Record<string, unknown> | null;

  // Status
  status: string;
  created_at: string;
  updated_at: string;

  // Funnel (new — nullable until fully migrated)
  stage: number | null;
  position_status: number | null;
  activated_at: string | null;
  onboarding_complete_at: string | null;
  ended_at: string | null;
  end_reason: string | null;
  closed_at: string | null;
  filled_at: string | null;
  filled_by_nanny_id: string | null;
}

export interface PositionChild {
  id: string;
  position_id: string;
  child_label: string;
  age_months: number;
  gender: string | null;
  display_order: number;
}

export interface PositionWithChildren extends Position {
  children: PositionChild[];
}

export async function getParentId(): Promise<string | null> {
  const supabase = createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) return null;

  const { data: parent, error } = await supabase
    .from("parents")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (error || !parent) return null;
  return parent.id;
}

export async function getPosition(): Promise<{
  data: PositionWithChildren | null;
  error: string | null;
}> {
  const supabase = createClient();

  const parentId = await getParentId();
  if (!parentId) {
    return { data: null, error: "Not authenticated as parent" };
  }

  // Get position
  const { data: position, error: positionError } = await supabase
    .from("nanny_positions")
    .select("*")
    .eq("parent_id", parentId)
    .in("status", ["active", "filled"])
    .single();

  if (positionError) {
    if (positionError.code === "PGRST116") {
      // No rows found - that's OK
      return { data: null, error: null };
    }
    console.error("Position fetch error:", positionError);
    return { data: null, error: "Failed to fetch position" };
  }

  // Get children for the position
  const { data: children, error: childrenError } = await supabase
    .from("position_children")
    .select("*")
    .eq("position_id", position.id)
    .order("display_order");

  if (childrenError) {
    console.error("Children fetch error:", childrenError);
  }

  return {
    data: {
      ...position,
      children: children || [],
    },
    error: null,
  };
}

export interface CreatePositionData {
  // Timeline
  urgency?: string;
  start_date?: string;
  placement_length?: string;
  end_date?: string;

  // Schedule
  schedule_type?: string;
  hours_per_week?: number;
  days_required?: string[];
  schedule_details?: string;

  // Children (1-3)
  children?: Array<{
    age_months: number;
    gender?: string;
  }>;

  // Nanny Requirements
  language_preference?: string;
  language_preference_details?: string;
  minimum_age_requirement?: number;
  years_of_experience?: number;
  qualification_requirement?: string;
  certificate_requirements?: string[];
  assurances_required?: string[];
  residency_status_requirement?: string;

  // Booleans
  vaccination_required?: boolean;
  drivers_license_required?: boolean;
  car_required?: boolean;
  comfortable_with_pets_required?: boolean;
  non_smoker_required?: boolean;
  other_requirements_exist?: boolean;
  other_requirements_details?: string;

  // Compensation
  hourly_rate?: number;
  pay_frequency?: string[];

  // Reason & Support
  reason_for_nanny?: string[];
  level_of_support?: string[];
}

export async function createPosition(
  data: CreatePositionData,
): Promise<{ success: boolean; error: string | null; positionId?: string }> {
  const supabase = createClient();

  const parentId = await getParentId();
  if (!parentId) {
    return { success: false, error: "Not authenticated as parent" };
  }

  // Extract children from data
  const { children, ...positionData } = data;

  // Create position
  const { data: position, error: positionError } = await supabase
    .from("nanny_positions")
    .insert({
      parent_id: parentId,
      ...positionData,
      status: "active",
      stage: POSITION_STAGE.OPEN,
      position_status: POSITION_STATUS.OPEN,
    })
    .select("id")
    .single();

  if (positionError) {
    console.error("Position create error:", positionError);
    if (positionError.code === "23505") {
      return {
        success: false,
        error: "You already have an active position. Please close it first.",
      };
    }
    return { success: false, error: "Failed to create position" };
  }

  funnelLog("createPosition", position.id, "→ Open(1)", { parentId });

  // Create children records
  if (children && children.length > 0) {
    const childrenData = children.map((child, index) => ({
      position_id: position.id,
      child_label: ["A", "B", "C"][index],
      age_months: child.age_months,
      gender: child.gender || null,
      display_order: index + 1,
    }));

    const { error: childrenError } = await supabase
      .from("position_children")
      .insert(childrenData);

    if (childrenError) {
      console.error("Children create error:", childrenError);
      // Don't fail the whole operation, position was created
    }
  }

  // T-040: Autofire Advanced matchmaking on create. Failures are swallowed by the helper.
  await autofireMatchmaking(position.id);

  revalidatePath("/parent");
  return { success: true, error: null, positionId: position.id };
}

export async function updatePosition(
  positionId: string,
  data: CreatePositionData,
): Promise<{ success: boolean; error: string | null }> {
  const supabase = createClient();

  const parentId = await getParentId();
  if (!parentId) {
    return { success: false, error: "Not authenticated as parent" };
  }

  // Extract children from data
  const { children, ...positionData } = data;

  // Update position
  const { error: positionError } = await supabase
    .from("nanny_positions")
    .update(positionData)
    .eq("id", positionId)
    .eq("parent_id", parentId);

  if (positionError) {
    console.error("Position update error:", positionError);
    return { success: false, error: "Failed to update position" };
  }

  // Update children - delete existing and recreate
  if (children) {
    await supabase
      .from("position_children")
      .delete()
      .eq("position_id", positionId);

    if (children.length > 0) {
      const childrenData = children.map((child, index) => ({
        position_id: positionId,
        child_label: ["A", "B", "C"][index],
        age_months: child.age_months,
        gender: child.gender || null,
        display_order: index + 1,
      }));

      await supabase.from("position_children").insert(childrenData);
    }
  }

  revalidatePath("/parent");
  return { success: true, error: null };
}

// ── Typeform position save ──

import type { TypeformFormData } from "@/app/parent/request/questions";

import {
  AGE_RANGE_TO_MONTHS,
  HOURS_TO_INT,
  buildScheduleJson,
} from "./position-utils";

export async function saveTypeformPosition(
  formData: Partial<TypeformFormData>,
): Promise<{ success: boolean; error: string | null; positionId?: string }> {
  const supabase = createClient();

  const parentId = await getParentId();
  if (!parentId) {
    return { success: false, error: "Not authenticated as parent" };
  }

  // Check for existing active position
  const { data: existing } = await supabase
    .from("nanny_positions")
    .select("id")
    .eq("parent_id", parentId)
    .in("status", ["active", "filled"])
    .maybeSingle();

  // Build position row
  const positionRow = {
    // Integers
    minimum_age_requirement: formData.minimum_age
      ? parseInt(formData.minimum_age)
      : null,
    years_of_experience: formData.years_of_experience
      ? parseInt(formData.years_of_experience)
      : null,
    hours_per_week: formData.hours_per_week
      ? (HOURS_TO_INT[formData.hours_per_week] ?? null)
      : null,

    // Booleans (form stores "Yes"/"No" strings)
    drivers_license_required: formData.drivers_license_required === "Yes",
    car_required: formData.car_required === "Yes",
    vaccination_required: false,
    non_smoker_required: false,
    comfortable_with_pets_required: false,

    // Text
    language_preference: formData.language_preference ?? null,
    language_preference_details: formData.language_preference_details ?? null,
    suburb: formData.suburb ?? null,
    postcode: formData.postcode ?? null,
    schedule_type: formData.schedule_type ?? null,
    urgency: formData.urgency ?? null,
    start_date: formData.start_date ?? null,
    placement_length: formData.placement_length ?? null,

    // Arrays
    days_required: formData.weekly_roster ?? [],
    reason_for_nanny: formData.reason_for_nanny
      ? [formData.reason_for_nanny]
      : [],

    // JSONB — descriptive fields not queried for matching + full form data for editing
    details: {
      has_pets_details: formData.has_pets_details ?? null,
      child_needs: formData.child_needs_yn === "Yes",
      child_needs_details: formData.child_needs_details ?? null,
      dietary_restrictions: formData.dietary_restrictions_yn === "Yes",
      dietary_restrictions_details:
        formData.dietary_restrictions_details ?? null,
      focus_type: formData.focus_type ?? null,
      support_type: formData.support_type ?? null,
      placement_duration: formData.placement_duration ?? null,
      hours_per_week_label: formData.hours_per_week ?? null,
      notes: formData.notes ?? null,
      form_data: formData,
    },
  };

  let positionId: string;

  if (existing) {
    const { error } = await supabase
      .from("nanny_positions")
      .update(positionRow)
      .eq("id", existing.id)
      .eq("parent_id", parentId);

    if (error) {
      console.error("Position update error:", error);
      return { success: false, error: "Failed to update position" };
    }
    positionId = existing.id;
  } else {
    const { data: position, error } = await supabase
      .from("nanny_positions")
      .insert({
        parent_id: parentId,
        ...positionRow,
        status: "active",
        stage: POSITION_STAGE.OPEN,
        position_status: POSITION_STATUS.OPEN,
      })
      .select("id")
      .single();

    if (error) {
      console.error("Position create error:", error);
      if (error.code === "23505") {
        return {
          success: false,
          error: "You already have an active position.",
        };
      }
      return { success: false, error: "Failed to create position" };
    }
    positionId = position.id;
    funnelLog("saveTypeformPosition", positionId, "→ Open(1)", { parentId });
    // T-040: Autofire Advanced matchmaking ONLY on the CREATE branch (fire-once-on-edit).
    // The UPDATE branch above must not re-trigger the blast.
    await autofireMatchmaking(positionId);
  }

  // Children: delete existing and recreate
  await supabase
    .from("position_children")
    .delete()
    .eq("position_id", positionId);

  const numChildren = formData.num_children ?? 0;
  if (numChildren > 0) {
    const AGE_KEYS = ["child_a_age", "child_b_age", "child_c_age"] as const;
    const GENDER_KEYS = [
      "child_a_gender",
      "child_b_gender",
      "child_c_gender",
    ] as const;

    const childrenRows = Array.from({ length: numChildren }).map((_, i) => ({
      position_id: positionId,
      child_label: ["A", "B", "C"][i],
      age_months:
        AGE_RANGE_TO_MONTHS[
          (formData[AGE_KEYS[i] as keyof TypeformFormData] as string) ?? ""
        ] ?? 0,
      gender:
        (formData[GENDER_KEYS[i] as keyof TypeformFormData] as string) ?? null,
      display_order: i + 1,
    }));

    const { error: childrenError } = await supabase
      .from("position_children")
      .insert(childrenRows);

    if (childrenError) {
      console.error("Children create error:", childrenError);
    }
  }

  // Schedule: upsert
  const schedule = buildScheduleJson(formData);
  if (Object.keys(schedule).length > 0) {
    const { error: scheduleError } = await supabase
      .from("position_schedule")
      .upsert(
        { position_id: positionId, schedule },
        { onConflict: "position_id" },
      );

    if (scheduleError) {
      console.error("Schedule upsert error:", scheduleError);
    }
  }

  revalidatePath("/parent");
  revalidatePath("/parent/request");

  // Notify nanny if active placement exists for this position
  if (existing) {
    const adminClient = createAdminClient();
    const { data: activePlacement } = await adminClient
      .from("nanny_placements")
      .select("nanny_id")
      .eq("position_id", positionId)
      .eq("status", "active")
      .maybeSingle();

    if (activePlacement) {
      const { data: nanny } = await adminClient
        .from("nannies")
        .select("user_id")
        .eq("id", activePlacement.nanny_id)
        .single();

      if (nanny) {
        const { data: parentProfile } = await adminClient
          .from("user_profiles")
          .select("first_name, last_name")
          .eq("user_id", (await supabase.auth.getUser()).data.user?.id ?? "")
          .single();

        const familyName = parentProfile
          ? `The ${parentProfile.last_name} family`
          : "Your family";
        await createInboxMessage({
          userId: nanny.user_id,
          type: "position_updated",
          title: `${familyName} has updated the position details`,
          body: "The family has made changes to the position. Review the updates on your dashboard.",
          actionUrl: "/nanny/positions",
        });
      }
    }
  }

  return { success: true, error: null, positionId };
}

export async function closePosition(
  positionId: string,
  noCandidates?: boolean,
): Promise<{ success: boolean; error: string | null }> {
  const supabase = createClient();

  const parentId = await getParentId();
  if (!parentId) {
    return { success: false, error: "Not authenticated as parent" };
  }

  const posStatus = noCandidates
    ? POSITION_STATUS.CLOSED_NO_CANDIDATES
    : POSITION_STATUS.CLOSED;

  const { error } = await supabase
    .from("nanny_positions")
    .update({
      status: "cancelled",
      stage: POSITION_STAGE.CLOSED,
      position_status: posStatus,
      closed_at: new Date().toISOString(),
    })
    .eq("id", positionId)
    .eq("parent_id", parentId);

  if (error) {
    console.error("Position close error:", error);
    return { success: false, error: "Failed to close position" };
  }

  // Cancel all active connections for this position
  const adminClient = createAdminClient();
  await adminClient
    .from("connection_requests")
    .update({
      status: "cancelled",
      connection_stage: CONNECTION_STAGE.CANCELLED_BY_PARENT,
      updated_at: new Date().toISOString(),
    })
    .eq("position_id", positionId)
    .in("status", ["pending", "accepted", "confirmed"]);

  funnelLog("closePosition", positionId, `→ Closed(${posStatus})`, {
    parentId,
    noCandidates,
  });

  revalidatePath("/parent");
  revalidatePath("/parent/connections");
  return { success: true, error: null };
}

// ── Account Settings ──

export interface UpdateParentAccountData {
  first_name?: string;
  last_name?: string;
  date_of_birth?: string | null;
  mobile_number?: string | null;
  suburb?: string;
  postcode?: string;
}

export async function updateParentAccountSettings(
  data: UpdateParentAccountData,
): Promise<{ success: boolean; error: string | null }> {
  const supabase = createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { success: false, error: "Not authenticated" };
  }

  // Server-side AU mobile validation. Mobile is REQUIRED + must
  // pass the regex when present in the payload — no empty / null
  // values accepted (per user policy 2026-05-07). This mirrors
  // the client-side validation in the settings dialog and prevents
  // any direct-action bypass.
  // Shares `lib/uk-contact` with every other surface so the rule
  // cannot drift (12.05); stores E.164 per P-5.
  if (data.mobile_number !== undefined) {
    const trimmed = (data.mobile_number ?? "").trim();
    if (trimmed.length === 0) {
      return { success: false, error: "Mobile number is required." };
    }
    if (!isUkMobile(trimmed)) {
      return {
        success: false,
        error: "Enter a valid UK mobile number.",
      };
    }
    data = { ...data, mobile_number: normaliseUkMobile(trimmed) };
  }

  const profileFields: Record<string, unknown> = {};
  if (data.first_name !== undefined) profileFields.first_name = data.first_name;
  if (data.last_name !== undefined) profileFields.last_name = data.last_name;
  if (data.date_of_birth !== undefined)
    profileFields.date_of_birth = data.date_of_birth;
  if (data.mobile_number !== undefined)
    profileFields.mobile_number = data.mobile_number;
  if (data.suburb !== undefined) profileFields.suburb = data.suburb;
  if (data.postcode !== undefined) profileFields.postcode = data.postcode;

  if (Object.keys(profileFields).length > 0) {
    const { error: profileError } = await supabase
      .from("user_profiles")
      .update(profileFields)
      .eq("user_id", user.id);

    if (profileError) {
      return { success: false, error: "Failed to update account info" };
    }
  }

  revalidatePath("/parent/settings");
  return { success: true, error: null };
}

export async function deactivateParentAccount(): Promise<{
  success: boolean;
  error: string | null;
}> {
  const supabase = createClient();
  const admin = createAdminClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { success: false, error: "Not authenticated" };
  }

  // Get parent record
  const { data: parent } = await admin
    .from("parents")
    .select("id")
    .eq("user_id", user.id)
    .single();

  if (parent) {
    // Close any in-flight positions. The live CHECK on nanny_positions.status
    // accepts: 'active', 'draft', 'filled', 'cancelled'. Prior code here
    // wrote 'closed' (not in CHECK — silent UPDATE failure) and matched
    // 'open' / 'in_progress' (also not in CHECK — matched nothing). Result:
    // deactivating a parent account did not close their positions.
    // 'cancelled' is the only sink value this code can actually write, and
    // it matches the connection_requests cancellation below.
    await admin
      .from("nanny_positions")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("parent_id", parent.id)
      .in("status", ["draft", "active"]);

    // Cancel any pending connection requests
    await admin
      .from("connection_requests")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("parent_id", parent.id)
      .in("status", ["pending", "accepted"]);
  }

  // S10 — payments cascade. Cancel any active Stripe subscription
  // (immediate, not period-end), anonymise child records, end nanny
  // placements. Best-effort: failures here are logged but do not
  // abort the deactivation — the user has already chosen to leave.
  await cascadePaymentsOnAccountClose(user.id, admin).catch((err) => {
    console.error("[deactivateParentAccount] payments cascade error", err);
  });

  await admin.from("activity_logs").insert({
    user_id: user.id,
    action: "account_deactivated",
    details: { deactivated_by: "user", role: "parent" },
  });

  await supabase.auth.signOut();
  return { success: true, error: null };
}

/**
 * S10 — payments-side cascade on parent account close.
 *
 * Spec: `system/APP/PAYMENTS/FRONTEND/03-build-spec.md` §S10.
 *
 * Steps:
 *   1. Cancel any active Stripe subscription (immediate).
 *   2. Anonymise child_client rows owned by this parent — preserves
 *      nanny's bapp_logs audit trail per Bailey's Q7 round-2
 *      answer "option B" (don't delete child entries; tombstone
 *      identifying info so the nanny's work history stays).
 *   3. End nanny_placements rows linking this parent.
 *   4. Update Stripe customer description with closed-account marker
 *      for ATO 7-year retention. The Stripe row itself is NEVER
 *      deleted — invoice records support compliance + future
 *      refunds via Dashboard.
 *
 * Deferred (require schema migrations not yet shipped):
 *   - bapp_logs.author_id anonymisation (FK has no SET NULL clause).
 *   - email_logs anonymisation.
 *   - nanny_payouts → 'permanently_frozen' status transition
 *     (per CHANGE-REQUEST-ACCOUNT-CLOSURE; needs enum extension).
 *   - auth.users hard delete (currently signOut only).
 *   - Email confirmation send.
 */
async function cascadePaymentsOnAccountClose(
  parentUserId: string,
  admin: ReturnType<typeof createAdminClient>,
): Promise<void> {
  // 1. Stripe subscription cancel (best-effort, non-blocking).
  const { data: sub } = await admin
    .from("parent_subscriptions")
    .select("id, status, stripe_subscription_id, stripe_customer_id")
    .eq("parent_user_id", parentUserId)
    .maybeSingle<{
      id: string;
      status: string;
      stripe_subscription_id: string | null;
      stripe_customer_id: string | null;
    }>();

  if (sub) {
    // `cancelled` deliberately excluded — that state means Stripe was
    // already asked to cancel-at-period-end. Calling .cancel() again
    // would either no-op (good) or hit a stale state error (noisy);
    // either way we have nothing new to ask Stripe to do.
    const cancellable = [
      "trial",
      "active_monthly",
      "active_upfront",
      "past_due",
    ];
    if (cancellable.includes(sub.status) && sub.stripe_subscription_id) {
      try {
        const stripe = getStripeClient();
        await stripe.subscriptions.cancel(sub.stripe_subscription_id);
      } catch (err) {
        console.error(
          "[cascadePaymentsOnAccountClose] stripe sub cancel failed",
          err,
        );
      }
    }
    // 4. Update Stripe customer description for ATO retention marker.
    if (sub.stripe_customer_id) {
      try {
        const stripe = getStripeClient();
        await stripe.customers.update(sub.stripe_customer_id, {
          description: `[closed account ${sub.id}]`,
          metadata: { closed_at: new Date().toISOString() },
        });
      } catch (err) {
        console.error(
          "[cascadePaymentsOnAccountClose] stripe customer update failed",
          err,
        );
      }
    }
  }

  // 2. Anonymise child_client rows (NOT delete — preserve nanny's
  //    bapp_logs history per option B). Sets first_name + DOB to
  //    tombstones; clears parent_user_id link.
  //
  //    Best-effort: failure here is logged but does NOT abort the
  //    deactivation. The user has already chosen to leave, and
  //    leaving residual PII is preferable to leaving the user
  //    half-deactivated with a confusing error message. Admin can
  //    re-run anonymisation via a manual queue if this surface.
  const childAnonResult = await admin
    .from("child_client")
    .update({
      first_name: "[closed]",
      date_of_birth: null,
      parent_user_id: null,
      updated_at: new Date().toISOString(),
    })
    .eq("parent_user_id", parentUserId);
  if (childAnonResult.error) {
    console.error(
      "[cascadePaymentsOnAccountClose] child_client anonymise failed",
      childAnonResult.error,
    );
  }

  // 3. End nanny_placements for this parent. 'ended' is the live
  //    status; matches the placement-lifecycle constants used
  //    elsewhere in the codebase.
  const placementsResult = await admin
    .from("nanny_placements")
    .update({
      status: "ended",
      ended_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("parent_user_id", parentUserId)
    .eq("status", "active");
  if (placementsResult.error) {
    console.error(
      "[cascadePaymentsOnAccountClose] nanny_placements end failed",
      placementsResult.error,
    );
  }
}

// ── A-05: parent profile picture ─────────────────────────────────────────

/**
 * Validates that a candidate URL is a public Supabase Storage URL pointing
 * at the `profile-pictures` bucket, in this caller's own subdirectory —
 * i.e. a URL the storage layer just minted for them. Defence against a
 * parent persisting an arbitrary external URL on
 * `user_profiles.profile_picture_url`. While `<img src>` can't run JS,
 * an unconstrained URL could leak referrer to an attacker domain, host
 * phishing imagery, or look hostile in the parent's hub. Constraining
 * the column to our own bucket + this user's own folder eliminates the
 * surface entirely.
 *
 * Accepts `null` to clear the avatar (Remove Image flow).
 *
 * Layered defences (security-reviewer 2026-05-06):
 *   1. Length cap — reject anything > 2048 chars before parsing.
 *   2. `new URL()` parse — collapses `..` traversal and `%xx` escapes
 *      so the prefix check operates on the normalised pathname, not
 *      the raw string.
 *   3. Pathname must be `/storage/v1/object/public/profile-pictures/{userId}/...`
 *      where `{userId}` is the caller's own auth user id. Without the
 *      userId tie, a different parent's signed-URL share could pass.
 */
const MAX_PROFILE_PICTURE_URL_LENGTH = 2048;
const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidProfilePictureUrl(
  url: string | null,
  callerUserId: string,
): boolean {
  if (url === null) return true;
  if (typeof url !== "string" || url.length === 0) return false;
  if (url.length > MAX_PROFILE_PICTURE_URL_LENGTH) return false;
  const supabaseUrlRaw = process.env.NEXT_PUBLIC_SUPABASE_URL;
  if (!supabaseUrlRaw) return false;

  let parsed: URL;
  let expectedOrigin: string;
  try {
    parsed = new URL(url);
    expectedOrigin = new URL(supabaseUrlRaw).origin;
  } catch {
    return false;
  }

  if (parsed.origin !== expectedOrigin) return false;
  // Path-traversal-resistant check: `URL` already collapsed `..` segments,
  // so this prefix match operates on the normalised path.
  const expectedPathPrefix = "/storage/v1/object/public/profile-pictures/";
  if (!parsed.pathname.startsWith(expectedPathPrefix)) return false;

  // Bind the URL to the caller's own subdirectory. Storage RLS already
  // enforces this on writes; the validator enforces it on the persisted
  // pointer too, so an attacker who somehow gained another parent's
  // signed URL still couldn't pin it onto their own row.
  const remainder = parsed.pathname.slice(expectedPathPrefix.length);
  const firstSegment = remainder.split("/")[0] ?? "";
  if (!UUID_REGEX.test(firstSegment)) return false;
  if (firstSegment.toLowerCase() !== callerUserId.toLowerCase()) return false;

  return true;
}

export async function updateParentProfilePictureUrl(
  newUrl: string | null,
): Promise<{ success: boolean; error: string | null }> {
  const supabase = createClient();

  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) {
    return { success: false, error: "Not authenticated" };
  }

  if (!isValidProfilePictureUrl(newUrl, user.id)) {
    return {
      success: false,
      error: "Invalid profile picture URL",
    };
  }

  // RLS on `user_profiles` already constrains writes to the caller's own
  // row, but the explicit `eq("user_id", user.id)` is defence-in-depth in
  // case the policy is ever loosened. The `profile-pictures` bucket
  // itself enforces per-user write paths via storage RLS — this server
  // action only updates the DB pointer, the file is already uploaded
  // client-side via supabase/storage.ts.
  const { error: updateError } = await supabase
    .from("user_profiles")
    .update({ profile_picture_url: newUrl })
    .eq("user_id", user.id);

  if (updateError) {
    console.error("[updateParentProfilePictureUrl] update error:", updateError);
    return { success: false, error: "Failed to update profile picture" };
  }

  revalidatePath("/parent");
  return { success: true, error: null };
}
