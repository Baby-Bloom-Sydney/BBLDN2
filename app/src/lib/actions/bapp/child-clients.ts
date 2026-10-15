"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { revalidatePath, revalidateTag } from "next/cache";
import { getChildAgeMonths, validateChildDob } from "@/lib/bapp/child-age";
import type { ChildClient, ChildClientEvents } from "@/types/bapp";
import { mintChildInvite } from "@/lib/invite/mint";
import { invitesDisabled } from "@/lib/invite/flags";
import { recordConsent } from "@/lib/legal/record-consent";
import {
  recordCelebrationTile,
  dispatchChildCreated,
  isUserSubsequentChild,
} from "./child-onboarding-dispatch";
import { isDfyFamily } from "@/lib/payments/dfy-access";

export async function getChildrenForUser(): Promise<{
  success: boolean;
  error: string | null;
  data: ChildClient[];
}> {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "Not authenticated", data: [] };
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("child_client")
      .select("*")
      .or(`nanny_user_id.eq.${user.id},parent_user_id.eq.${user.id}`)
      .eq("under_three", true)
      .order("created_at", { ascending: true });

    if (error) {
      console.error("getChildrenForUser error:", error);
      return { success: false, error: "lookup_failed", data: [] };
    }

    return { success: true, error: null, data: (data as ChildClient[]) ?? [] };
  } catch (err) {
    console.error("getChildrenForUser unexpected error:", err);
    return { success: false, error: "Failed to fetch children", data: [] };
  }
}

export async function getChildDetail(childId: string): Promise<{
  success: boolean;
  error: string | null;
  data: { child: ChildClient; events: ChildClientEvents | null } | null;
}> {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "Not authenticated", data: null };
    }

    const admin = createAdminClient();
    const [childRes, eventsRes] = await Promise.all([
      admin.from("child_client").select("*").eq("id", childId).maybeSingle(),
      admin
        .from("child_client_events")
        .select("*")
        .eq("child_client_id", childId)
        .maybeSingle(),
    ]);

    if (childRes.error) {
      console.error("getChildDetail error:", childRes.error);
      return { success: false, error: childRes.error.message, data: null };
    }

    // Ownership gate — admin client bypasses RLS, so we authorise here.
    // The caller must be either the linked parent or the linked nanny.
    const child = childRes.data as ChildClient | null;
    if (!child) {
      return { success: false, error: "child_not_found", data: null };
    }
    if (child.parent_user_id !== user.id && child.nanny_user_id !== user.id) {
      return { success: false, error: "not_linked_to_child", data: null };
    }

    return {
      success: true,
      error: null,
      data: {
        child,
        events: (eventsRes.data as ChildClientEvents) ?? null,
      },
    };
  } catch (err) {
    console.error("getChildDetail unexpected error:", err);
    return {
      success: false,
      error: "Failed to fetch child details",
      data: null,
    };
  }
}

// ── createChild (revised — invite-link redesign 2026-05-04) ──────────
//
// Path A: nanny creates a child, gets an invite token to share with the
// parent. The parent_lead_email field + the "parent already on Baby
// Bloom" lookup were removed — replaced by the invite-link flow which
// handles the same idempotency at claim time via connect_child_invite().
//
// Disclaimer (AGR-14) is required: the nanny must confirm guardian
// permission. Recorded via recordConsent for compliance audit.

