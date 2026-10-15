import { Card, CardContent } from "@/components/ui/card";
import { formatAuDate } from "@/lib/format/date";
import type { ChildWithEvents, ParentSubscriptionRow } from "./page";
import { APP_LOCALE } from "@/lib/constants";
import { G2 } from "@/config/offer";

/**
 * 4c adds `satisfaction_window_ends_at` (amendment 12) to the row and the page's
 * select. Read through this local, optional widening so the grid compiles and
 * renders "—" before and after 4c lands (4d).
 */
type SubWithWindow = ParentSubscriptionRow & {
  satisfaction_window_ends_at?: string | null;
};

interface Props {
  sub: SubWithWindow | null;
  plan: "Monthly" | "Upfront" | "Trial" | "—";
  subscriberSinceIso: string | null;
  tenureDays: number | null;
  cumulativeSpendAud: number;
  refundedTotalAud: number;
  failedPaymentCount: number;
  recoveryCount: number;
  cancelCount: number;
  refundCount: number;
  linkedChildren: ChildWithEvents[];
}

const STATUS_PILL: Record<string, { label: string; tone: PillTone }> = {
  trial: { label: "Trial", tone: "info" },
  active_monthly: { label: "Active monthly", tone: "active" },
  active_upfront: { label: "Active upfront", tone: "active" },
  past_due: { label: "Past due", tone: "warn" },
  cancelled: { label: "Cancelled", tone: "muted" },
  lapsed: { label: "Lapsed", tone: "muted" },
};

type PillTone = "active" | "warn" | "info" | "muted";

export function SubscriptionStatsGrid({
  sub,
  plan,
  subscriberSinceIso,
  tenureDays,
  cumulativeSpendAud,
  refundedTotalAud,
  failedPaymentCount,
  recoveryCount,
  cancelCount,
  refundCount,
  linkedChildren,
}: Props) {
  const status = sub
    ? (STATUS_PILL[sub.status] ?? {
        label: sub.status,
        tone: "muted" as PillTone,
      })
    : null;

  const periodEndIso =
    sub?.status === "trial"
      ? sub.trial_ends_at
      : sub?.status === "past_due"
        ? sub.past_due_grace_ends_at
        : (sub?.paid_period_ends_at ?? null);
  const periodEndLabel =
    sub?.status === "trial"
      ? "Trial ends"
      : sub?.status === "past_due"
        ? "Grace ends"
        : sub?.status === "cancelled"
          ? "Access until"
          : "Next renewal";

  return (
    <section className="mt-6">
      <h2 className="text-sm font-medium uppercase tracking-wide text-slate-500">
        At a glance
      </h2>
      <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard
          label="Status"
          valueNode={
            status ? (
              <StatusPill label={status.label} tone={status.tone} />
            ) : (
              <span className="text-slate-500">—</span>
            )
          }
        />
        <StatCard label="Plan" value={plan} />
        <StatCard
          label="Subscriber since"
          value={subscriberSinceIso ? formatAuDate(subscriberSinceIso) : "—"}
          sub={
            tenureDays !== null
              ? `${tenureDays} day${tenureDays === 1 ? "" : "s"}`
              : null
          }
        />
        <StatCard
          label="Cumulative spend"
          value={`£${cumulativeSpendAud.toLocaleString(APP_LOCALE)}`}
          sub={
            refundedTotalAud > 0
              ? `£${refundedTotalAud.toFixed(0)} refunded`
              : null
          }
          tone={refundedTotalAud > 0 ? "muted" : undefined}
        />

        <StatCard
          label="Cycle"
          value={sub ? String(sub.subscription_cycle) : "—"}
        />
        <StatCard
          label={periodEndLabel}
          value={periodEndIso ? formatAuDate(periodEndIso) : "—"}
          tone={sub?.status === "past_due" ? "warn" : undefined}
        />
        <StatCard
          label="Failed payments"
          value={String(failedPaymentCount)}
          tone={failedPaymentCount > 0 ? "warn" : undefined}
          sub={recoveryCount > 0 ? `${recoveryCount} recovered` : null}
        />
        <StatCard
          label="Cancellations"
          value={String(cancelCount)}
          sub={
            sub?.cancellation_reason ? `Last: ${sub.cancellation_reason}` : null
          }
        />

        <StatCard
          label="Trial used"
          value={sub?.has_used_trial ? "Yes" : "No"}
          sub={
            sub?.trial_started_at
              ? `${formatAuDate(sub.trial_started_at)} → ${formatAuDate(sub.trial_ends_at)}`
              : null
          }
        />
        <StatCard
          label="Refunds processed"
          value={String(refundCount)}
          tone={refundCount > 0 ? "muted" : undefined}
        />
        <StatCard
          label="Children"
          value={String(linkedChildren.length)}
          sub={
            linkedChildren.length > 0
              ? linkedChildren
                  .map((c) => c.first_name || "—")
                  .join(", ")
                  .slice(0, 60)
              : null
          }
        />
        <StatCard
          label="Cancelled at"
          value={sub?.cancelled_at ? formatAuDate(sub.cancelled_at) : "—"}
        />
        <G2WindowCard endsAtIso={sub?.satisfaction_window_ends_at ?? null} />
      </div>
    </section>
  );
}

/**
 * G2 (offer §4): full refund within the window after the nanny's first day.
 * Shown, not enforced — refunds are issued by hand after a call (no engine).
 */
function G2WindowCard({ endsAtIso }: { endsAtIso: string | null }) {
  const endsAt = endsAtIso ? new Date(endsAtIso) : null;
  const valid = endsAt !== null && !Number.isNaN(endsAt.getTime());
  const isOpen = valid && endsAt.getTime() > Date.now();
  return (
    <div data-testid="g2-window">
      <StatCard
        label={`${G2.windowDays}-day window`}
        value={
          valid && endsAtIso
            ? `ends ${formatAuDate(endsAtIso)} — ${isOpen ? "open" : "closed"}`
            : "—"
        }
        tone={valid && !isOpen ? "muted" : undefined}
      />
    </div>
  );
}

interface StatCardProps {
  label: string;
  value?: string;
  valueNode?: React.ReactNode;
  sub?: string | null;
  tone?: "warn" | "muted";
}

function StatCard({ label, value, valueNode, sub, tone }: StatCardProps) {
  const valueClass =
    tone === "warn"
      ? "text-amber-700"
      : tone === "muted"
        ? "text-slate-500"
        : "text-slate-900";
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
        </p>
        <div className={`mt-1.5 text-lg font-bold ${valueClass}`}>
          {valueNode ?? value ?? "—"}
        </div>
        {sub && <p className="mt-1 text-xs text-slate-500">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function StatusPill({ label, tone }: { label: string; tone: PillTone }) {
  const map: Record<PillTone, string> = {
    active: "bg-emerald-100 text-emerald-800",
    warn: "bg-amber-100 text-amber-800",
    info: "bg-violet-100 text-violet-800",
    muted: "bg-slate-100 text-slate-700",
  };
  return (
    <span
      className={`inline-block rounded-full px-2.5 py-1 text-xs font-medium ${map[tone]}`}
    >
      {label}
    </span>
  );
}
