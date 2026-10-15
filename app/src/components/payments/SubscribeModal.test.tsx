/**
 * SubscribeModal — parent variant tests.
 *
 * Spec: `system/APP/PAYMENTS/FRONTEND/03-build-spec.md` §S1.
 *
 * Behaviour under test:
 * - AC-S1.1: renders when `isOpen` is true (modal mounted in DOM).
 * - AC-S1.2: clicking close / "Maybe later" / X / Escape calls `onClose`.
 *            (AC-S1.3 — every-page-load re-fire — is a parent-route
 *            concern; this component only manages its open prop and is
 *            therefore not tested here.)
 * - AC-S1.4: does NOT render when `isOpen` is false.
 * - AC-S1.5: clicking primary CTA routes to /parent/subscribe?childId=...
 *
 * Plus locked-in copy assertions:
 * - Heading templated with childFirstName + nannyFirstName.
 * - Body branches by `lapseReason`: trial_ended vs subscription_lapsed.
 * - Reciprocity-friendly framing — child name AND nanny name both surfaced.
 * - "Maybe later" close affordance present + works.
 * - Nanny-name fallback uses "with your nanny" (positive assertion).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const state = vi.hoisted(() => ({
  pushCalls: [] as string[],
}));

beforeEach(() => {
  state.pushCalls = [];
  vi.clearAllMocks();
});

vi.mock("next/navigation", () => ({
  useRouter: () => ({
    push: (url: string) => {
      state.pushCalls.push(url);
    },
  }),
}));

import { SubscribeModal, type SubscribeModalProps } from "./SubscribeModal";

/** Factory — produces a fresh props object per test so shared mocks
 *  cannot leak call counts across cases. */
function makeProps(
  overrides: Partial<SubscribeModalProps> = {},
): SubscribeModalProps {
  return {
    isOpen: true,
    onClose: vi.fn(),
    childId: "00000000-0000-0000-0000-000000000abc",
    childFirstName: "Lily",
    nannyFirstName: "Sarah",
    lapseReason: "trial_ended",
    ...overrides,
  };
}

describe("SubscribeModal (parent variant)", () => {
  it("renders nothing when isOpen is false (AC-S1.4)", () => {
    const props = makeProps({ isOpen: false });
    render(<SubscribeModal {...props} />);
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
  });

  it("renders heading with child + nanny names when open (AC-S1.1)", () => {
    const props = makeProps();
    render(<SubscribeModal {...props} />);
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toBeInTheDocument();
    expect(heading.textContent).toMatch(/Lily/);
    expect(heading.textContent).toMatch(/Sarah/);
    expect(heading.textContent).toMatch(/continue following/i);
  });

  it("renders trial_ended body copy when lapseReason='trial_ended'", () => {
    const props = makeProps({ lapseReason: "trial_ended" });
    render(<SubscribeModal {...props} />);
    expect(screen.getByText(/trial has ended/i)).toBeInTheDocument();
  });

  it("renders subscription_lapsed body copy when lapseReason='subscription_lapsed'", () => {
    const props = makeProps({ lapseReason: "subscription_lapsed" });
    render(<SubscribeModal {...props} />);
    expect(screen.getByText(/subscription has lapsed/i)).toBeInTheDocument();
  });

  it("primary CTA routes to /parent/subscribe with childId query (AC-S1.5)", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<SubscribeModal {...props} />);
    const cta = screen.getByRole("button", {
      name: /see subscription options/i,
    });
    await user.click(cta);
    expect(state.pushCalls).toEqual([
      `/parent/subscribe?childId=${encodeURIComponent(props.childId)}`,
    ]);
  });

  it("'Maybe later' button calls onClose (AC-S1.2)", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<SubscribeModal {...props} />);
    const maybeLater = screen.getByRole("button", { name: /maybe later/i });
    await user.click(maybeLater);
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("X close button calls onClose (AC-S1.2 — Radix close path)", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<SubscribeModal {...props} />);
    const closeBtn = screen.getByRole("button", { name: /^close$/i });
    await user.click(closeBtn);
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("Escape key closes the dialog (AC-S1.2 — keyboard path)", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<SubscribeModal {...props} />);
    await user.keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("falls back to 'with your nanny' when nannyFirstName is missing", () => {
    const props = makeProps({ nannyFirstName: undefined });
    render(<SubscribeModal {...props} />);
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading.textContent).toMatch(/with your nanny/i);
    expect(heading.textContent).not.toMatch(/undefined/);
    expect(heading.textContent).not.toMatch(/\{/);
    expect(heading.textContent).toMatch(/Lily/);
  });

  it("does not use banned 'tracking' terminology", () => {
    const props = makeProps();
    render(<SubscribeModal {...props} />);
    const text = document.body.textContent ?? "";
    expect(text.toLowerCase()).not.toMatch(/\btrack(ing|ed|s)?\b/);
  });
});

// 4g (ADR-091/093): a done-for-you family is never shown the self-serve CTAs.
describe("SubscribeModal — done-for-you states", () => {
  it("awaiting_placement: one line, no buttons to subscribe", () => {
    render(
      <SubscribeModal {...makeProps({ lapseReason: "awaiting_placement" })} />,
    );
    expect(
      screen.getByText(
        "Your app access switches on when your nanny is placed.",
      ),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: /subscription options|maybe later/i,
      }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/subscribe|£/i);
  });

  it("access_paused: one line and the Contact link, no subscribe buttons", () => {
    render(<SubscribeModal {...makeProps({ lapseReason: "access_paused" })} />);
    expect(screen.getByRole("dialog").textContent).toMatch(
      /Your access is paused — get in touch and we.ll sort it\./,
    );
    expect(screen.getByRole("link", { name: /get in touch/i })).toHaveAttribute(
      "href",
      "/contact",
    );
    expect(
      screen.queryByRole("button", {
        name: /subscription options|maybe later/i,
      }),
    ).not.toBeInTheDocument();
    expect(document.body.textContent ?? "").not.toMatch(/subscribe|£/i);
  });

  it("the self-serve keys keep their buttons", () => {
    for (const lapseReason of ["trial_ended", "subscription_lapsed"] as const) {
      const { unmount } = render(
        <SubscribeModal {...makeProps({ lapseReason })} />,
      );
      expect(
        screen.getByRole("button", { name: /see subscription options/i }),
      ).toBeInTheDocument();
      unmount();
    }
  });
});

describe("SubscribeModal — done-for-you states stay closable", () => {
  it("Escape still calls onClose", async () => {
    const props = makeProps({ lapseReason: "access_paused" });
    render(<SubscribeModal {...props} />);
    await userEvent.keyboard("{Escape}");
    expect(props.onClose).toHaveBeenCalled();
  });
});