export async function createChild(data: {
  first_name: string;
  date_of_birth: string;
  gender: string | null;
  guardian_permission_confirmed: boolean;
  /**
   * T-022 — TRUE when the child is added via the onboarding contributions
   * page (`/nanny/onboarding/add-child`). Forwarded to mintChildInvite
   * for commission attribution and stamps `nannies.bonus_program_completed_at`
   * (idempotent — first completion only). Best-effort stamp: a failure
   * does not unwind the child creation; the child was created successfully.
   */
  fromBonusProgram?: boolean;
}): Promise<{
  success: boolean;
  error: string | null;
  data: { id: string; inviteToken: string; inviteUrl: string } | null;
}> {
  // Kill switch — feature gate per audit fix C11.
  if (invitesDisabled()) {
    return { success: false, error: "invites_disabled", data: null };
  }

  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "Not authenticated", data: null };
    }

    const admin = createAdminClient();

    // 1. Verify caller is a nanny.
    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    if (roleRow?.role !== "nanny") {
      return { success: false, error: "role_mismatch", data: null };
    }

    // 2. Validate disclaimer + required fields.
    if (data.guardian_permission_confirmed !== true) {
      return {
        success: false,
        error: "You must confirm guardian permission to add this child.",
        data: null,
      };
    }
    if (!data.first_name?.trim() || !data.date_of_birth?.trim()) {
      return { success: false, error: "missing_required_fields", data: null };
    }
    // Bound first_name length to prevent oversized writes hitting the
    // DB and producing leaked truncation errors. (M5)
    if (data.first_name.trim().length > 100) {
      return { success: false, error: "first_name_too_long", data: null };
    }
    // Validate date_of_birth: parseable, not in the future, and within the
    // bapp's under-3 age cap (MAX_CHILD_AGE_MONTHS). Without parse/future
    // checks an invalid string slips through to Postgres and we surface
    // a raw constraint error; without the age cap a 4-year-old can be
    // added to an under-three product. (M4 + age-cap 2026-05-15)
    const dobCheck = validateChildDob(data.date_of_birth);
    if (!dobCheck.ok) {
      return { success: false, error: dobCheck.error, data: null };
    }

    // 3. Insert child_client. parent_lead_email left NULL — invite flow
    //    handles the contact path now.
    const { data: child, error: insertError } = await admin
      .from("child_client")
      .insert({
        nanny_user_id: user.id,
        parent_user_id: null,
        parent_lead_email: null,
        first_name: data.first_name.trim(),
        date_of_birth: data.date_of_birth,
        gender: data.gender,
        onboarded: true,
        under_three: true,
        status: "created_manual",
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("createChild insert error:", insertError);
      return { success: false, error: "insert_failed", data: null };
    }

    // 3.5. Celebration tile — A-08 spec § 'Architecture' requires
    //      the user never to see an empty feed after creating a
    //      child. NOT a true DB transaction: child + tile are two
    //      sequential awaits in this server action, so a process
    //      crash between them can leave a child without a tile.
    //      A tile-insert *error* fails the whole action so the user
    //      knows to retry; the (rare) crash gap is mopped up by the
    //      remediation script described in spec 04 §1.
    const trimmedFirstName = data.first_name.trim();
    const celebration = await recordCelebrationTile({
      admin,
      childClientId: child.id,
      authorId: user.id,
      childFirstName: trimmedFirstName,
    });
    if (!celebration.ok) {
      // Server-side log already happened inside recordCelebrationTile.
      return {
        success: false,
        error: celebration.error ?? "celebration_tile_failed",
        data: null,
      };
    }

    // 4. Insert child_client_events. Tolerable failure: missing
    //    events row is non-blocking for the user (audit gap only),
    //    so we log + continue rather than failing the action.
    const { error: eventsErr } = await admin
      .from("child_client_events")
      .insert({
        child_client_id: child.id,
        created_manual_at: new Date().toISOString(),
      });
    if (eventsErr) {
      console.warn(
        "[createChild] child_client_events insert failed:",
        eventsErr.code,
      );
    }

    // 5. Record consent (AGR-14). Acceptable risk: if this fails after
    //    the child is inserted, we have a child without consent. The
    //    activity_logs entry below preserves the audit trail and a
    //    remediation script can backfill if needed (per spec 04 §1).
    await recordConsent(
      [
        {
          agreementId: "AGR-14",
          checkpointId: "agr14_guardian_permission",
          checkpointText:
            "I confirm I have the child's legal guardian's permission to add this child to Baby Bloom.",
        },
      ],
      child.id,
    );

    // 6. Mint the invite. Wrapped in try/catch so insert + consent are
    //    preserved if mint fails — but mint failure is rare and the
    //    nanny can retry via the regenerate flow.
    let mintResult: { token: string; url: string };
    try {
      mintResult = await mintChildInvite({
        childId: child.id,
        direction: "nanny_to_parent",
        userId: user.id,
        userEmail: user.email ?? "",
        bonusProgram: data.fromBonusProgram ?? false,
      });
    } catch (mintErr) {
      console.error("createChild mint error:", mintErr);
      return {
        success: false,
        error: "Child created but invite mint failed — try regenerating.",
        data: null,
      };
    }

    // 6.5. T-022 — stamp bonus_program_completed_at when this child was
    //      added via the onboarding contributions flow. Idempotent (only
    //      writes when the column is still NULL, so re-runs are no-ops).
    //      Best-effort: a failure does NOT unwind the child or invite;
    //      the column drives commission attribution but the source of
    //      truth is `child_invites.bonus_program=true` (set inside
    //      mintChildInvite). On failure we ALSO write an activity_logs
    //      row so a remediation script can find affected nannies + back-
    //      fill the timestamp without a log-scrape.
    if (data.fromBonusProgram) {
      const { error: stampErr } = await admin
        .from("nannies")
        .update({ bonus_program_completed_at: new Date().toISOString() })
        .eq("user_id", user.id)
        .is("bonus_program_completed_at", null);
      if (stampErr) {
        console.error(
          "[createChild] bonus_program_completed_at stamp failed:",
          stampErr,
        );
        // Best-effort observability record. If this insert also fails,
        // the console.error above is the only trace — accept and move on.
        const { error: logErr } = await admin.from("activity_logs").insert({
          action_type: "invite_created",
          user_id: user.id,
          action_details: {
            child_id: child.id,
            bonus_program_stamp_failed: true,
            stamp_error_code: stampErr.code ?? null,
          },
        });
        if (logErr) {
          console.warn(
            "[createChild] stamp-failure activity_log also failed:",
            logErr.code,
          );
        }
      }
    }

    // 7. Audit log. Tolerable failure: log + continue (audit gap only).
    const { error: activityErr } = await admin.from("activity_logs").insert({
      action_type: "invite_created",
      user_id: user.id,
      action_details: {
        child_id: child.id,
        direction: "nanny_to_parent",
      },
    });
    if (activityErr) {
      console.warn(
        "[createChild] activity_logs insert failed:",
        activityErr.code,
      );
    }

    // 8. Dispatch the A-08 child.created proactive trigger (Katie's
    //    welcome). Fire-and-forget — the dispatcher itself catches
    //    its own errors and the resume banner handles the case
    //    where the welcome message fails to land. We pass the
    //    nanny's first name + the child's first name + age so the
    //    template renders correctly without a second DB roundtrip
    //    in the trigger. Subsequent-child detection counts the
    //    nanny's prior children excluding the row we just inserted.
    const isSubsequent = await isUserSubsequentChild({
      admin,
      userId: user.id,
      side: "nanny",
      excludeChildId: child.id,
    });
    const { data: nannyProfile, error: profileErr } = await admin
      .from("user_profiles")
      .select("first_name")
      .eq("user_id", user.id)
      .maybeSingle<{ first_name: string | null }>();
    if (profileErr) {
      // Soft-fail: missing nanny first name renders Katie's welcome
      // with an empty {user_first_name}. Better than skipping the
      // whole cascade.
      console.warn(
        "[createChild] nanny profile fetch failed:",
        profileErr.code,
      );
    }
    const ageMonths = Math.max(
      0,
      getChildAgeMonths(new Date(data.date_of_birth), new Date()),
    );
    dispatchChildCreated({
      recipientUserId: user.id,
      childId: child.id,
      childFirstName: trimmedFirstName,
      userFirstName: nannyProfile?.first_name ?? "",
      childAgeMonths: ageMonths,
      isSubsequent,
    });

    revalidatePath("/nanny");
    revalidateTag("pending-invites");

    return {
      success: true,
      error: null,
      data: {
        id: child.id,
        inviteToken: mintResult.token,
        inviteUrl: mintResult.url,
      },
    };
  } catch (err) {
    console.error("createChild unexpected error:", err);
    return { success: false, error: "Failed to create child", data: null };
  }
}

