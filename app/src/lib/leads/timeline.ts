// T-032 — Curated activity timeline composer (Option B from spec).
// Composes a per-nanny timeline by querying ~6 source tables in parallel
// and merging in TypeScript. Stable shape; easy to add sources later.

import { createAdminClient } from "@/lib/supabase/admin";
import type { TimelineEvent, TimelineEventCategory } from "./types";

const TIMELINE_DEFAULT_LIMIT = 80;

// Subset of activity_logs.action_type values meaningful to an operator.
const OPERATOR_RELEVANT_ACTIONS = new Set([
  "signup",
  "profile_updated",
  "profile_deactivated",
  "nanny_profile_created",
  "nanny_verification_submitted",
  "nanny_tier_upgraded",
  "wwcc_expired",
  "wwcc_renewed",
  "admin_override",
  "verification_approved",
  "verification_rejected",
  "user_suspended",
  "user_reinstated",
  "invite_created",
  "invite_connected",
  "invite_declined",
  "invite_revoked",
  "nanny_left_child",
  "nanny_removed_by_parent",
  "trial_started",
  "commission_scheduled",
  "commission_released",
  "commission_held",
  "commission_cancelled",
  "payout_send_failed",
  "payout_paid",
  "payout_failed",
  "payout_application_started",
  "payout_application_status_changed",
  "nanny_account_updated",
  "payouts_held_due_to_no_abn",
  "abn_updated",
  "abn_push_flagged_for_admin",
]);

function activityCategory(actionType: string): TimelineEventCategory {
  if (
    actionType === "signup" ||
    actionType.startsWith("nanny_profile") ||
    actionType === "profile_updated"
  )
    return "profile";
  if (
    actionType.includes("verification") ||
    actionType.startsWith("wwcc") ||
    actionType.includes("identity")
  )
    return "verification";
  if (actionType.startsWith("interview")) return "position";
  if (actionType.startsWith("babysitting")) return "babysitting";
  if (actionType.startsWith("placement")) return "placement";
  if (actionType.startsWith("payout") || actionType.startsWith("commission"))
    return "payout";
  if (actionType.startsWith("subscription") || actionType.startsWith("trial"))
    return "subscription";
  if (
    actionType.startsWith("invite") ||
    actionType.startsWith("child") ||
    actionType.includes("child")
  )
    return "child";
  if (
    actionType.startsWith("abn") ||
    actionType === "admin_override" ||
    actionType === "user_suspended" ||
    actionType === "user_reinstated"
  )
    return "admin";
  return "other";
}

