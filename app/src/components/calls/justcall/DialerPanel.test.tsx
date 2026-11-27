/**
 * The dialer panel (plan 05 §5 PR 05b C4; brief §0.1, §3.1, §3.3, §3.8, §7): a card fixed on the right at `lg`+ with
 * the sign-in line, the call's phase (ringing amber, on call green, ended slate) and the mount JustCall's frame goes
 * in; below `lg`, one line and no frame. BB-wave2-231126/05-build.
 */
import { act, render, renderHook, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DialerPanel, isInDialer, useDialerScreen } from "./DialerPanel";
import type { DialerState } from "./use-justcall-dialer";

const STATE: DialerState = { status: "loading", agent: null, call: { kind: "idle" } };
const ringing = { kind: "ringing", callSid: "CAab12", outbound: true, number: "+447700900123" } as const;

afterEach(() => vi.unstubAllGlobals());

describe("DialerPanel", () => {
  it("before the screen is known: nothing (no flash of the phone line on a laptop; React M7)", () => {
    const { container } = render(<DialerPanel wide={null} state={STATE} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("below lg: the phone line, and no frame's mount", () => {
    render(<DialerPanel wide={false} state={STATE} />);
    expect(screen.getByText("On a phone, use the JustCall app — your calls still log here")).toBeInTheDocument();
    expect(document.getElementById("justcall-dialer")).toBeNull();
    expect(screen.queryByRole("complementary")).toBeNull();
  });

  it("lg and up: a named panel, fixed on the right, wide enough for the 365 px frame and its border, with the (empty) mount", () => {
    render(<DialerPanel wide state={STATE} />);
    const panel = screen.getByRole("complementary", { name: "JustCall dialer" });
    expect(panel.className).toContain("fixed");
    expect(panel.className).toContain("w-[369px]");
    const mount = document.getElementById("justcall-dialer");
    expect(mount).not.toBeNull();
    expect(mount!.childNodes).toHaveLength(0);
    expect(panel.contains(mount)).toBe(true);
  });

  it.each([
    [{ ...STATE, status: "loading" }, "JustCall is loading…"],
    [{ ...STATE, status: "signed_out" }, "Sign in to JustCall"],
    [{ ...STATE, status: "signed_in", agent: "agent@example.test" }, "JustCall: signed in as agent@example.test"],
    [{ ...STATE, status: "failed" }, "JustCall didn't load — reload the page to try again."],
  ] as const)("the sign-in line, announced: %o", (state, line) => {
    render(<DialerPanel wide state={state} />);
    expect(screen.getByRole("status")).toHaveTextContent(line);
  });

  it.each([
    [ringing, "Ringing", "bg-yellow-100"],
    [{ ...ringing, kind: "on_call" }, "On call", "bg-green-100"],
    [{ ...ringing, kind: "ended", seconds: 372 }, "Ended", "bg-slate-100"],
  ] as const)("the call's phase as a badge: %o", (call, word, tone) => {
    render(<DialerPanel wide state={{ status: "signed_in", agent: null, call }} />);
    expect(screen.getByText(word)).toHaveClass(tone);
    expect(screen.getByRole("status")).toHaveTextContent(word);
  });

  it("no badge with no call", () => {
    render(<DialerPanel wide state={{ status: "signed_in", agent: null, call: { kind: "idle" } }} />);
    expect(screen.queryByText(/Ringing|On call|Ended/)).toBeNull();
  });
});

describe("isInDialer — what the side-by-side drawer leaves alone", () => {
  it("anything inside the panel, nothing outside", () => {
    render(
      <>
        <DialerPanel wide state={STATE} />
        <button type="button">elsewhere</button>
      </>,
    );
    expect(isInDialer(document.getElementById("justcall-dialer"))).toBe(true);
    expect(isInDialer(screen.getByRole("status"))).toBe(true);
    expect(isInDialer(screen.getByRole("button", { name: "elsewhere" }))).toBe(false);
    expect(isInDialer(null)).toBe(false);
  });
});

describe("useDialerScreen — (min-width: 1024px)", () => {
  function stubMedia(matches: boolean) {
    const listeners = new Set<(e: { matches: boolean }) => void>();
    const query = { matches, addEventListener: (_: string, l: (e: { matches: boolean }) => void) => listeners.add(l), removeEventListener: (_: string, l: (e: { matches: boolean }) => void) => listeners.delete(l) };
    const matchMedia = vi.fn().mockReturnValue(query);
    vi.stubGlobal("matchMedia", matchMedia);
    return { matchMedia, change: (next: boolean) => listeners.forEach((l) => l({ matches: next })), listeners };
  }

  it("follows the width: wide, then narrow", () => {
    const media = stubMedia(true);
    const { result, unmount } = renderHook(() => useDialerScreen());
    expect(media.matchMedia).toHaveBeenCalledWith("(min-width: 1024px)");
    expect(result.current).toBe(true);
    act(() => media.change(false));
    expect(result.current).toBe(false);
    unmount();
    expect(media.listeners.size).toBe(0);
  });

  it("narrow, or no matchMedia at all: false", () => {
    stubMedia(false);
    expect(renderHook(() => useDialerScreen()).result.current).toBe(false);
    vi.stubGlobal("matchMedia", undefined);
    expect(renderHook(() => useDialerScreen()).result.current).toBe(false);
  });

  it("unknown (null) until it has looked", () => {
    stubMedia(true);
    const seen: (boolean | null)[] = [];
    renderHook(() => {
      const wide = useDialerScreen();
      seen.push(wide);
      return wide;
    });
    expect(seen[0]).toBeNull();
    expect(seen.at(-1)).toBe(true);
  });
});
