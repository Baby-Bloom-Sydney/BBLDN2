import type {
  ActivityLogRow,
  ChildWithEvents,
  ParentSubscriptionRow,
  PayoutRow,
  RefundRow,
} from "./page";

/**
 * Merged + sorted timeline for the subscription detail page.
 *
 * Sources:
 *   - activity_logs (parent + nanny side)
 *   - child_client_events (lifecycle timestamps per child)
 *   - parent_subscriptions (key state timestamps not always logged)
 *   - nanny_payouts (status transitions)
 *   - refund_requests
 *
 * Output is chronological NEWEST FIRST (admin scans most-recent
 * events). Each entry has a stable kind, a one-line title, a detail
 * subtitle, and a colour-coded category.
 */

export type TimelineCategory =
  | "subscription"
  | "billing"
  | "child"
  | "commission"
  | "refund"
  | "system";

export interface TimelineEntry {
  id: string;
  timestampIso: string;
  category: TimelineCategory;
  title: string;
  detail?: string;
}

interface BuildArgs {
  sub: ParentSubscriptionRow | null;
  children: ChildWithEvents[];
  payouts: PayoutRow[];
  refunds: RefundRow[];
  activityLogs: ActivityLogRow[];
  nannyLogs: ActivityLogRow[];
}

export function buildTimelineEntries(args: BuildArgs): TimelineEntry[] {
  const { sub, children, payouts, refunds, activityLogs, nannyLogs } = args;
  const entries: TimelineEntry[] = [];

  // ---- Activity log events (parent side) -------------------------------------
  for (const log of activityLogs) {
    const formatted = formatActivityLog(log);
    if (formatted) entries.push(formatted);
  }

  // ---- Nanny-side payout events ---------------------------------------------
  for (const log of nannyLogs) {
    const formatted = formatActivityLog(log);
    if (formatted) entries.push({ ...formatted, id: `n:${formatted.id}` });
  }

  // ---- Child lifecycle events (from child_client_events) --------------------
  for (const child of children) {
    const events = child.child_client_events;
    if (!events) continue;
    const label = child.first_name ?? "Child";
    const lifecyclePairs: Array<[keyof typeof events, string, string]> = [
      ["created_auto_at", "Child auto-created", "via nanny linking flow"],
      ["created_manual_at", "Child added", "by parent"],
      ["setup_at", "Child setup completed", ""],
      ["active_nanny_at", "Nanny linked to child", ""],
      ["trial_at", "Trial started for child", ""],
      ["trial_ended_at", "Trial ended", ""],
      ["active_at", "Child became active", ""],
      ["closed_at", "Child closed", ""],
    ];
    for (const [field, title, detailSuffix] of lifecyclePairs) {
      const iso = events[field];
      if (!iso) continue;
      entries.push({
        id: `child:${child.id}:${field}`,
        timestampIso: iso,
        category: "child",
        title: `${title} — ${label}`,
        detail: detailSuffix || undefined,
      });
    }
  }

  // ---- Payout lifecycle -----------------------------------------------------
  for (const p of payouts) {
    if (p.paid_at) {
      entries.push({
        id: `payout:${p.id}:paid`,
        timestampIso: p.paid_at,
        category: "commission",
        title: `Payout paid to nanny — £${(p.amount_aud_cents / 100).toFixed(0)}`,
        detail: `Period ${p.period_start} → ${p.period_end}`,
      });
    }
    if (p.frozen_at) {
      entries.push({
        id: `payout:${p.id}:frozen`,
        timestampIso: p.frozen_at,
        category: "commission",
        title: `Payout frozen — £${(p.amount_aud_cents / 100).toFixed(0)}`,
        detail: p.failure_reason ?? "frozen on cancel",
      });
    }
  }

  // ---- Refund requests ------------------------------------------------------
  for (const r of refunds) {
    entries.push({
      id: `refund:${r.id}:requested`,
      timestampIso: r.created_at,
      category: "refund",
      title: "Refund requested",
      detail: r.reason ?? undefined,
    });
    if (r.refund_processed_at) {
      const amount = r.refund_amount_aud_cents ?? 0;
      entries.push({
        id: `refund:${r.id}:processed`,
        timestampIso: r.refund_processed_at,
        category: "refund",
        title: `Refund processed — £${(amount / 100).toFixed(0)}`,
        detail: r.stripe_refund_id ?? undefined,
      });
    }
  }

  // ---- Subscription canonical timestamps not always in activity_logs --------
  if (sub) {
    if (sub.created_at) {
      entries.push({
        id: `sub:${sub.id}:created`,
        timestampIso: sub.created_at,
        category: "subscription",
        title: "Subscription record created",
      });
    }
    if (sub.trial_started_at) {
      entries.push({
        id: `sub:${sub.id}:trial_started`,
        timestampIso: sub.trial_started_at,
        category: "subscription",
        title: "Trial started",
        detail: sub.trial_ends_at
          ? `Ends ${formatShortDateIso(sub.trial_ends_at)}`
          : undefined,
      });
    }
  }

  // De-dupe (multiple sources may surface the same logical event).
  const dedup = new Map<string, TimelineEntry>();
  for (const e of entries) {
    const key = `${e.timestampIso}|${e.title}`;
    if (!dedup.has(key)) dedup.set(key, e);
  }
  return Array.from(dedup.values()).sort((a, b) =>
    b.timestampIso.localeCompare(a.timestampIso),
  );
}