function actionTitle(actionType: string): string {
  return actionType
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

export async function fetchActivityTimeline(
  nannyUserId: string,
  nannyId: string | null,
  limit: number = TIMELINE_DEFAULT_LIMIT,
): Promise<TimelineEvent[]> {
  const supa = createAdminClient();

  const [
    activityRes,
    userProgressRes,
    payoutsRes,
    emailsRes,
    consentRes,
    placementsRes,
  ] = await Promise.all([
    supa
      .from("activity_logs")
      .select("created_at, action_type, action_details")
      .eq("user_id", nannyUserId)
      .order("created_at", { ascending: false })
      .limit(limit),
    supa
      .from("user_progress")
      .select("reached_at, stage, stage_data")
      .eq("user_id", nannyUserId)
      .order("reached_at", { ascending: false }),
    supa
      .from("nanny_payouts")
      .select(
        "amount_aud_cents, status, scheduled_release_at, sent_at, paid_at, failed_at, failure_reason, created_at",
      )
      .eq("nanny_user_id", nannyUserId)
      .order("created_at", { ascending: false })
      .limit(20),
    supa
      .from("email_logs")
      .select("email_type, subject, status, sent_at, failed_at, created_at")
      .eq("recipient_user_id", nannyUserId)
      .order("created_at", { ascending: false })
      .limit(40),
    supa
      .from("consent_records")
      .select("agreement_id, checkpoint_id, consent_given, created_at")
      .eq("user_id", nannyUserId)
      .order("created_at", { ascending: false })
      .limit(20),
    nannyId
      ? supa
          .from("nanny_placements")
          .select("hired_at, ended_at, end_reason, source, status")
          .eq("nanny_id", nannyId)
          .order("hired_at", { ascending: false })
          .limit(20)
      : Promise.resolve({ data: null }),
  ]);

  const events: TimelineEvent[] = [];

  // activity_logs (filtered to operator-relevant subset).
  for (const row of activityRes.data ?? []) {
    if (!OPERATOR_RELEVANT_ACTIONS.has(row.action_type)) continue;
    events.push({
      event_at: row.created_at,
      category: activityCategory(row.action_type),
      title: actionTitle(row.action_type),
      detail: summariseActionDetails(row.action_details),
      source: "activity_logs",
    });
  }

  // user_progress milestones.
  for (const row of userProgressRes.data ?? []) {
    events.push({
      event_at: row.reached_at,
      category: row.stage?.includes("verif")
        ? "verification"
        : row.stage?.includes("interview") || row.stage?.includes("hire")
          ? "position"
          : "profile",
      title: `Milestone: ${actionTitle(row.stage ?? "unknown")}`,
      detail: null,
      source: "user_progress",
    });
  }

  // Payouts.
  for (const row of payoutsRes.data ?? []) {
    const amount = `£${(row.amount_aud_cents / 100).toFixed(2)}`;
    let title = `Payout ${row.status}`;
    let when = row.created_at;
    if (row.paid_at) {
      title = `Payout paid (${amount})`;
      when = row.paid_at;
    } else if (row.sent_at) {
      title = `Payout sent (${amount})`;
      when = row.sent_at;
    } else if (row.failed_at) {
      title = `Payout failed`;
      when = row.failed_at;
    }
    events.push({
      event_at: when,
      category: "payout",
      title,
      detail:
        row.failure_reason ??
        (row.scheduled_release_at
          ? `Scheduled ${row.scheduled_release_at}`
          : null),
      source: "nanny_payouts",
    });
  }

  // Emails sent to the nanny (high-signal subset only).
  for (const row of emailsRes.data ?? []) {
    if (!row.sent_at) continue;
    events.push({
      event_at: row.sent_at,
      category: "email",
      title: `Email: ${row.subject ?? row.email_type}`,
      detail: row.status,
      source: "email_logs",
    });
  }

  // Consent gates passed.
  for (const row of consentRes.data ?? []) {
    events.push({
      event_at: row.created_at,
      category: "consent",
      title: `Consent: ${row.agreement_id}${row.checkpoint_id ? ` / ${row.checkpoint_id}` : ""}`,
      detail: row.consent_given ? "Given" : "Withdrawn",
      source: "consent_records",
    });
  }

  // Placements.
  for (const row of placementsRes.data ?? []) {
    if (row.hired_at) {
      events.push({
        event_at: row.hired_at,
        category: "placement",
        title: `Placement created (${row.source ?? "unknown"})`,
        detail: null,
        source: "nanny_placements",
      });
    }
    if (row.ended_at) {
      events.push({
        event_at: row.ended_at,
        category: "placement",
        title: `Placement ended`,
        detail: row.end_reason ?? null,
        source: "nanny_placements",
      });
    }
  }

  // Sort by event_at desc and cap.
  events.sort((a, b) => (b.event_at > a.event_at ? 1 : -1));
  return events.slice(0, limit);
}

function summariseActionDetails(details: unknown): string | null {
  if (!details || typeof details !== "object") return null;
  try {
    const entries = Object.entries(details as Record<string, unknown>).slice(
      0,
      3,
    );
    if (entries.length === 0) return null;
    return entries.map(([k, v]) => `${k}: ${String(v)}`).join(" · ");
  } catch {
    return null;
  }
}
