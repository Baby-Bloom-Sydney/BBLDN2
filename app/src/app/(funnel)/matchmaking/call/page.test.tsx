/**
 * /matchmaking/call, the page (04b rework W1; brief §0a.1, §0.15, §3 parent 2, 5–6). The call slide moved out of the
 * app (`/parent/call`) into the funnel. Flag off → 404 before anything is read; signed out → `/login?redirect=` this
 * path with its query (the middleware doesn't guard `/matchmaking`, so the page does); signed in but not a parent →
 * 404; otherwise her view, loaded server-side for her session id, and the checked `next`. W17 item 13: the same rule as
 * the hold and confirm actions (`mayBookNow`) — "no" sends her straight onward to the checked `next`, so the slide
 * never shows a picker whose taps would be refused; "yes" and "unknown" render as before.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ caller: vi.fn(), load: vi.fn(), notFound: vi.fn(), redirect: vi.fn(), allowed: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    h.notFound();
    throw new Error("NEXT_NOT_FOUND");
  },
  redirect: (url: string) => {
    h.redirect(url);
    throw new Error(`NEXT_REDIRECT ${url}`);
  },
}));
vi.mock("@/lib/calls/parent-session", () => ({ sessionCaller: h.caller }));
vi.mock("@/lib/calls/parent-state", () => ({ loadMyCallView: h.load }));
vi.mock("@/lib/calls/call-allowed", () => ({ mayBookNow: h.allowed }));
vi.mock("./CallPageClient", () => ({ CallPageClient: () => null }));

import MatchmakingCallPage from "./page";

const HER = "b0400000-0000-4000-8000-000000000001";
const VIEW = { kind: "pick", afterNoAnswer: false, days: [] };
const MATCHES = "/parent?t=childcare&s=nannies&v=matches";

/** The CallPageClient element's props in the page's tree. */
function clientProps(tree: unknown): Record<string, unknown> | undefined {
  if (Array.isArray(tree)) return tree.map(clientProps).find((p) => p !== undefined);
  if (!tree || typeof tree !== "object" || !("props" in tree)) return undefined;
  const props = (tree as { props: Record<string, unknown> }).props;
  return "initial" in props ? props : clientProps(props.children);
}

beforeEach(() => {
  vi.stubEnv("CALL_BOOKING_ENABLED", "true");
  for (const fn of Object.values(h)) fn.mockReset();
  h.caller.mockResolvedValue({ kind: "parent", parentId: HER });
  h.load.mockResolvedValue({ ok: true, value: VIEW });
  h.allowed.mockResolvedValue("yes");
});
afterEach(() => vi.unstubAllEnvs());

describe("MatchmakingCallPage — who may see it", () => {
  it("flag off → notFound before any read", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    await expect(MatchmakingCallPage({ searchParams: {} })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.caller).not.toHaveBeenCalled();
    expect(h.load).not.toHaveBeenCalled();
    expect(h.allowed).not.toHaveBeenCalled();
  });

  it("signed out → /login?redirect= this path with its query; nothing loaded", async () => {
    h.caller.mockResolvedValue({ kind: "signed_out" });
    await expect(MatchmakingCallPage({ searchParams: { next: MATCHES, change: "1" } })).rejects.toThrow("NEXT_REDIRECT");
    const target = new URL(h.redirect.mock.calls[0][0] as string, "https://x.test");
    expect(target.pathname).toBe("/login");
    expect(target.searchParams.get("redirect")).toBe(`/matchmaking/call?next=${encodeURIComponent(MATCHES)}&change=1`);
    expect(h.load).not.toHaveBeenCalled();
  });

  it("signed out with no query → /login?redirect=/matchmaking/call", async () => {
    h.caller.mockResolvedValue({ kind: "signed_out" });
    await expect(MatchmakingCallPage({ searchParams: {} })).rejects.toThrow("NEXT_REDIRECT");
    expect(h.redirect).toHaveBeenCalledWith("/login?redirect=%2Fmatchmaking%2Fcall");
  });

  it("signed in, not a parent → notFound; nothing loaded", async () => {
    h.caller.mockResolvedValue({ kind: "not_a_parent" });
    await expect(MatchmakingCallPage({ searchParams: {} })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.redirect).not.toHaveBeenCalled();
    expect(h.load).not.toHaveBeenCalled();
    expect(h.allowed).not.toHaveBeenCalled();
  });
});

describe("MatchmakingCallPage — the call offered to her (W17 item 13: the actions' rule)", () => {
  it("not offered → straight onward to the checked next; the slide never renders", async () => {
    h.allowed.mockResolvedValue("no");
    await expect(MatchmakingCallPage({ searchParams: { next: MATCHES } })).rejects.toThrow("NEXT_REDIRECT");
    expect(h.allowed).toHaveBeenCalledWith(HER);
    expect(h.redirect).toHaveBeenCalledWith(MATCHES);
  });

  it.each([
    ["an unsafe next", { next: "//evil.com" }],
    ["no next", {}],
  ])("not offered with %s → /parent", async (_why, searchParams) => {
    h.allowed.mockResolvedValue("no");
    await expect(MatchmakingCallPage({ searchParams })).rejects.toThrow("NEXT_REDIRECT");
    expect(h.redirect).toHaveBeenCalledWith("/parent");
  });

  it.each([["yes"], ["unknown"]])("%s → the slide as before (a read that failed is handled by her view and the actions)", async (allowed) => {
    h.allowed.mockResolvedValue(allowed);
    const tree = await MatchmakingCallPage({ searchParams: { next: MATCHES, change: "1" } });
    expect(clientProps(tree)).toMatchObject({ initial: VIEW, nextHref: MATCHES, startChanging: true });
    expect(h.redirect).not.toHaveBeenCalled();
  });

  it("the check and her view are read together (no extra round trip)", async () => {
    let releaseCheck: (value: string) => void = () => {};
    h.allowed.mockImplementation(() => new Promise((resolve) => (releaseCheck = resolve)));
    const page = MatchmakingCallPage({ searchParams: {} });
    await vi.waitFor(() => {
      expect(h.allowed).toHaveBeenCalledWith(HER);
      expect(h.load).toHaveBeenCalledWith(HER); // already asked for while the check is still pending
    });
    releaseCheck("yes");
    await page;
  });
});

describe("MatchmakingCallPage — her view", () => {
  it("her view, for her session id, and the checked next", async () => {
    const tree = await MatchmakingCallPage({ searchParams: { next: MATCHES } });
    expect(h.load).toHaveBeenCalledWith(HER);
    expect(clientProps(tree)).toMatchObject({ initial: VIEW, nextHref: MATCHES });
  });

  it("an unsafe next → /parent; a failed load → load_failed", async () => {
    h.load.mockResolvedValueOnce({ ok: false, error: "error" });
    const tree = await MatchmakingCallPage({ searchParams: { next: "//evil.com" } });
    expect(clientProps(tree)).toMatchObject({ initial: { kind: "load_failed" }, nextHref: "/parent" });
  });

  it("renders the slide alone — no app wrapper or header of its own (W3: the client draws the funnel shell)", async () => {
    const tree = (await MatchmakingCallPage({ searchParams: {} })) as { props: Record<string, unknown> };
    expect(tree.props).toHaveProperty("initial");
    expect(JSON.stringify(tree)).not.toContain("max-w-2xl");
  });
});
