/**
 * /matchmaking/call, the page (04b rework W1; brief §0a.1, §0.15, §3 parent 2, 5–6). The call slide moved out of the
 * app (`/parent/call`) into the funnel. Flag off → 404 before anything is read; signed out → `/login?redirect=` this
 * path with its query (the middleware doesn't guard `/matchmaking`, so the page does); signed in but not a parent →
 * 404; otherwise her view, loaded server-side for her session id, and the checked `next`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ caller: vi.fn(), load: vi.fn(), notFound: vi.fn(), redirect: vi.fn() }));
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
});
afterEach(() => vi.unstubAllEnvs());

describe("MatchmakingCallPage — who may see it", () => {
  it("flag off → notFound before any read", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    await expect(MatchmakingCallPage({ searchParams: {} })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.caller).not.toHaveBeenCalled();
    expect(h.load).not.toHaveBeenCalled();
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

  it("the heading names the Complimentary matchmaker call", async () => {
    const tree = await MatchmakingCallPage({ searchParams: {} });
    expect(JSON.stringify(tree)).toContain("Your Complimentary matchmaker call");
  });
});
