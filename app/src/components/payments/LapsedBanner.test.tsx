/**
 * LapsedBanner — tests.
 *
 * Spec: `system/APP/PAYMENTS/FRONTEND/03-build-spec.md` §S3.
 *
 * Behaviour under test:
 * - AC-S3.1: renders when role + state communicate "lapsed."
 * - AC-S3.3: has NO close affordance — banner is unclosable by design.
 * - AC-S3.4: CTAs match audience (parent: Subscribe; nanny: Share).
 * - Locked-in copy: heading specific to role; uses child + parent names.
 * - No banned terminology.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { LapsedBanner, type LapsedBannerProps } from "./LapsedBanner";

function makeProps(
  overrides: Partial<LapsedBannerProps> = {},
): LapsedBannerProps {
  return {
    role: "parent",
    childFirstName: "Lily",
    parentFirstName: "Sarah",
    onPrimaryCta: vi.fn(),
    ...overrides,
  };
}

describe("LapsedBanner — parent variant", () => {
  it("renders subscription-required messaging (AC-S3.1)", () => {
    const props = makeProps({ role: "parent" });
    render(<LapsedBanner {...props} />);
    expect(screen.getByText(/subscription required/i)).toBeInTheDocument();
  });

  it("references the child by first name", () => {
    const props = makeProps({ role: "parent" });
    render(<LapsedBanner {...props} />);
    const text = document.body.textContent ?? "";
    expect(text).toMatch(/Lily/);
  });

  it("primary CTA labelled 'Subscribe' (AC-S3.4)", () => {
    const props = makeProps({ role: "parent" });
    render(<LapsedBanner {...props} />);
    expect(
      screen.getByRole("button", { name: /^subscribe$/i }),
    ).toBeInTheDocument();
  });

  it("CTA click fires onPrimaryCta", async () => {
    const user = userEvent.setup();
    const props = makeProps({ role: "parent" });
    render(<LapsedBanner {...props} />);
    await user.click(screen.getByRole("button", { name: /^subscribe$/i }));
    expect(props.onPrimaryCta).toHaveBeenCalledOnce();
  });

  it("has no close button (AC-S3.3 — banner is unclosable)", () => {
    const props = makeProps({ role: "parent" });
    render(<LapsedBanner {...props} />);
    expect(
      screen.queryByRole("button", { name: /close|dismiss/i }),
    ).not.toBeInTheDocument();
  });
});

describe("LapsedBanner — nanny variant", () => {
  it("references the child's family lapse (AC-S3.1)", () => {
    const props = makeProps({ role: "nanny" });
    render(<LapsedBanner {...props} />);
    expect(
      screen.getByText(/Lily.*family.*lapsed|family.*lapsed/i),
    ).toBeInTheDocument();
  });

  it("primary CTA labelled with parent name (AC-S3.4)", () => {
    const props = makeProps({ role: "nanny", parentFirstName: "Sarah" });
    render(<LapsedBanner {...props} />);
    expect(
      screen.getByRole("button", { name: /share.* with Sarah/i }),
    ).toBeInTheDocument();
  });

  it("CTA click fires onPrimaryCta", async () => {
    const user = userEvent.setup();
    const props = makeProps({ role: "nanny" });
    render(<LapsedBanner {...props} />);
    await user.click(
      screen.getByRole("button", { name: /share.* with Sarah/i }),
    );
    expect(props.onPrimaryCta).toHaveBeenCalledOnce();
  });

  it("falls back to 'the parent' when parentFirstName missing", () => {
    const props = makeProps({ role: "nanny", parentFirstName: undefined });
    render(<LapsedBanner {...props} />);
    expect(
      screen.getByRole("button", { name: /share.* with the parent/i }),
    ).toBeInTheDocument();
  });

  it("has no close button (AC-S3.3)", () => {
    const props = makeProps({ role: "nanny" });
    render(<LapsedBanner {...props} />);
    expect(
      screen.queryByRole("button", { name: /close|dismiss/i }),
    ).not.toBeInTheDocument();
  });
});

describe("LapsedBanner — universal", () => {
  it("does not use banned 'tracking' terminology", () => {
    const props = makeProps();
    render(<LapsedBanner {...props} />);
    const text = document.body.textContent ?? "";
    expect(text.toLowerCase()).not.toMatch(/\btrack(ing|ed|s)?\b/);
  });

  it("renders with role='status' for assistive tech announcement", () => {
    const props = makeProps();
    render(<LapsedBanner {...props} />);
    // The banner should announce itself non-intrusively.
    expect(screen.getByRole("status")).toBeInTheDocument();
  });
});

// 4g (ADR-091/093): the parent banner for a done-for-you family carries no Subscribe button.
describe("LapsedBanner — done-for-you states (parent)", () => {
  it("awaiting_placement: the placement line, no button", () => {
    render(
      <LapsedBanner
        {...makeProps({ role: "parent", lapseReason: "awaiting_placement" })}
      />,
    );
    expect(
      screen.getByText(
        "Your app access switches on when your nanny is placed.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByRole("status").textContent ?? "").not.toMatch(
      /subscri/i,
    );
  });

  it("access_paused: the paused line with the Contact link, no button", () => {
    render(
      <LapsedBanner
        {...makeProps({ role: "parent", lapseReason: "access_paused" })}
      />,
    );
    expect(screen.getByRole("status").textContent).toMatch(
      /Your access is paused — get in touch and we.ll sort it\./,
    );
    expect(screen.getByRole("link", { name: /get in touch/i })).toHaveAttribute(
      "href",
      "/contact",
    );
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("self-serve keys keep 'Subscription required.' and the Subscribe button", () => {
    for (const lapseReason of ["trial_ended", "subscription_lapsed"] as const) {
      const { unmount } = render(
        <LapsedBanner {...makeProps({ role: "parent", lapseReason })} />,
      );
      expect(screen.getByText(/subscription required/i)).toBeInTheDocument();
      expect(
        screen.getByRole("button", { name: /subscribe/i }),
      ).toBeInTheDocument();
      unmount();
    }
  });
});
