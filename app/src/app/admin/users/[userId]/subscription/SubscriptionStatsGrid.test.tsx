/**
 * G2 window in the admin dossier (LDN2 unit 4d; offer §4 G2, ADR-088).
 * The card reads `parent_subscriptions.satisfaction_window_ends_at` (4c's column) and
 * shows open / closed / "—". `G2.windowDays` names the window; no engine decides anything.
 */

import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";

import { G2 } from "@/config/offer";
import { PRICES } from "@/config/prices";
import { SubscriptionStatsGrid } from "./SubscriptionStatsGrid";
import type { ParentSubscriptionRow } from "./page";

const DAY = 24 * 60 * 60 * 1000;

function sub(windowEndsAt: string | null | undefined): ParentSubscriptionRow {
  const base: ParentSubscriptionRow = {
    id: "ps1",
    status: "active_upfront",
    trial_started_at: null,
    trial_ends_at: null,
    paid_period_starts_at: null,
    paid_period_ends_at: null,
    has_used_trial: true,
    stripe_customer_id: "cus_1",
    stripe_subscription_id: null,
    stripe_payment_intent_id: "pi_1",
    cancelled_at: null,
    cancellation_reason: null,
    past_due_grace_ends_at: null,
    subscription_cycle: 0,
    created_at: "2026-10-01T00:00:00Z",
    updated_at: "2026-10-01T00:00:00Z",
  };
  return windowEndsAt === undefined
    ? base
    : ({ ...base, satisfaction_window_ends_at: windowEndsAt } as ParentSubscriptionRow);
}

function renderGrid(s: ParentSubscriptionRow | null, spendPence = 0) {
  render(
    <SubscriptionStatsGrid
      sub={s}
      plan="Upfront"
      subscriberSinceIso={null}
      tenureDays={null}
      cumulativeSpendPence={spendPence}
      refundedTotalAud={0}
      failedPaymentCount={0}
      recoveryCount={0}
      cancelCount={0}
      refundCount={0}
      linkedChildren={[]}
    />,
  );
  return screen.getByTestId("g2-window");
}

describe("SubscriptionStatsGrid — G2 window card", () => {
  it(`is labelled from G2.windowDays (${G2.windowDays})`, () => {
    const card = renderGrid(sub(null));
    expect(card.textContent).toContain(`${G2.windowDays}-day window`);
  });

  it("open: the window ends in the future", () => {
    const card = renderGrid(sub(new Date(Date.now() + 10 * DAY).toISOString()));
    expect(card.textContent).toMatch(/ends .+ — open/);
  });

  it("closed: the window ended in the past", () => {
    const card = renderGrid(sub(new Date(Date.now() - 10 * DAY).toISOString()));
    expect(card.textContent).toMatch(/ends .+ — closed/);
  });

  it("— when the column is null (no placement yet)", () => {
    const card = renderGrid(sub(null));
    expect(card.textContent).not.toMatch(/open|closed/);
    expect(card.textContent).toContain("—");
  });

  it("— when the column is absent (before 4c's amendment) or there is no subscription", () => {
    expect(renderGrid(sub(undefined)).textContent).not.toMatch(/open|closed/);
  });

  it("— with no subscription row", () => {
    expect(renderGrid(null).textContent).not.toMatch(/open|closed/);
  });
});

// 4g (D3): the spend card shows pence through the currency formatter.
describe("SubscriptionStatsGrid — cumulative spend", () => {
  it("formats pence as pounds", () => {
    renderGrid(sub(null), PRICES.selfServe.upfrontToAge3Pence);
    expect(screen.getByText("Cumulative spend").parentElement?.textContent).toContain("£2,000.00");
  });
});

