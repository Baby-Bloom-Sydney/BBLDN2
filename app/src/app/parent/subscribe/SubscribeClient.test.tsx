/**
 * SubscribeClient — S7 tests.
 *
 * Spec: `system/APP/PAYMENTS/FRONTEND/03-build-spec.md` §S7.
 *
 * Behaviour under test:
 * - Default header (no nanny-invite) — generic copy
 * - Personalised header (nanny-invite) — surfaces nanny + child names
 * - Card order: Upfront FIRST (anchoring), Monthly second
 * - Reciprocity footer "£100 of every payment supports your nanny's work"
 * - Trial banner renders when trialAvailable === true
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

describe("SubscribeClient — reciprocity footer", () => {
  it("renders the locked-in '£100 supports your nanny' line", () => {
    renderClient();
    expect(
      screen.getByText(/£100 of every payment supports your nanny/i),
    ).toBeInTheDocument();
  });
});

describe("SubscribeClient — trial banner", () => {
  it("renders when trialAvailable=true", () => {
    renderClient({ trialAvailable: true });
    expect(screen.getByText(/30-day free trial/i)).toBeInTheDocument();
  });

  it("hidden when trialAvailable=false", () => {
    renderClient({ trialAvailable: false });
    expect(screen.queryByText(/30-day free trial/i)).not.toBeInTheDocument();
  });
});
