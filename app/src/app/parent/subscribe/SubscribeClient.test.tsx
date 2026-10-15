/**
 * SubscribeClient — S7 tests.
 *
 * Spec: `system/APP/PAYMENTS/FRONTEND/03-build-spec.md` §S7.
 *
 * Behaviour under test:
 * - Default header (no nanny-invite) — generic copy
 * - Personalised header (nanny-invite) — surfaces nanny + child names
 * - Card order: Upfront FIRST (anchoring), Monthly second
 * - No "supports your nanny" line, no VAT line, no "free" (4g: cards 9a/9b, M-1 1d, 2c)
 * - Trial banner renders when trialAvailable === true, length from TRIAL_DAYS
 * - Upfront runs to the ACCESS_AGE_YEARS birthday (ADR-083)
 * - Banned terminology ("track") absent
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { createElement } from "react";

beforeEach(() => {
  vi.clearAllMocks();
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@/lib/actions/payments/checkout", () => ({
  createCheckoutSession: vi.fn(),
}));

import { SubscribeClient } from "./SubscribeClient";
import { ACCESS_AGE_YEARS, PRICES, TRIAL_DAYS } from "@/config/prices";

function renderClient(
  overrides: {
    trialAvailable?: boolean;
    nannyContext?: { nannyFirstName: string; childFirstName: string } | null;
  } = {},
) {
  const props = {
    trialAvailable: false,
    nannyContext: null,
    ...overrides,
  };
  return render(createElement(SubscribeClient, props));
}

describe("SubscribeClient — default header", () => {
  it("renders generic 'Subscribe to support' heading", () => {
    renderClient();
    expect(
      screen.getByRole("heading", {
        level: 1,
        name: /subscribe to support your child/i,
      }),
    ).toBeInTheDocument();
  });

  it("does NOT use 'track' terminology in headline / subhead", () => {
    renderClient();
    const text = document.body.textContent ?? "";
    expect(text.toLowerCase()).not.toMatch(/\btrack(ing|ed|s)?\b/);
  });
});

describe("SubscribeClient — personalised header (nanny invite)", () => {
  it("surfaces nanny + child names in heading", () => {
    renderClient({
      nannyContext: { nannyFirstName: "Jane", childFirstName: "Lily" },
    });
    const heading = screen.getByRole("heading", { level: 1 });
    expect(heading.textContent).toMatch(/Jane/);
    expect(heading.textContent).toMatch(/Lily/);
    expect(heading.textContent).toMatch(/wants to keep supporting/i);
  });
});

describe("SubscribeClient — card order (anchoring psychology)", () => {
  it("renders Upfront card BEFORE Monthly card", () => {
    renderClient();
    const cards = screen.getAllByTestId(/plan-card-/);
    expect(cards).toHaveLength(2);
    expect(cards[0]).toHaveAttribute("data-testid", "plan-card-upfront");
    expect(cards[1]).toHaveAttribute("data-testid", "plan-card-monthly");
  });

  // 4b (ADR-091): both prices come from `config/prices.ts` — £2,000 to age 3, £75 per month.
  it("displays the upfront and monthly prices from config", () => {
    renderClient();
    expect(screen.getByTestId("plan-card-upfront").textContent).toMatch(/£2,000(?!\.)/);
    const monthly = screen.getByTestId("plan-card-monthly").textContent ?? "";
    expect(monthly).toMatch(/£75(?![\d.])/);
    expect(monthly).toMatch(/\/month/);
    expect(monthly).not.toMatch(/£200/);
  });
});

// 4g (cards 9a/9b, M-1 1d, 2c): the £100 line is gone with nothing in its place; VAT is shown only where card
// details are entered (Stripe's page); the page never says "free".
describe("SubscribeClient — footer", () => {
  it("has no '£100 supports your nanny' line", () => {
    renderClient({ trialAvailable: true });
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(/supports your nanny/i);
    expect(text).not.toMatch(/£100/);
  });

  it("has no VAT wording", () => {
    renderClient({ trialAvailable: true });
    expect(document.body.textContent ?? "").not.toMatch(/\bVAT\b/i);
  });

  it("keeps the terms sentence", () => {
    renderClient();
    expect(screen.getByText(/by subscribing you agree to our terms of service/i)).toBeInTheDocument();
  });

  it("never says 'free', with or without the trial", () => {
    for (const trialAvailable of [true, false]) {
      const { unmount } = renderClient({ trialAvailable });
      expect((document.body.textContent ?? "").toLowerCase()).not.toMatch(/\bfree\b/);
      unmount();
    }
  });
});

describe("SubscribeClient — access horizon (ADR-083)", () => {
  it("upfront runs to the config birthday, not the 5th", () => {
    renderClient();
    const upfront = screen.getByTestId("plan-card-upfront").textContent ?? "";
    expect(ACCESS_AGE_YEARS).toBe(3);
    expect(upfront).toMatch(/3rd birthday/);
    expect(upfront).not.toMatch(/5th birthday|under 4/);
  });

  it("states the best-value age derived from the two config prices", () => {
    renderClient();
    const months =
      ACCESS_AGE_YEARS * 12 -
      Math.ceil(PRICES.selfServe.upfrontToAge3Pence / PRICES.selfServe.monthlyPence);
    expect(screen.getByTestId("plan-card-upfront").textContent).toContain(
      `Best value if your child is under ${months} months.`,
    );
  });
});

describe("SubscribeClient — trial banner", () => {
  it("renders when trialAvailable=true, length from TRIAL_DAYS", () => {
    renderClient({ trialAvailable: true });
    expect(screen.getByText(new RegExp(`${TRIAL_DAYS}-day trial`, "i"))).toBeInTheDocument();
    expect(screen.getAllByText(new RegExp(`charged after ${TRIAL_DAYS} days`, "i"))).toHaveLength(2);
  });

  it("hidden when trialAvailable=false", () => {
    renderClient({ trialAvailable: false });
    expect(screen.queryByText(/-day trial/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/charged after/i)).not.toBeInTheDocument();
  });
});
