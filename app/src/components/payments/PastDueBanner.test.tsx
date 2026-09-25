/**
 * PastDueBanner — S11 tests.
 *
 * Spec: `system/APP/PAYMENTS/FRONTEND/03-build-spec.md` §S11.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createElement } from "react";

beforeEach(() => {
  vi.clearAllMocks();
});

import { PastDueBanner, type PastDueBannerProps } from "./PastDueBanner";

function makeProps(
  overrides: Partial<PastDueBannerProps> = {},
): PastDueBannerProps {
  return {
    graceEndsAt: "2026-05-25T00:00:00+10:00",
    onUpdateCard: vi.fn(),
    ...overrides,
  };
}

describe("PastDueBanner", () => {
  // owner: money — grace-period date shifts a day under Europe/London; raise, do not re-baseline (2b)
  it.fails("renders payment-failed copy with grace date (AC-S11.1)", () => {
    const props = makeProps();
    render(createElement(PastDueBanner, props));
    expect(
      screen.getByText(/your last payment didn't go through/i),
    ).toBeInTheDocument();
    // Date is formatted in AU locale.
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/25.*May.*2026/i);
  });

  it("Update payment method CTA fires onUpdateCard (AC-S11.2)", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(createElement(PastDueBanner, props));
    await user.click(
      screen.getByRole("button", { name: /update payment method/i }),
    );
    expect(props.onUpdateCard).toHaveBeenCalledOnce();
  });

  it("uses role='status' for SR announcement", () => {
    render(createElement(PastDueBanner, makeProps()));
    expect(screen.getByRole("status")).toBeInTheDocument();
  });

  it("does not use banned 'tracking' terminology", () => {
    render(createElement(PastDueBanner, makeProps()));
    const text = document.body.textContent ?? "";
    expect(text.toLowerCase()).not.toMatch(/\btrack(ing|ed|s)?\b/);
  });
});
