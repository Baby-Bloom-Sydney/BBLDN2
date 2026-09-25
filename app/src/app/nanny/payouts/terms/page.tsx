import Link from "next/link";

/**
 * `/nanny/payouts/terms` — contribution terms reference.
 *
 * Detailed mechanics linked from `EarningsExplainer`. T-018 reframing:
 * "payouts" → "contributions"; reflects the simpler cancel-as-terminal
 * model (no freeze/unfreeze) + T-018 trial behaviour (no contribution
 * row created until the family's first paid charge lands).
 */
export default function NannyPayoutsTermsPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <Link
        href="/nanny/payouts"
        className="text-sm text-slate-500 hover:text-slate-700"
      >
        ← Back to contributions
      </Link>
      <h1 className="mt-4 text-2xl font-bold text-slate-900">
        Contribution terms
      </h1>
      <p className="mt-1 text-sm text-slate-500">
        Our contribution towards your developmental work with the children in
        your care.
      </p>

      <section className="mt-8 space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Monthly plan</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>
            <span className="font-medium text-slate-900">£100</span> for every
            month of continued developmental support with a family.
          </li>
          <li>
            Released 14 days after each parent payment clears — a safeguard
            window against refunds and chargebacks.
          </li>
          <li>
            A family paying on the 1st of the month means your £100 lands on
            the 15th.
          </li>
        </ul>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-base font-semibold text-slate-900">Upfront plan</h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>
            <span className="font-medium text-slate-900">£1,000</span> for
            assisting families that pre-plan for long-term development, released
            across three instalments after the upfront payment clears:
          </li>
          <li>
            <span className="font-medium text-slate-900">£500</span> — 30 days
            after the upfront payment.
          </li>
          <li>
            <span className="font-medium text-slate-900">£300</span> — 60 days
            after the upfront payment.
          </li>
          <li>
            <span className="font-medium text-slate-900">£200</span> — 90 days
            after the upfront payment.
          </li>
          <li>
            The family continues with you until the child&apos;s 5th birthday,
            but the full £1,000 contribution has already been delivered.
          </li>
        </ul>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-base font-semibold text-slate-900">
          If a family cancels
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>
            <span className="font-medium text-slate-900">
              Future contributions stop.
            </span>{" "}
            No new cycles are generated.
          </li>
          <li>Contributions already released stay yours permanently.</li>
          <li>The current cycle&apos;s contribution is forfeited.</li>
          <li>
            If the family later resubscribes, a fresh cycle begins from that
            moment.
          </li>
        </ul>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-base font-semibold text-slate-900">
          If a family is in their free trial
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>
            Contributions don&apos;t generate during the trial period itself —
            we only contribute once the family subscribes.
          </li>
          <li>
            Once they subscribe, your first contribution is scheduled for 14
            days after their first payment clears.
          </li>
          <li>
            If the family doesn&apos;t subscribe before trial ends, no
            contribution is generated.
          </li>
        </ul>
      </section>

      <section className="mt-8 space-y-3">
        <h2 className="text-base font-semibold text-slate-900">
          Receiving contributions
        </h2>
        <ul className="list-disc space-y-1 pl-5 text-sm text-slate-700">
          <li>
            Set up your contribution details once via Stripe — from then on
            contributions transfer automatically to your bank account.
          </li>
          <li>
            Update your bank details any time from{" "}
            <Link
              href="/nanny/settings?s=contribution-settings"
              className="font-medium text-violet-700 underline-offset-2 hover:underline"
            >
              Contribution Settings
            </Link>
            .
          </li>
        </ul>
      </section>

      <p className="mt-10 text-xs text-slate-500">
        Questions about a specific contribution?{" "}
        <Link
          href="/contact"
          className="font-medium text-violet-700 underline-offset-2 hover:underline"
        >
          Contact us
        </Link>
        .
      </p>
    </div>
  );
}