// ── createChildAsParent (Path B) ─────────────────────────────────────
//
// Parent-first child creation. Identical shape to createChild minus the
// disclaimer (parent IS the legal guardian). Sets parent_user_id +
// leaves nanny_user_id NULL, opposite of Path A.

export async function createChildAsParent(data: {
  first_name: string;
  date_of_birth: string;
  gender: string | null;
  /** T-015 — `parent-app-consent` must be ticked on the add-child form
   *  before the child is created. Required true; the caller's submit
   *  button is disabled when this is false so we just defensively
   *  reject if it ever reaches us as false. */
  parent_app_consent_given?: boolean;
}): Promise<{
  success: boolean;
  error: string | null;
  data: { id: string; inviteToken: string; inviteUrl: string } | null;
}> {
  if (data.parent_app_consent_given === false) {
    return {
      success: false,
      error: "consent_required",
      data: null,
    };
  }
  if (invitesDisabled()) {
    return { success: false, error: "invites_disabled", data: null };
  }

  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "Not authenticated", data: null };
    }

    const admin = createAdminClient();

    const { data: roleRow } = await admin
      .from("user_roles")
      .select("role")
      .eq("user_id", user.id)
      .maybeSingle();
    if (roleRow?.role !== "parent") {
      return { success: false, error: "role_mismatch", data: null };
    }

    if (!data.first_name?.trim() || !data.date_of_birth?.trim()) {
      return { success: false, error: "missing_required_fields", data: null };
    }
    if (data.first_name.trim().length > 100) {
      return { success: false, error: "first_name_too_long", data: null };
    }
    const dobCheck = validateChildDob(data.date_of_birth);
    if (!dobCheck.ok) {
      return { success: false, error: dobCheck.error, data: null };
    }

    const { data: child, error: insertError } = await admin
      .from("child_client")
      .insert({
        nanny_user_id: null,
        parent_user_id: user.id,
        first_name: data.first_name.trim(),
        date_of_birth: data.date_of_birth,
        gender: data.gender,
        onboarded: true,
        under_three: true,
        status: "created_manual",
      })
      .select("id")
      .single();

    if (insertError) {
      console.error("createChildAsParent insert error:", insertError);
      return { success: false, error: "insert_failed", data: null };
    }

    // T-015 — record PARENT-APP-CONSENT, scoped to the new child.
    // Best-effort; an audit-row failure here must not unwind the
    // child creation (the parent's consent intent is captured by
    // the checkbox state having been true at submit time; the row
    // is the durable trail). The 12-month renewal cron picks up
    // missing rows and prompts.
    try {
      const { recordConsent } = await import("@/lib/legal/record-consent");
      await recordConsent(
        [
          {
            agreementId: "PARENT-APP-CONSENT",
            checkpointId: "add-child-form",
            checkpointText:
              "I consent to Baby Bloom collecting, storing, and processing data for this child including photos, observations, diary entries, and sensitive information, in accordance with the Privacy Policy.",
          },
        ],
        child.id,
      );
    } catch (consentErr) {
      console.warn(
        "[createChildAsParent] consent record failed (non-fatal):",
        consentErr,
      );
    }

    // Celebration tile — A-08 spec § 'Architecture'. Same fail-fast
    // (not true-transactional) story as createChild — see the
    // matching comment block there. Server-side log happens inside
    // recordCelebrationTile.
    const trimmedParentFirstName = data.first_name.trim();
    const celebration = await recordCelebrationTile({
      admin,
      childClientId: child.id,
      authorId: user.id,
      childFirstName: trimmedParentFirstName,
    });
    if (!celebration.ok) {
      return {
        success: false,
        error: celebration.error ?? "celebration_tile_failed",
        data: null,
      };
    }

    const { error: parentEventsErr } = await admin
      .from("child_client_events")
      .insert({
        child_client_id: child.id,
        created_manual_at: new Date().toISOString(),
      });
    if (parentEventsErr) {
      console.warn(
        "[createChildAsParent] child_client_events insert failed:",
        parentEventsErr.code,
      );
    }

    // Auto-start the 30-day trial the moment a parent creates a child.
    // The nanny may not have joined yet — that's fine, the parent
    // shouldn't be paywalled while waiting for them. Idempotent PG
    // function: no-ops if the parent already has a row with
    // `has_used_trial=true` or is a test user. Best-effort: a failure
    // here must not block the child-creation result. (Bailey
    // product call 2026-05-13: trial begins at child-add time, not
    // at parent+nanny link time.)
    // ADR-093 (4c): a done-for-you family gets no trial — skip silently, no error to the parent.
    if (!(await isDfyFamily(admin, user.id))) {
      const { error: trialErr } = await admin.rpc("start_family_trial_if_first", {
        p_parent_user_id: user.id,
      });
      if (trialErr) {
        console.warn("[createChildAsParent] trial-start rpc error:", trialErr);
      }
    }

    let mintResult: { token: string; url: string };
    try {
      mintResult = await mintChildInvite({
        childId: child.id,
        direction: "parent_to_nanny",
        userId: user.id,
        userEmail: user.email ?? "",
      });
    } catch (mintErr) {
      console.error("createChildAsParent mint error:", mintErr);
      return {
        success: false,
        error: "Child created but invite mint failed — try regenerating.",
        data: null,
      };
    }

    const { error: parentActivityErr } = await admin
      .from("activity_logs")
      .insert({
        action_type: "invite_created",
        user_id: user.id,
        action_details: {
          child_id: child.id,
          direction: "parent_to_nanny",
        },
      });
    if (parentActivityErr) {
      console.warn(
        "[createChildAsParent] activity_logs insert failed:",
        parentActivityErr.code,
      );
    }

    // NOTE: A-08 child.created trigger is NOT dispatched on the
    // parent self-create path. The trigger's welcome text
    // (`FIRST_CHILD_WELCOME` in the child-onboarding module)
    // addresses the user as the nanny — phrases like "you and
    // {child}'s parent stay close" do not fit a parent who IS the
    // parent. The parent-side onboarding flow runs via
    // `parent.connected_to_child` when a nanny accepts/sends an
    // invite — that path covers the spec § 'Parent post-invite-
    // claim' welcome. A dedicated parent-self-create welcome
    // variant is a follow-up (separate amendment) and not in scope
    // for A-08 v1. The celebration tile inserted above still
    // ensures the parent's feed is not empty on first visit.

    revalidatePath("/parent");
    revalidateTag("pending-invites");

    return {
      success: true,
      error: null,
      data: {
        id: child.id,
        inviteToken: mintResult.token,
        inviteUrl: mintResult.url,
      },
    };
  } catch (err) {
    console.error("createChildAsParent unexpected error:", err);
    return { success: false, error: "Failed to create child", data: null };
  }
}

