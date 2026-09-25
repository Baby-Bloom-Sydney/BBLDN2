"use client";

/**
 * UpcomingPayoutsView — chronological list dashboard for nanny payouts.
 *
 * T-018 rewrite (replaces tile-based layout from T-001):
 *  1. "How payouts work" explainer at the top.
 *  2. Setup-payouts banner when Stripe Connect onboarding isn't verified.
 *  3. Next Payout tile (the single soonest real entry).
 *  4. Upcoming Payouts list (real + projected + locked entries in chronological order).
 *
 * Removed:
 *  - Monthly Earnings tile (Bailey 2026-05-14: "unnecessary noise").
 *  - Aggregated next-payout sum (per Bailey: each $100 is its own payment on its own date).
 *  - Per-family detail cards (replaced by single line per payment).
 */

import Link from "next/link";
import { AlertCircle, ArrowRight, Calendar, Info } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { EarningsExplainer } from "@/components/payments/EarningsExplainer";
import { formatAuDate } from "@/lib/format/date";
import {
  isPayoutVerified,
  toPayoutApplicationStatus,
  type PayoutApplicationStatus,
} from "@/lib/payments/payout-application-status";
import type {
  PayoutsDashboardData,
  UpcomingEntry,
} from "@/lib/payments/queryPayoutsDashboard";

interface Props {
  data: PayoutsDashboardData | null;
  /** Current `nannies.payout_application_status`. When not verified the
   *  setup-payouts banner appears at the top. */
  payoutApplicationStatus?: PayoutApplicationStatus | string | null;
  /** When true, omits the inner page heading. */
  embedded?: boolean;
  /** When set, the setup-payouts banner button uses this route. */
  setupHref?: string;
}

function formatAudFromCents(cents: number): string {
  const dollars = cents / 100;
  return dollars.toFixed(dollars % 1 === 0 ? 0 : 2);
}

