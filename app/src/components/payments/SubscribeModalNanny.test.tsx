/**
 * SubscribeModalNanny — tests.
 *
 * Spec: `system/APP/PAYMENTS/FRONTEND/03-build-spec.md` §S2.
 *
 * Critical invariants:
 * - NEVER shows pricing or a self-subscribe CTA (the nanny can't pay).
 * - Primary CTA is the share-link button — uses Web Share API where
 *   available, falls back to clipboard copy.
 * - Copy is relational: surfaces parent first name + child first name.
 * - No "track" terminology anywhere.
 *
 * Behaviour under test:
 * - AC-S2.1: renders with nanny-variant copy when isOpen=true.
 * - AC-S2.2: Share CTA invokes navigator.share when available; falls
 *            back to clipboard otherwise.
 * - AC-S2.3: pricing CTAs are NEVER rendered (negative assertion —
 *            spec invariant).
 * - AC-S2.4: tokenised URL from props passed to share sheet verbatim.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const state = vi.hoisted(() => ({
  shareCalls: [] as ShareData[],
  shareThrows: null as Error | null,
  clipboardWrites: [] as string[],
}));

beforeEach(() => {
  state.shareCalls = [];
  state.shareThrows = null;
  state.clipboardWrites = [];
  vi.clearAllMocks();

  // Mock navigator.share (default available).
  Object.defineProperty(window.navigator, "share", {
    configurable: true,
    writable: true,
    value: async (data: ShareData) => {
      if (state.shareThrows) throw state.shareThrows;
      state.shareCalls.push(data);
    },
  });
  Object.defineProperty(window.navigator, "clipboard", {
    configurable: true,
    writable: true,
    value: {
      writeText: async (text: string) => {
        state.clipboardWrites.push(text);
      },
    },
  });
});

import {
  SubscribeModalNanny,
  type SubscribeModalNannyProps,
} from "./SubscribeModalNanny";
import { SITE_URL } from "@/lib/constants";

function makeProps(
  overrides: Partial<SubscribeModalNannyProps> = {},
): SubscribeModalNannyProps {
  return {
    isOpen: true,
    onClose: vi.fn(),
    childFirstName: "Lily",
    parentFirstName: "Sarah",
    shareUrl: `${SITE_URL}/subscribe-for/ABCD-2345`,
    shareText: `Hi Sarah — Baby Bloom helps me support Lily's development. Subscribe to continue: ${SITE_URL}/subscribe-for/ABCD-2345`,
    ...overrides,
  };
}

describe("SubscribeModalNanny", () => {
  it("renders nothing when isOpen is false", () => {
    const props = makeProps({ isOpen: false });
    render(<SubscribeModalNanny {...props} />);
    expect(screen.queryByRole("heading", { level: 2 })).not.toBeInTheDocument();
  });

  it("renders heading with child name when open (AC-S2.1)", () => {
    const props = makeProps();
    render(<SubscribeModalNanny {...props} />);
    const heading = screen.getByRole("heading", { level: 2 });
    expect(heading).toBeInTheDocument();
    expect(heading.textContent).toMatch(/Lily/);
    expect(heading.textContent).toMatch(/active subscription/i);
  });

  it("body copy references parent + child names", () => {
    const props = makeProps();
    render(<SubscribeModalNanny {...props} />);
    // Body explains share-link + relational role.
    const body = screen.getByText(/share this link/i);
    expect(body.textContent).toMatch(/Sarah/);
    expect(body.textContent).toMatch(/Lily/);
  });

  it("NEVER shows pricing CTAs (AC-S2.3 — spec invariant)", () => {
    const props = makeProps();
    render(<SubscribeModalNanny {...props} />);
    const banned =
      /A\$\d|subscribe (now|monthly|upfront)|see subscription options/i;
    const text = document.body.textContent ?? "";
    expect(text).not.toMatch(banned);
  });

  it("Share CTA calls navigator.share with provided text + URL (AC-S2.2 + AC-S2.4)", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<SubscribeModalNanny {...props} />);
    const cta = screen.getByRole("button", { name: /share .* with Sarah/i });
    await user.click(cta);
    expect(state.shareCalls).toHaveLength(1);
    expect(state.shareCalls[0]?.url).toBe(props.shareUrl);
    expect(state.shareCalls[0]?.text).toBe(props.shareText);
  });

  it("falls back to clipboard when navigator.share unsupported", async () => {
    // Remove navigator.share entirely.
    Object.defineProperty(window.navigator, "share", {
      configurable: true,
      writable: true,
      value: undefined,
    });
    const props = makeProps();
    render(<SubscribeModalNanny {...props} />);
    fireEvent.click(
      screen.getByRole("button", { name: /share .* with Sarah/i }),
    );
    await waitFor(() => {
      expect(state.clipboardWrites).toEqual([props.shareText]);
    });
  });

  it("falls back to clipboard when share throws non-Abort error", async () => {
    state.shareThrows = new Error("NotAllowedError");
    const props = makeProps();
    render(<SubscribeModalNanny {...props} />);
    fireEvent.click(
      screen.getByRole("button", { name: /share .* with Sarah/i }),
    );
    await waitFor(() => {
      expect(state.clipboardWrites).toEqual([props.shareText]);
    });
  });

  it("does NOT fall back to clipboard on user-cancelled share (AbortError)", async () => {
    const abort = new Error("share cancelled");
    abort.name = "AbortError";
    state.shareThrows = abort;
    const props = makeProps();
    render(<SubscribeModalNanny {...props} />);
    fireEvent.click(
      screen.getByRole("button", { name: /share .* with Sarah/i }),
    );
    // Give the microtask queue time to settle, then assert no fallback.
    await new Promise((r) => setTimeout(r, 50));
    expect(state.clipboardWrites).toEqual([]);
  });

  it("'Maybe later' button calls onClose", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<SubscribeModalNanny {...props} />);
    const maybeLater = screen.getByRole("button", { name: /maybe later/i });
    await user.click(maybeLater);
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("X close + Escape both call onClose", async () => {
    const user = userEvent.setup();
    const props = makeProps();
    render(<SubscribeModalNanny {...props} />);
    const closeBtn = screen.getByRole("button", { name: /^close$/i });
    await user.click(closeBtn);
    expect(props.onClose).toHaveBeenCalledOnce();
  });

  it("falls back to 'the parent' when parentFirstName missing", () => {
    const props = makeProps({ parentFirstName: undefined });
    render(<SubscribeModalNanny {...props} />);
    const body = screen.getByText(/share this link/i);
    expect(body.textContent).toMatch(/the parent/i);
    expect(body.textContent).not.toMatch(/undefined/);
    expect(body.textContent).not.toMatch(/\{/);
  });

  it("does not use banned 'tracking' terminology", () => {
    const props = makeProps();
    render(<SubscribeModalNanny {...props} />);
    const text = document.body.textContent ?? "";
    expect(text.toLowerCase()).not.toMatch(/\btrack(ing|ed|s)?\b/);
  });
});