// ── onboardChild (legacy, unchanged) ─────────────────────────────────

export async function onboardChild(
  childId: string,
  data: {
    first_name: string;
    date_of_birth: string;
    gender?: string | null;
  },
): Promise<{
  success: boolean;
  error: string | null;
}> {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "Not authenticated" };
    }

    const admin = createAdminClient();

    // Ownership gate — admin client bypasses RLS. Only the linked nanny
    // or parent for this child can edit profile fields.
    const { data: existing } = await admin
      .from("child_client")
      .select("nanny_user_id, parent_user_id")
      .eq("id", childId)
      .maybeSingle();
    if (!existing) {
      return { success: false, error: "child_not_found" };
    }
    if (
      existing.nanny_user_id !== user.id &&
      existing.parent_user_id !== user.id
    ) {
      return { success: false, error: "not_linked_to_child" };
    }

    // Age cap + parse safety — onboardChild previously trusted whatever
    // string the sheet sent. Now it shares the same validator as the
    // create paths so a 3-year-old can't be onboarded into the under-3
    // bapp.
    const dobCheck = validateChildDob(data.date_of_birth);
    if (!dobCheck.ok) {
      return { success: false, error: dobCheck.error };
    }

    const { error: updateError } = await admin
      .from("child_client")
      .update({
        first_name: data.first_name,
        date_of_birth: data.date_of_birth,
        gender: data.gender ?? null,
        onboarded: true,
        status: "setup",
      })
      .eq("id", childId);

    if (updateError) {
      console.error("onboardChild update error:", updateError);
      return { success: false, error: "update_failed" };
    }

    await admin
      .from("child_client_events")
      .update({ setup_at: new Date().toISOString() })
      .eq("child_client_id", childId);

    revalidatePath("/nanny");
    return { success: true, error: null };
  } catch (err) {
    console.error("onboardChild unexpected error:", err);
    return { success: false, error: "Failed to onboard child" };
  }
}