export function UpcomingPayoutsView({
  data,
  payoutApplicationStatus,
  embedded = false,
  setupHref = "/nanny/payouts/onboarding",
}: Props) {
  if (!data) {
    return (
      <div
        role="alert"
        className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900"
      >
        <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
        <div>
          <p className="font-medium">
            Couldn&apos;t load your payouts right now.
          </p>
          <p>Please refresh the page in a moment.</p>
        </div>
      </div>
    );
  }

  const { nextRealPayout, upcoming } = data;
  const normalisedStatus = toPayoutApplicationStatus(
    payoutApplicationStatus ?? null,
  );
  const setupNeeded = !isPayoutVerified(normalisedStatus);

  return (
    <div className="space-y-4">
      {setupNeeded && (
        <SetupPayoutsBanner href={setupHref} status={normalisedStatus} />
      )}

      {!embedded && (
        <>
          <h1 className="text-2xl font-bold text-slate-900">Contributions</h1>
          <p className="text-sm text-slate-500">
            Our contributions towards your ongoing developmental support of the
            children in your care.
          </p>
        </>
      )}

      <EarningsExplainer />

      {nextRealPayout && <NextPayoutTile entry={nextRealPayout} />}

      {upcoming.length === 0 ? (
        <Card>
          <CardContent className="p-5">
            <p className="text-sm text-slate-600">
              No upcoming contributions yet. Once you onboard a child + invite
              the parent, your contributions will start to show here.
            </p>
          </CardContent>
        </Card>
      ) : (
        <section aria-labelledby="upcoming-list-heading" className="space-y-2">
          <h2
            id="upcoming-list-heading"
            className="pt-2 text-base font-semibold text-slate-900"
          >
            Upcoming Contributions
          </h2>
          <ol className="space-y-2">
            {upcoming.map((entry) => (
              <UpcomingListRow key={entry.id} entry={entry} />
            ))}
          </ol>
        </section>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Next Payout tile (singular: one family, one amount, one date)
// ---------------------------------------------------------------------------

function NextPayoutTile({ entry }: { entry: UpcomingEntry }) {
  const isDeferred = entry.kind === "real-deferred";
  return (
    <Card
      className={
        isDeferred
          ? "border-amber-200 bg-amber-50"
          : "border-emerald-200 bg-emerald-50"
      }
    >
      <CardContent className="space-y-2 p-5">
        <p
          className={`text-xs font-medium uppercase tracking-wide ${
            isDeferred ? "text-amber-700" : "text-emerald-700"
          }`}
        >
          Next Contribution
        </p>
        <p
          className={`text-3xl font-bold ${
            isDeferred ? "text-amber-900" : "text-emerald-900"
          }`}
        >
          £{formatAudFromCents(entry.amountAudCents)}
        </p>
        {entry.scheduledReleaseAt && (
          <p
            className={`flex items-center gap-1.5 text-sm ${
              isDeferred ? "text-amber-800" : "text-emerald-800"
            }`}
          >
            <Calendar className="h-3.5 w-3.5" aria-hidden="true" />
            {isDeferred ? "Deferred to " : "Scheduled for "}
            {formatAuDate(entry.scheduledReleaseAt)}
          </p>
        )}
        <p
          className={`text-xs ${
            isDeferred ? "text-amber-800" : "text-emerald-800"
          }`}
        >
          Towards your support of {entry.childFirstName} with{" "}
          {entry.familyLabel}.
        </p>
        {isDeferred && entry.caveat && (
          <p className="text-xs text-amber-700">{entry.caveat}</p>
        )}
      </CardContent>
    </Card>
  );
}

// ---------------------------------------------------------------------------
// Upcoming list row (real | projected | locked | deferred)
// ---------------------------------------------------------------------------

function UpcomingListRow({ entry }: { entry: UpcomingEntry }) {
  // Indicator color per state:
  //   real | projected (active subscriber, present or future)  → green
  //   real-deferred (past_due — payment in question)            → amber
  //   locked-trial | locked-lapsed (pending first subscription) → sky/light-blue
  //   locked-cancelled (pending re-subscription after cancel)   → amber
  const indicatorKind: "green" | "sky" | "amber" =
    entry.kind === "locked-trial" || entry.kind === "locked-lapsed"
      ? "sky"
      : entry.kind === "locked-cancelled" || entry.kind === "real-deferred"
        ? "amber"
        : "green";

  const dateLabel = entry.scheduledReleaseAt
    ? formatAuDate(entry.scheduledReleaseAt)
    : "When unlocked";
  return (
    <li className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-1 items-center gap-3">
        {indicatorKind === "green" && entry.caveat && (
          <GreenIndicator caveat={entry.caveat} />
        )}
        {indicatorKind === "sky" && entry.caveat && (
          <SkyIndicator caveat={entry.caveat} />
        )}
        {indicatorKind === "amber" && entry.caveat && (
          <AmberIndicator caveat={entry.caveat} />
        )}
        <div>
          <p className="text-sm font-medium text-slate-900">
            {entry.familyLabel}
          </p>
          {entry.cycleLabel && (
            <p className="text-xs text-slate-500">{entry.cycleLabel}</p>
          )}
          {entry.kind === "real-deferred" && (
            <p className="text-xs text-amber-700">Deferred</p>
          )}
          {entry.kind === "locked-trial" && (
            <p className="text-xs text-sky-700">Pending subscription</p>
          )}
          {entry.kind === "locked-lapsed" && (
            <p className="text-xs text-sky-700">Pending subscription</p>
          )}
          {entry.kind === "locked-cancelled" && (
            <p className="text-xs text-amber-700">Pending re-subscription</p>
          )}
        </div>
      </div>
      <div className="text-right">
        <p className="text-lg font-semibold text-slate-900">
          £{formatAudFromCents(entry.amountAudCents)}
        </p>
        <p className="text-xs text-slate-600">{dateLabel}</p>
      </div>
    </li>
  );
}

function AmberIndicator({ caveat }: { caveat: string }) {
  return <Indicator caveat={caveat} dotClass="bg-amber-500" />;
}

function SkyIndicator({ caveat }: { caveat: string }) {
  return <Indicator caveat={caveat} dotClass="bg-sky-500" />;
}

function GreenIndicator({ caveat }: { caveat: string }) {
  return <Indicator caveat={caveat} dotClass="bg-emerald-500" />;
}

function Indicator({ caveat, dotClass }: { caveat: string; dotClass: string }) {
  return (
    <span
      className="group relative inline-flex h-2.5 w-2.5 shrink-0 cursor-help items-center justify-center"
      tabIndex={0}
      role="note"
      aria-label={caveat}
    >
      <span
        aria-hidden="true"
        className={`block h-2.5 w-2.5 rounded-full ${dotClass}`}
      />
      <span
        role="tooltip"
        className="pointer-events-none absolute left-4 top-1/2 z-10 hidden -translate-y-1/2 whitespace-nowrap rounded-md bg-slate-900 px-2 py-1 text-xs text-white shadow-md group-hover:block group-focus:block"
      >
        <Info className="mr-1 inline h-3 w-3" aria-hidden="true" />
        {caveat}
      </span>
    </span>
  );
}

// ---------------------------------------------------------------------------
// Setup-payouts banner (unchanged from prior version)
// ---------------------------------------------------------------------------

function SetupPayoutsBanner({
  href,
  status,
}: {
  href: string;
  status: PayoutApplicationStatus;
}) {
  const copy =
    status === "in_progress"
      ? "Finish setting up your contributions to start receiving them."
      : status === "pending" || status === "pending_review"
        ? "Stripe is reviewing your details — usually 1–2 business days."
        : status === "restricted" || status === "requires_action"
          ? "Stripe needs a bit more info from you to keep contributions active."
          : status === "rejected"
            ? "Your contribution setup couldn't be approved — please contact us."
            : "Set up contributions to start receiving them.";
  const ctaLabel =
    status === "in_progress"
      ? "Finish Setup"
      : status === "rejected"
        ? "Contact Us"
        : "Set Up Contributions";
  return (
    <Link
      href={status === "rejected" ? "/contact" : href}
      className="flex items-center justify-between gap-3 rounded-xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm text-violet-900 transition-colors hover:bg-violet-100"
    >
      <span className="font-medium">{copy}</span>
      <span className="inline-flex shrink-0 items-center gap-1 font-semibold">
        {ctaLabel} <ArrowRight className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    </Link>
  );
}
