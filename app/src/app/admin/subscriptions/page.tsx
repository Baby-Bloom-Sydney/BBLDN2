import Link from "next/link";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireAdmin } from "@/lib/admin/require-admin";
import { Card, CardContent } from "@/components/ui/card";
import { formatAuDate } from "@/lib/format/date";
import { AdminSubscriptionsClient } from "./AdminSubscriptionsClient";
import type { AdminSubscriptionRow, AdminSubscriptionCounters } from "./types";

/**
 * `/admin/subscriptions` — operational overview of every parent
 * subscription. The list is built to drive admin decisions, not just
 * surface data.
 *
 * What admin glances at, in priority order (Bailey 2026-05-14):
 *   - Counters: how many in each status, MRR, attention queue
 *   - Quick filters mapped to admin workflows: needs attention,
 *     active, trial about to end, recent cancellations
 *   - Search by name / email
 *   - Per-row signal: status pill, plan, tenure, lifetime spend,
 *     next event date, failed-payments badge, nanny-linked indicator
 *
 * Client-side filtering + search is in `AdminSubscriptionsClient.tsx`.
 * This file is the data-loading + counters server component.
 */
export default async function AdminSubscriptionsPage() {
  await requireAdmin();
  const admin = createAdminClient();

  const [
    { data: subs },
    { data: profiles },
    { data: childRows },
    { data: logs },
  ] = await Promise.all([
    admin
      .from("parent_subscriptions")
      .select(
        "parent_user_id, status, trial_started_at, trial_ends_at, paid_period_starts_at, paid_period_ends_at, past_due_grace_ends_at, stripe_subscription_id, stripe_payment_intent_id, subscription_cycle, cancelled_at, cancellation_reason, updated_at, created_at",
      )
      .order("updated_at", { ascending: false })
      .limit(500)
      .returns<RawSubRow[]>(),
    admin
      .from("user_profiles")
      .select("user_id, first_name, last_name, email")
      .returns<RawProfileRow[]>(),
    admin
      .from("child_client")
      .select("parent_user_id, nanny_user_id")
      .returns<RawChildRow[]>(),
    admin
      .from("activity_logs")
      .select("user_id, action_type")
      .in("action_type", [
        "subscription_started",
        "subscription_renewed",
        "subscription_past_due",
      ])
      .returns<RawLogRow[]>(),
  ]);

  const subsRows = subs ?? [];
  const profilesRows = profiles ?? [];
  const childrenRows = childRows ?? [];
  const logRows = logs ?? [];

  const profilesByUserId = new Map<string, RawProfileRow>();
  for (const p of profilesRows) profilesByUserId.set(p.user_id, p);

  const hasNannyByParent = new Map<string, boolean>();
  for (const c of childrenRows) {
    if (c.nanny_user_id && c.parent_user_id) {
      hasNannyByParent.set(c.parent_user_id, true);
    }
  }

  // Per-user counts of paid cycles + failed payments, derived from
  // activity_logs (the audit trail is the source of truth).
  const paidCyclesByUserId = new Map<string, number>();
  const failedByUserId = new Map<string, number>();
  for (const log of logRows) {
    if (!log.user_id) continue;
    if (
      log.action_type === "subscription_started" ||
      log.action_type === "subscription_renewed"
    ) {
      paidCyclesByUserId.set(
        log.user_id,
        (paidCyclesByUserId.get(log.user_id) ?? 0) + 1,
      );
    } else if (log.action_type === "subscription_past_due") {
      failedByUserId.set(
        log.user_id,
        (failedByUserId.get(log.user_id) ?? 0) + 1,
      );
    }
  }

  const enriched: AdminSubscriptionRow[] = subsRows.map((s) => {
    const profile = profilesByUserId.get(s.parent_user_id);
    const fullName =
      [profile?.first_name, profile?.last_name].filter(Boolean).join(" ") || "";
    const isMonthly = s.stripe_subscription_id !== null;
    const plan: "monthly" | "upfront" | "trial" | "none" =
      s.status === "trial"
        ? "trial"
        : isMonthly
          ? "monthly"
          : s.stripe_payment_intent_id
            ? "upfront"
            : "none";

    const paidCycles = paidCyclesByUserId.get(s.parent_user_id) ?? 0;
    const cumulativeSpendAud = isMonthly
      ? paidCycles * 200
      : plan === "upfront"
        ? 1000
        : 0;
    const failedPayments = failedByUserId.get(s.parent_user_id) ?? 0;
    const subscriberSinceIso =
      s.paid_period_starts_at ?? s.trial_started_at ?? s.created_at ?? null;
    const tenureDays = subscriberSinceIso
      ? Math.max(
          0,
          Math.floor(
            (Date.now() - new Date(subscriberSinceIso).getTime()) /
              (1000 * 60 * 60 * 24),
          ),
        )
      : null;

    const nextEventIso =
      s.status === "trial"
        ? s.trial_ends_at
        : s.status === "past_due"
          ? s.past_due_grace_ends_at
          : s.paid_period_ends_at;

    return {
      parentUserId: s.parent_user_id,
      fullName,
      email: profile?.email ?? null,
      status: s.status,
      plan,
      tenureDays,
      subscriberSinceIso,
      cumulativeSpendAud,
      cycle: s.subscription_cycle,
      nextEventIso,
      nextEventLabel: nextEventLabelForStatus(s.status),
      failedPayments,
      hasNanny: hasNannyByParent.get(s.parent_user_id) ?? false,
      cancellationReason: s.cancellation_reason,
      updatedAtIso: s.updated_at,
    };
  });

  // Counters across the WHOLE table — independent of any client filter.
  const counters: AdminSubscriptionCounters = {
    activeMonthly: enriched.filter((r) => r.status === "active_monthly").length,
    activeUpfront: enriched.filter((r) => r.status === "active_upfront").length,
    trial: enriched.filter((r) => r.status === "trial").length,
    pastDue: enriched.filter((r) => r.status === "past_due").length,
    cancelled: enriched.filter((r) => r.status === "cancelled").length,
    lapsed: enriched.filter((r) => r.status === "lapsed").length,
  };
  const mrrAud = counters.activeMonthly * 200;
  const cumulativeRevenueAud = enriched.reduce(
    (acc, r) => acc + r.cumulativeSpendAud,
    0,
  );
  const needsAttentionCount = enriched.filter(isNeedsAttention).length;

  return (
    <div className="mx-auto max-w-7xl px-4 py-10">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">
            Subscriptions overview
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            {enriched.length} parent{enriched.length === 1 ? "" : "s"} on file ·{" "}
            {needsAttentionCount} need
            {needsAttentionCount === 1 ? "s" : ""} attention
          </p>
        </div>
        <Card className="border-violet-200 bg-violet-50/50">
          <CardContent className="px-5 py-3 text-right">
            <p className="text-[10px] font-medium uppercase tracking-wide text-violet-700">
              MRR
            </p>
            <p className="text-xl font-bold text-slate-900">
              £{mrrAud.toLocaleString("en-AU")}
            </p>
            <p className="text-xs text-slate-500">
              Lifetime £{cumulativeRevenueAud.toLocaleString("en-AU")}
            </p>
          </CardContent>
        </Card>
      </div>

      <div className="mt-6 grid grid-cols-2 gap-3 md:grid-cols-6">
        <Counter
          label="Active monthly"
          value={counters.activeMonthly}
          tone="active"
        />
        <Counter
          label="Active upfront"
          value={counters.activeUpfront}
          tone="active"
        />
        <Counter label="Trial" value={counters.trial} tone="info" />
        <Counter label="Past due" value={counters.pastDue} tone="warn" />
        <Counter label="Cancelled" value={counters.cancelled} tone="muted" />
        <Counter label="Lapsed" value={counters.lapsed} tone="muted" />
      </div>

      <AdminSubscriptionsClient
        rows={enriched}
        needsAttentionCount={needsAttentionCount}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Helpers + types.
// ---------------------------------------------------------------------------

interface RawSubRow {
  parent_user_id: string;
  status: AdminSubscriptionRow["status"];
  trial_started_at: string | null;
  trial_ends_at: string | null;
  paid_period_starts_at: string | null;
  paid_period_ends_at: string | null;
  past_due_grace_ends_at: string | null;
  stripe_subscription_id: string | null;
  stripe_payment_intent_id: string | null;
  subscription_cycle: number;
  cancelled_at: string | null;
  cancellation_reason: string | null;
  updated_at: string;
  created_at: string;
}

interface RawProfileRow {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

interface RawChildRow {
  parent_user_id: string | null;
  nanny_user_id: string | null;
}

interface RawLogRow {
  user_id: string | null;
  action_type: string;
}

function nextEventLabelForStatus(
  status: AdminSubscriptionRow["status"],
): string {
  if (status === "trial") return "Trial ends";
  if (status === "past_due") return "Grace ends";
  if (status === "cancelled") return "Access until";
  if (status === "lapsed") return "—";
  return "Next renewal";
}

function isNeedsAttention(row: AdminSubscriptionRow): boolean {
  if (row.status === "past_due") return true;
  if (
    row.status === "trial" &&
    row.nextEventIso &&
    new Date(row.nextEventIso).getTime() - Date.now() < 3 * 24 * 60 * 60 * 1000
  ) {
    return true;
  }
  return false;
}

function Counter({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "warn" | "muted" | "info" | "active";
}) {
  const map: Record<"warn" | "muted" | "info" | "active", string> = {
    warn: "text-amber-700",
    muted: "text-slate-500",
    info: "text-violet-700",
    active: "text-emerald-700",
  };
  const valueClass = tone ? map[tone] : "text-slate-900";
  return (
    <Card>
      <CardContent className="p-3">
        <p className="text-[11px] font-medium uppercase tracking-wide text-slate-500">
          {label}
        </p>
        <p className={`mt-1 text-2xl font-bold ${valueClass}`}>{value}</p>
      </CardContent>
    </Card>
  );
}