// ── deleteChild placement-end helper (JS, intentional scope limit) ──
//
// `removeNannyFromChild` and `nannyLeaveChild` were migrated to
// SECURITY DEFINER PG functions in M1 because the spec forbids direct
// UPDATEs to `child_client.nanny_user_id` from app code. `deleteChild`
// is different: it issues a DELETE (not an UPDATE on link columns),
// which is itself atomic. The placement-end + per-side current_*
// fixup that follows the DELETE is acceptable in app code — it
// touches `nanny_placements` and the role tables, not the forbidden
// link columns. If a future review escalates this to forbidden, we
// add a `delete_child_atomic` SECURITY DEFINER function and switch.

async function endPlacementForDeletedChild(
  admin: ReturnType<typeof createAdminClient>,
  parentUserId: string,
  formerNannyUserId: string,
): Promise<{ ended: boolean; error: string | null }> {
  const { count, error: countError } = await admin
    .from("child_client")
    .select("id", { count: "exact", head: true })
    .eq("parent_user_id", parentUserId)
    .eq("nanny_user_id", formerNannyUserId);
  if (countError) return { ended: false, error: countError.message };
  if ((count ?? 0) > 0) return { ended: false, error: null };

  const [{ data: nannyRow }, { data: parentRow }] = await Promise.all([
    admin
      .from("nannies")
      .select("id")
      .eq("user_id", formerNannyUserId)
      .maybeSingle(),
    admin
      .from("parents")
      .select("id")
      .eq("user_id", parentUserId)
      .maybeSingle(),
  ]);
  if (!nannyRow || !parentRow) return { ended: false, error: null };

  const { error: endError } = await admin
    .from("nanny_placements")
    .update({
      status: "ended",
      ended_at: new Date().toISOString(),
      end_reason: "other",
      end_notes: "Removed via BB-app child delete",
    })
    .eq("nanny_id", nannyRow.id)
    .eq("parent_id", parentRow.id)
    .eq("status", "active");
  if (endError) return { ended: false, error: endError.message };

  const { count: nannyOtherActive } = await admin
    .from("nanny_placements")
    .select("id", { count: "exact", head: true })
    .eq("nanny_id", nannyRow.id)
    .eq("status", "active");
  if ((nannyOtherActive ?? 0) === 0) {
    await admin
      .from("nannies")
      .update({ current_placement_id: null })
      .eq("id", nannyRow.id);
  }

  const { count: parentOtherActive } = await admin
    .from("nanny_placements")
    .select("id", { count: "exact", head: true })
    .eq("parent_id", parentRow.id)
    .eq("status", "active");
  if ((parentOtherActive ?? 0) === 0) {
    await admin
      .from("parents")
      .update({ current_placement_id: null, current_nanny_id: null })
      .eq("id", parentRow.id);
  }

  return { ended: true, error: null };
}

