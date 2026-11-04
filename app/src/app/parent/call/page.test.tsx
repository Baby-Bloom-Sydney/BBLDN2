/**
 * /parent/call, the page (plan B6; brief §0.15, §3 parent 2, 5–6; §12 R8). Flag off → 404 before anything is read;
 * not a parent → 404; otherwise her view, loaded server-side for her session id, and the checked `next`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ session: vi.fn(), load: vi.fn(), notFound: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    h.notFound();
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/calls/parent-session", () => ({ sessionParentId: h.session }));
vi.mock("@/lib/calls/parent-state", () => ({ loadMyCallView: h.load }));
vi.mock("./CallPageClient", () => ({ CallPageClient: () => null }));

import ParentCallPage from "./page";

const HER = "b0400000-0000-4000-8000-000000000001";
const VIEW = { kind: "pick", afterNoAnswer: false, days: [] };

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
  h.session.mockResolvedValue(HER);
  h.load.mockResolvedValue({ ok: true, value: VIEW });
});
afterEach(() => vi.unstubAllEnvs());

describe("ParentCallPage", () => {
  it("flag off → notFound before any read", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    await expect(ParentCallPage({ searchParams: {} })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.session).not.toHaveBeenCalled();
    expect(h.load).not.toHaveBeenCalled();
  });

  it("not a parent → notFound; nothing loaded", async () => {
    h.session.mockResolvedValue(null);
    await expect(ParentCallPage({ searchParams: {} })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.load).not.toHaveBeenCalled();
  });

  it("her view, for her session id, and the checked next", async () => {
    const tree = await ParentCallPage({ searchParams: { next: "/parent?t=childcare&s=nannies&v=matches" } });
    expect(h.load).toHaveBeenCalledWith(HER);
    expect(clientProps(tree)).toEqual({ initial: VIEW, nextHref: "/parent?t=childcare&s=nannies&v=matches" });
  });

  it("an unsafe next → /parent; a failed load → load_failed", async () => {
    h.load.mockResolvedValueOnce({ ok: false, error: "error" });
    const tree = await ParentCallPage({ searchParams: { next: "//evil.com" } });
    expect(clientProps(tree)).toEqual({ initial: { kind: "load_failed" }, nextHref: "/parent" });
  });

  it("the heading names the Complimentary matchmaker call", async () => {
    const tree = await ParentCallPage({ searchParams: {} });
    expect(JSON.stringify(tree)).toContain("Your Complimentary matchmaker call");
  });
});
