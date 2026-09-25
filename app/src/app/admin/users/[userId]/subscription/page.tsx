import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";
import { getAdminUserData } from "@/lib/admin/getAdminUserData";
import { SubscriptionDetailHeader } from "./SubscriptionDetailHeader";
import { SubscriptionStatsGrid } from "./SubscriptionStatsGrid";
import { SubscriptionTimeline } from "./SubscriptionTimeline";
import { buildTimelineEntries } from "./build-timeline";
import type { TimelineEntry } from "./build-timeline";

/**
 * `/admin/users/[userId]/subscription` — full subscription dossier.
 *
 * Two sections (Bailey 2026-05-14):
 *   1. At-a-glance stats — every actionable number in one grid
 *   2. Activity timeline — every event that touched this subscription
 *      or its linked children, chronologically
 *
 * Header carries quick-access buttons to the parent + linked-nanny
 * profile drawers (deep-link via `/admin/users?openUser=<id>`).
 */
export default async function AdminUserSubscriptionPage({
  params,
}: {
  params: { userId: string };
}) {
  await requireAdmin();
  const admin = createAdminClient();

  const [
    parentUserData,
    subRes,
    childrenRes,
    payoutsRes,
    refundsRes,
    activityRes,
  ] = await Promise.all([
    getAdminUserData(params.userId),
    admin
      .from("parent_subscriptions")
      .select(
        "id, status, trial_started_at, trial_ends_at, paid_period_starts_at, paid_period_ends_at, has_used_trial, stripe_customer_id, stripe_subscription_id, stripe_payment_intent_id, cancelled_at, cancellation_reason, past_due_grace_ends_at, subscription_cycle, created_at, updated_at",
      )
      .eq("parent_user_id", params.userId)
      .maybeSingle<ParentSubscriptionRow>(),
    // Split off the child_client_events embed (Supabase auto-relation
    // was returning null silently when the FK hint wasn't recognised).
    // Separate fetch is more reliable + easier to debug.
    admin
      .from("child_client")
      .select(
        "id, first_name, date_of_birth, age_months_approx, status, nanny_user_id, created_at",
      )
      .eq("parent_user_id", params.userId)
      .order("created_at", { ascending: true })
      .returns<ChildClientRow[]>(),
    admin
      .from("nanny_payouts")
      .select(
        "id, status, amount_aud_cents, paid_at, period_start, period_end, scheduled_release_at, frozen_at, failure_reason, created_at",
      )
      .eq("parent_user_id", params.userId)
      .order("created_at", { ascending: true })
      .returns<PayoutRow[]>(),
    admin
      .from("refund_requests")
      .select(
        "id, status, refund_amount_aud_cents, refund_processed_at, stripe_refund_id, reason, created_at",
      )
      .eq("parent_user_id", params.userId)
      .order("created_at", { ascending: true })
      .returns<RefundRow[]>(),
    admin
      .from("activity_logs")
      .select("id, action_type, action_details, created_at, user_id")
      .eq("user_id", params.userId)
      .order("created_at", { ascending: true })
      .limit(500)
      .returns<ActivityLogRow[]>(),
  ]);

  const sub = subRes.data;
  const childrenBase = childrenRes.data ?? [];
  const payouts = payoutsRes.data ?? [];
  const refunds = refundsRes.data ?? [];
  const activityLogs = activityRes.data ?? [];

  // Fetch child_client_events separately for these children's IDs.
  const childIds = childrenBase.map((c) => c.id);
  const childEventsRows = childIds.length
    ? ((
        await admin
          .from("child_client_events")
          .select(
            "child_client_id, created_auto_at, created_manual_at, setup_at, active_nanny_at, trial_at, trial_ended_at, active_at, closed_at",
          )
          .in("child_client_id", childIds)
          .returns<ChildClientEventsRow[]>()
      ).data ?? [])
    : [];
  const eventsByChildId = new Map<string, ChildClientEvents>();
  for (const e of childEventsRows) {
    eventsByChildId.set(e.child_client_id, e);
  }
  const children: ChildWithEvents[] = childrenBase.map((c) => ({
    ...c,
    child_client_events: eventsByChildId.get(c.id) ?? null,
  }));

  // Resolve linked nanny — single-nanny-per-parent invariant trusted
  // elsewhere in the app. Use the freshest row first to avoid picking
  // up a stale closed/historical link.
  const nannyUserId =
    [...childrenBase]
      .reverse()
      .find((c) => c.nanny_user_id !== null && c.status !== "closed")
      ?.nanny_user_id ?? null;
  const nannyUserData = nannyUserId
    ? await getAdminUserData(nannyUserId)
    : null;

  // Test-user flag — used for the header amber pill. Derived directly
  // since UserData doesn't carry is_test_user.
  const { data: testFlagRow } = await admin
    .from("user_profiles")
    .select("is_test_user")
    .eq("user_id", params.userId)
    .maybeSingle<{ is_test_user: boolean | null }>();
  const parentIsTestUser = testFlagRow?.is_test_user ?? false;

  // Pull nanny-side activity logs too — commission events log against
  // the parent user (already covered) but a subset (e.g. payout_paid)
  // logs against the nanny. We merge a narrow set in for completeness.
  const nannyLogs: ActivityLogRow[] = nannyUserId
    ? ((
        await admin
          .from("activity_logs")
          .select("id, action_type, action_details, created_at, user_id")
          .eq("user_id", nannyUserId)
          .in("action_type", [
            "payout_paid",
            "payout_failed",
            "payout_created",
            "nanny_account_updated",
            "payout_application_status_changed",
          ])
          .order("created_at", { ascending: true })
          .limit(200)
          .returns<ActivityLogRow[]>()
      ).data ?? [])
    : [];

  // Derived metrics — everything an admin glances at on the stats grid.
  const cumulativeSpendAud = computeCumulativeSpend({ sub, activityLogs });
  const failedPaymentCount = activityLogs.filter(
    (l) => l.action_type === "subscription_past_due",
  ).length;
  const recoveryCount = activityLogs.filter(
    (l) => l.action_type === "subscription_recovered",
  ).length;
  const cancelCount = activityLogs.filter(
    (l) => l.action_type === "subscription_cancelled",
  ).length;
  const refundCount = refunds.filter(
    (r) => r.refund_processed_at !== null,
  ).length;
  const refundedTotalAud =
    refunds
      .filter((r) => r.refund_processed_at !== null)
      .reduce((acc, r) => acc + (r.refund_amount_aud_cents ?? 0), 0) / 100;
  const subscriberSinceIso =
    sub?.paid_period_starts_at ??
    sub?.trial_started_at ??
    sub?.created_at ??
    null;
  const tenureDays = subscriberSinceIso
    ? Math.max(
        0,
        Math.floor(
          (Date.now() - new Date(subscriberSinceIso).getTime()) /
            (1000 * 60 * 60 * 24),
        ),
      )
    : null;
  const plan = derivePlanLabel(sub);

  const timeline: TimelineEntry[] = buildTimelineEntries({
    sub,
    children,
    payouts,
    refunds,
    activityLogs,
    nannyLogs,
  });

  return (
    <div className="mx-auto max-w-6xl px-4 py-10">
      <Link
        href="/admin/subscriptions"
        className="text-sm text-slate-500 hover:text-slate-700"
      >
        ← Back to subscriptions
      </Link>

      <SubscriptionDetailHeader
        parentUserData={parentUserData}
        parentIsTestUser={parentIsTestUser}
        nannyUserData={nannyUserData}
        sub={sub}
      />

      <SubscriptionStatsGrid
        sub={sub}
        plan={plan}
        subscriberSinceIso={subscriberSinceIso}
        tenureDays={tenureDays}
        cumulativeSpendAud={cumulativeSpendAud}
        refundedTotalAud={refundedTotalAud}
        failedPaymentCount={failedPaymentCount}
        recoveryCount={recoveryCount}
        cancelCount={cancelCount}
        refundCount={refundCount}
        linkedChildren={children}
      />

      <SubscriptionTimeline entries={timeline} />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Types — shared with the section components.
// ---------------------------------------------------------------------------

export interface ParentSubscriptionRow {
  id: string;
  status:
    | "trial"
    | "active_monthly"
    | "active_upfront"
    | "past_due"
    | "cancelled"
    | "lapsed";
  trial_started_at: string | null;
  trial_ends_at: string | null;
  paid_period_starts_at: string | null;
  paid_period_ends_at: string | null;
  has_used_trial: boolean;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  stripe_payment_intent_id: string | null;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  past_due_grace_ends_at: string | null;
  subscription_cycle: number;
  created_at: string;
  updated_at: string;
}

export interface ChildClientEvents {
  created_auto_at: string | null;
  created_manual_at: string | null;
  setup_at: string | null;
  active_nanny_at: string | null;
  trial_at: string | null;
  trial_ended_at: string | null;
  active_at: string | null;
  closed_at: string | null;
}

export interface ChildClientRow {
  id: string;
  first_name: string | null;
  date_of_birth: string | null;
  age_months_approx: number | null;
  status: string;
  nanny_user_id: string | null;
  created_at: string;
}

export interface ChildClientEventsRow extends ChildClientEvents {
  child_client_id: string;
}

export interface ChildWithEvents extends ChildClientRow {
  child_client_events: ChildClientEvents | null;
}

export interface PayoutRow {
  id: string;
  status: string;
  amount_aud_cents: number;
  paid_at: string | null;
  period_start: string;
  period_end: string;
  scheduled_release_at: string | null;
  frozen_at: string | null;
  failure_reason: string | null;
  created_at: string;
}

export interface RefundRow {
  id: string;
  status: string;
  refund_amount_aud_cents: number | null;
  refund_processed_at: string | null;
  stripe_refund_id: string | null;
  reason: string | null;
  created_at: string;
}

export interface ActivityLogRow {
  id: string;
  action_type: string;
  action_details: Record<string, unknown> | null;
  created_at: string;
  user_id: string | null;
}

// ---------------------------------------------------------------------------
// Derived metrics.
// ---------------------------------------------------------------------------

function derivePlanLabel(
  sub: ParentSubscriptionRow | null,
): "Monthly" | "Upfront" | "Trial" | "—" {
  if (!sub) return "—";
  if (sub.status === "trial") return "Trial";
  if (sub.stripe_subscription_id) return "Monthly";
  if (sub.stripe_payment_intent_id) return "Upfront";
  return "—";
}

/**
 * Cumulative AUD this parent has paid us. Monthly = £200 per renewal
 * cycle; upfront = £1,000 one-off. Derived from activity_logs because
 * the source of truth is the audit trail, not a column we maintain.
 */
function computeCumulativeSpend(args: {
  sub: ParentSubscriptionRow | null;
  activityLogs: ActivityLogRow[];
}): number {
  const { sub, activityLogs } = args;
  if (!sub) return 0;
  const isMonthly = sub.stripe_subscription_id !== null;
  if (isMonthly) {
    // Each subscription_started + subscription_renewed = one £200 paid cycle.
    const paidCycles = activityLogs.filter(
      (l) =>
        l.action_type === "subscription_started" ||
        l.action_type === "subscription_renewed",
    ).length;
    return paidCycles * 200;
  }
  // Upfront = one-off £1,000 on subscription_started.
  return activityLogs.some((l) => l.action_type === "subscription_started")
    ? 1000
    : 0;
}