// ── SQLSTATE → error envelope mapping for the unlink RPCs ───────────
//
// Mirrors CONNECT_ERROR_MAP in child-invites.ts. Codes are stable
// (defined in migration/04-unlink-functions.sql).

const UNLINK_ERROR_MAP: Record<string, string> = {
  P0006: "child_not_found",
  P0008: "not_parent",
  P0009: "not_nanny",
};

// ── removeNannyFromChild (parent-initiated) ─────────────────────────
//
// Atomic via SECURITY DEFINER PG function `remove_nanny_from_child`.
// Closes M19 (Phase 2 deferred HIGH): app code no longer issues a
// direct UPDATE to `child_client.nanny_user_id`. The PG function
// holds `FOR UPDATE` on the child row through the entire sever +
// placement-end + per-side current_* fixup + activity-log INSERT.

export async function removeNannyFromChild(childId: string): Promise<{
  success: boolean;
  error: string | null;
}> {
  // Note: NOT gated by invitesDisabled(). This action ends an existing
  // placement; it doesn't create or modify invite rows. Blocking unlinks
  // when the kill switch is on would strand parents who need to remove
  // a nanny during the soak period. (security-reviewer H2, 2026-05-05.)
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "Not authenticated" };
    }

    const admin = createAdminClient();
    const { error } = await admin.rpc("remove_nanny_from_child", {
      p_child_id: childId,
      p_caller_user: user.id,
    });

    if (error) {
      const envelope = UNLINK_ERROR_MAP[error.code] ?? "transaction_failed";
      console.error("removeNannyFromChild rpc error:", {
        code: error.code,
        envelope,
      });
      return { success: false, error: envelope };
    }

    revalidatePath("/parent");
    return { success: true, error: null };
  } catch (err) {
    console.error("removeNannyFromChild unexpected error:", err);
    return { success: false, error: "Failed to remove nanny" };
  }
}

// ── nannyLeaveChild (nanny-initiated self-removal) ──────────────────
//
// Atomic via `nanny_leave_child` PG function. Sets `orphaned_at` when
// no parent linked (orphan limbo); pending invite is NOT revoked per
// spec 06 §3.4 — token stays alive so a future parent can still claim.

export async function nannyLeaveChild(childId: string): Promise<{
  success: boolean;
  error: string | null;
}> {
  // Not gated by invitesDisabled() — same reasoning as removeNannyFromChild
  // (security-reviewer H2, 2026-05-05).
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "Not authenticated" };
    }

    const admin = createAdminClient();
    const { error } = await admin.rpc("nanny_leave_child", {
      p_child_id: childId,
      p_caller_user: user.id,
    });

    if (error) {
      const envelope = UNLINK_ERROR_MAP[error.code] ?? "transaction_failed";
      console.error("nannyLeaveChild rpc error:", {
        code: error.code,
        envelope,
      });
      return { success: false, error: envelope };
    }

    revalidatePath("/nanny");
    return { success: true, error: null };
  } catch (err) {
    console.error("nannyLeaveChild unexpected error:", err);
    return { success: false, error: "Failed to leave child" };
  }
}

// ── deleteChild (parent-only hard delete) ───────────────────────────

export async function deleteChild(childId: string): Promise<{
  success: boolean;
  error: string | null;
}> {
  if (invitesDisabled()) {
    return { success: false, error: "invites_disabled" };
  }

  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "Not authenticated" };
    }

    const admin = createAdminClient();

    // 1. Load child + verify caller is the parent. Capture nanny for placement-end.
    const { data: child, error: loadError } = await admin
      .from("child_client")
      .select("id, parent_user_id, nanny_user_id")
      .eq("id", childId)
      .maybeSingle();
    if (loadError || !child) {
      return { success: false, error: "child_not_found" };
    }
    if (child.parent_user_id !== user.id) {
      return { success: false, error: "not_parent" };
    }
    const nannyUserIdAtDelete = child.nanny_user_id;
    const hadActivePlacement = nannyUserIdAtDelete !== null;

    // 2. Hard delete. Cascades to child_client_events, bapp_logs,
    //    bapp_progress_*, child_invites (per FK ON DELETE CASCADE).
    const { error: deleteError } = await admin
      .from("child_client")
      .delete()
      .eq("id", childId);
    if (deleteError) {
      console.error("deleteChild delete error:", deleteError);
      return { success: false, error: "delete_failed" };
    }

    // 3. End placement conditionally if a nanny was attached.
    if (nannyUserIdAtDelete) {
      const placementResult = await endPlacementForDeletedChild(
        admin,
        user.id,
        nannyUserIdAtDelete,
      );
      if (placementResult.error) {
        console.error(
          "deleteChild placement-end error:",
          placementResult.error,
        );
      }
    }

    await admin.from("activity_logs").insert({
      action_type: "child_deleted",
      user_id: user.id,
      action_details: {
        child_id: childId,
        had_active_placement: hadActivePlacement,
      },
    });

    revalidatePath("/parent");
    return { success: true, error: null };
  } catch (err) {
    console.error("deleteChild unexpected error:", err);
    return { success: false, error: "Failed to delete child" };
  }
}