// ---------------------------------------------------------------------------
// Activity-log formatting.
// ---------------------------------------------------------------------------

const ACTIVITY_TO_TIMELINE: Record<
  string,
  { category: TimelineCategory; title: string }
> = {
  signup_via_invite: { category: "child", title: "Signed up via invite" },
  invite_created: { category: "child", title: "Invite created" },
  invite_declined: { category: "child", title: "Invite declined" },
  invite_revoked: { category: "child", title: "Invite revoked" },
  child_deleted: { category: "child", title: "Child removed" },
  subscription_started: {
    category: "subscription",
    title: "Subscription started",
  },
  subscription_renewed: { category: "billing", title: "Subscription renewed" },
  subscription_recovered: {
    category: "billing",
    title: "Recovered from past_due",
  },
  subscription_past_due: { category: "billing", title: "Payment failed" },
  subscription_cancelled: {
    category: "subscription",
    title: "Subscription cancelled",
  },
  commission_scheduled: {
    category: "commission",
    title: "Commission scheduled",
  },
  commission_held: { category: "commission", title: "Commission frozen" },
  commission_released: { category: "commission", title: "Commission released" },
  payout_paid: { category: "commission", title: "Payout paid (nanny)" },
  payout_failed: { category: "commission", title: "Payout failed (nanny)" },
  payout_created: { category: "commission", title: "Payout created (nanny)" },
  payout_application_status_changed: {
    category: "system",
    title: "Nanny payout application status changed",
  },
  nanny_account_updated: { category: "system", title: "Nanny account updated" },
  refund_processed: { category: "refund", title: "Refund processed" },
  duplicate_checkout_refunded: {
    category: "refund",
    title: "Duplicate checkout auto-refunded",
  },
  test_user_flag_changed: {
    category: "system",
    title: "Test-user flag changed",
  },
  contact_message_replied: {
    category: "system",
    title: "Support reply sent",
  },
};

function formatActivityLog(log: ActivityLogRow): TimelineEntry | null {
  const mapping = ACTIVITY_TO_TIMELINE[log.action_type];
  if (!mapping) return null;
  return {
    id: `log:${log.id}`,
    timestampIso: log.created_at,
    category: mapping.category,
    title: mapping.title,
    detail: extractDetail(log),
  };
}

function extractDetail(log: ActivityLogRow): string | undefined {
  const d = log.action_details;
  if (!d) return undefined;
  const parts: string[] = [];
  // Show the most useful 1-2 fields per event type without dumping JSON.
  if (typeof d.plan === "string") parts.push(`Plan: ${d.plan}`);
  if (typeof d.reason === "string") parts.push(`Reason: ${d.reason}`);
  if (typeof d.cycle_index === "number") parts.push(`Cycle ${d.cycle_index}`);
  if (typeof d.amount_aud_cents === "number") {
    parts.push(`£${(d.amount_aud_cents / 100).toFixed(0)}`);
  }
  if (typeof d.frozen_count === "number") {
    parts.push(`${d.frozen_count} row${d.frozen_count === 1 ? "" : "s"}`);
  }
  if (typeof d.unfrozen_count === "number") {
    parts.push(`${d.unfrozen_count} row${d.unfrozen_count === 1 ? "" : "s"}`);
  }
  return parts.length > 0 ? parts.join(" · ") : undefined;
}

function formatShortDateIso(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Inline so we don't import the formatter module into this lib file.
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()}`;
}
