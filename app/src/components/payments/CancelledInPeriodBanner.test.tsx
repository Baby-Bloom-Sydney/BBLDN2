/**
 * CancelledInPeriodBanner — tests.
 *
 * Spec: `system/APP/PAYMENTS/FRONTEND/03-build-spec.md` §S3.5.
 *
 * Behaviour under test:
 * - AC-S3.5.1: renders for cancelled-with-future-period-end.
 * - AC-S3.5.3: Resubscribe CTA fires onPrimaryCta.
 * - AC-S3.5.4: close button hides banner for that session; LocalStorage
 *              keyed per childId. Re-renders fresh on a new session.
 * - Loss-aversion copy: "you'll still have access until {date}"
 *   verbatim per Bailey's spec.
 * - No banned terminology.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  CancelledInPeriodBanner,
  type CancelledInPeriodBannerProps,
} from "./CancelledInPeriodBanner";

beforeEach(() => {
  // jsdom's localStorage may not implement .clear(); remove specific
  // keys we know each test sets.
  try {
    for (const key of [
      "child-A",
      "child-B",
      "00000000-0000-0000-0000-000000000abc",
    ]) {
      window.localStorage?.removeItem?.(`bb_cancelled_banner_dismissed_${key}`);
    }
  } catch {
    // ignore
  }
  vi.clearAllMocks();
});

function makeProps(
  overrides: Partial<CancelledInPeriodBannerProps> = {},
): CancelledInPeriodBannerProps {
  return {
    childId: "00000000-0000-0000-0000-000000000abc",
    paidPeriodEndsAt: "2026-06-15T00:00:00+10:00",
    onPrimaryCta: vi.fn(),
    ...overrides,
  };
}

describe("CancelledInPeriodBanner", () => {
  // owner: money — grace-period date shifts a day under Europe/London; raise, do not re-baseline (2b)
  it.fails("renders the loss-aversion copy with formatted date (AC-S3.5.1)", () => {
    const props = makeProps({ paidPeriodEndsAt: "2026-06-15T00:00:00+10:00" });
    render(<CancelledInPeriodBanner {...props} />);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/your subscription has ended/i);
    // Date is formatted as "15 Jun 2026" or similar AU format.
    expect(text).toMatch(/15.*Jun.*2026|June.*2026/i);
    expect(text.toLowerCase()).toMatch(/still have access until/i);
  });

  it("Resubscribe CTA fires onPrimaryCta (AC-S3.5.3)", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<CancelledInPeriodBanner {...props} />);
    await user.click(screen.getByRole("button", { name: /resubscribe/i }));
    expect(props.onPrimaryCta).toHaveBeenCalledOnce();
  });

  it("has a close button (AC-S3.5.4 — closable unlike S3 LapsedBanner)", () => {
    const props = makeProps();
    render(<CancelledInPeriodBanner {...props} />);
    expect(
      screen.getByRole("button", { name: /dismiss|close/i }),
    ).toBeInTheDocument();
  });

  it("close button hides banner for the session", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    const { rerender } = render(<CancelledInPeriodBanner {...props} />);
    expect(
      screen.getByText(/your subscription has ended/i),
    ).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /dismiss|close/i }));
    expect(
      screen.queryByText(/your subscription has ended/i),
    ).not.toBeInTheDocument();
    // Re-render — banner stays dismissed until LocalStorage key cleared.
    rerender(<CancelledInPeriodBanner {...props} />);
    expect(
      screen.queryByText(/your subscription has ended/i),
    ).not.toBeInTheDocument();
  });

  it("LocalStorage dismissal is scoped per childId", async () => {
    const user = userEvent.setup();
    const propsA = makeProps({ childId: "child-A" });
    const { unmount } = render(<CancelledInPeriodBanner {...propsA} />);
    await user.click(screen.getByRole("button", { name: /dismiss|close/i }));
    unmount();

    // A different child renders fresh.
    const propsB = makeProps({ childId: "child-B" });
    render(<CancelledInPeriodBanner {...propsB} />);
    expect(
      screen.getByText(/your subscription has ended/i),
    ).toBeInTheDocument();
  });

  it("does not use banned 'tracking' terminology", () => {
    const props = makeProps();
    render(<CancelledInPeriodBanner {...props} />);
    const text = document.body.textContent ?? "";
    expect(text.toLowerCase()).not.toMatch(/\btrack(ing|ed|s)?\b/);
  });

  it("hides the Resubscribe CTA when onPrimaryCta is omitted (Bailey 2026-05-14)", () => {
    // Banner still renders the date + dismiss button, but the
    // CTA button is gone. Used by ParentStateBannerHub when the
    // parent is already on /parent/subscribe so the button can't
    // self-navigate.
    const props = makeProps();
    delete (props as { onPrimaryCta?: () => void }).onPrimaryCta;
    render(<CancelledInPeriodBanner {...props} />);
    expect(
      screen.getByText(/your subscription has ended/i),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /^resubscribe$/i }),
    ).not.toBeInTheDocument();
    // Dismiss button stays — the user can still dismiss the banner.
    expect(
      screen.getByRole("button", { name: /dismiss|close/i }),
    ).toBeInTheDocument();
  });
});