// ── A-06: child profile picture ──────────────────────────────────────────

/**
 * Validates that a candidate URL is a public Supabase Storage URL pointing
 * at the `profile-pictures` bucket, in the caller's own user-id folder.
 *
 * Mirrors the validator in `lib/actions/parent.ts` (parent avatar flow).
 * The "own folder" tie keeps the persisted pointer constrained to bytes
 * the caller actually uploaded — so a parent or nanny can only set a URL
 * they themselves wrote into storage. Storage RLS already gates the
 * upload itself; this check applies the same constraint to the DB
 * pointer, defence-in-depth.
 *
 * Accepts `null` to clear the avatar (Remove Image flow).
 */
const MAX_CHILD_PICTURE_URL_LENGTH = 2048;
const UUID_REGEX_CHILD =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isValidChildPictureUrl(
  url: string | null,
  callerUserId: string,
): boolean {
  if (url === null) return true;
  if (typeof url !== "string" || url.length === 0) return false;
  if (url.length > MAX_CHILD_PICTURE_URL_LENGTH) return false;
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
  const expectedPathPrefix = "/storage/v1/object/public/profile-pictures/";
  if (!parsed.pathname.startsWith(expectedPathPrefix)) return false;

  const remainder = parsed.pathname.slice(expectedPathPrefix.length);
  const firstSegment = remainder.split("/")[0] ?? "";
  if (!UUID_REGEX_CHILD.test(firstSegment)) return false;
  if (firstSegment.toLowerCase() !== callerUserId.toLowerCase()) return false;

  return true;
}

/**
 * Updates `child_client.profile_picture_url` for a single child. The
 * caller MUST be either the parent or the nanny linked to that child;
 * any other user is rejected even if they hold a valid auth token.
 *
 * Either role can edit the avatar — A-06 is symmetric. If the parent
 * uploads, the nanny sees the new picture in the feed; if the nanny
 * uploads, the parent sees it. There is one shared
 * `profile_picture_url` per child; last-write wins.
 *
 * The bytes are written via `uploadFile("profile-pictures", ...)` on
 * the client (storage RLS gates writes to the caller's own folder).
 * This action only updates the DB pointer.
 */
export async function updateChildProfilePictureUrl(
  childClientId: string,
  newUrl: string | null,
): Promise<{ success: boolean; error: string | null }> {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "Not authenticated" };
    }

    if (!isValidChildPictureUrl(newUrl, user.id)) {
      return { success: false, error: "Invalid profile picture URL" };
    }

    // Reject malformed child ids before they reach Postgres so we
    // don't log a noisy "invalid input syntax for type uuid" error
    // for what is really a client bug or scan attempt.
    if (!UUID_REGEX_CHILD.test(childClientId)) {
      return { success: false, error: "Child not found" };
    }

    // T-015 media gate — block the SET (newUrl != null). Clearing
    // (newUrl = null) is always allowed. Dynamic import keeps the
    // existing module's import surface untouched.
    if (newUrl) {
      const { requireMediaConsentForImageWrite } =
        await import("@/lib/legal/require-media-consent");
      const mediaGate = await requireMediaConsentForImageWrite({
        childId: childClientId,
        imageUrl: newUrl,
      });
      if (!mediaGate.ok) {
        return { success: false, error: mediaGate.error };
      }
    }

    // Authorisation: caller must be parent OR nanny on this child. We
    // use the admin client here because the standard `child_client` RLS
    // policy already gates SELECT to the linked parties, but mixing
    // RLS with the explicit ownership check below is harder to reason
    // about than letting the action itself enforce the gate. The admin
    // read is followed by an explicit comparison; no data leaves the
    // server unless the caller is one of the linked users.
    const admin = createAdminClient();
    const { data: child, error: childErr } = await admin
      .from("child_client")
      .select("id, parent_user_id, nanny_user_id")
      .eq("id", childClientId)
      .maybeSingle();
    if (childErr || !child) {
      return { success: false, error: "Child not found" };
    }
    const isParent = child.parent_user_id === user.id;
    const isNanny = child.nanny_user_id === user.id;
    if (!isParent && !isNanny) {
      return { success: false, error: "Not authorised for this child" };
    }

    // SECURITY: this admin .update() bypasses RLS. The ownership
    // gate above (`isParent || isNanny`) is the ONLY enforcement
    // layer. Any future code path mutating
    // `child_client.profile_picture_url` MUST replicate the same
    // ownership check or route through this action.
    const { error: updateError } = await admin
      .from("child_client")
      .update({ profile_picture_url: newUrl })
      .eq("id", childClientId);
    if (updateError) {
      console.error(
        "[updateChildProfilePictureUrl] update error:",
        updateError,
      );
      return { success: false, error: "Failed to update profile picture" };
    }

    // Both parties see the new picture — invalidate both feeds.
    revalidatePath(`/parent/development/${childClientId}`);
    revalidatePath(`/nanny/development/${childClientId}`);
    return { success: true, error: null };
  } catch (err) {
    console.error("updateChildProfilePictureUrl unexpected error:", err);
    return { success: false, error: "Failed to update profile picture" };
  }
}

// ── updateChildDetails ───────────────────────────────────────────────
//
// Edits a child's `first_name` and / or `date_of_birth` from the
// hero-card pencil-edit dialog (A-09, 2026-05-07). Mirrors the same
// admin-client + explicit-ownership-gate pattern as
// `updateChildProfilePictureUrl` so the security model stays
// consistent across all child mutations.
//
// Validation:
//   - first_name: 1–80 chars after trim. Empty / whitespace-only is
//     rejected so the hero card never lands in the "Child" fallback.
//   - date_of_birth: ISO yyyy-mm-dd, must parse, must NOT be in the
//     future, and must satisfy the under-3 age cap. Shared validator
//     `validateChildDob` (lib/bapp/child-age.ts) is the source of
//     truth — same rules as the add-child / onboard paths so editing
//     can't bypass the cap.
// Both fields are optional individually — at least one must be set
// or the call is a no-op (returns success:false to surface the bug).

const NAME_MAX_LENGTH = 80;

function isValidFirstName(name: string | undefined): name is string {
  if (typeof name !== "string") return false;
  const trimmed = name.trim();
  return trimmed.length > 0 && trimmed.length <= NAME_MAX_LENGTH;
}

export async function updateChildDetails(
  childClientId: string,
  fields: { first_name?: string; date_of_birth?: string | null },
): Promise<{ success: boolean; error: string | null }> {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "Not authenticated" };
    }

    if (!UUID_REGEX_CHILD.test(childClientId)) {
      return { success: false, error: "Child not found" };
    }

    // Build the update payload from validated fields only. Omitting
    // a field leaves it untouched in the DB. Allowing `null` for
    // date_of_birth lets the user clear an incorrect prior entry.
    const update: { first_name?: string; date_of_birth?: string | null } = {};
    if (fields.first_name !== undefined) {
      if (!isValidFirstName(fields.first_name)) {
        return { success: false, error: "Invalid first name" };
      }
      update.first_name = fields.first_name.trim();
    }
    if (fields.date_of_birth !== undefined) {
      if (fields.date_of_birth === null) {
        update.date_of_birth = null;
      } else {
        const dobCheck = validateChildDob(fields.date_of_birth);
        if (!dobCheck.ok) {
          return { success: false, error: dobCheck.error };
        }
        update.date_of_birth = fields.date_of_birth;
      }
    }
    if (Object.keys(update).length === 0) {
      return { success: false, error: "No fields to update" };
    }

    // Ownership gate (same shape as updateChildProfilePictureUrl).
    const admin = createAdminClient();
    const { data: child, error: childErr } = await admin
      .from("child_client")
      .select("id, parent_user_id, nanny_user_id")
      .eq("id", childClientId)
      .maybeSingle();
    if (childErr || !child) {
      return { success: false, error: "Child not found" };
    }
    const isParent = child.parent_user_id === user.id;
    const isNanny = child.nanny_user_id === user.id;
    if (!isParent && !isNanny) {
      return { success: false, error: "Not authorised for this child" };
    }

    // SECURITY: admin .update() bypasses RLS. The ownership gate
    // above is the only enforcement layer.
    const { error: updateError } = await admin
      .from("child_client")
      .update(update)
      .eq("id", childClientId);
    if (updateError) {
      console.error("[updateChildDetails] update error:", updateError);
      return { success: false, error: "Failed to update child details" };
    }

    // Both parties see the new name / DOB on the hero card.
    revalidatePath(`/parent/development/${childClientId}`);
    revalidatePath(`/nanny/development/${childClientId}`);
    return { success: true, error: null };
  } catch (err) {
    console.error("updateChildDetails unexpected error:", err);
    return { success: false, error: "Failed to update child details" };
  }
}
