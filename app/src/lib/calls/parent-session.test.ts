/**
 * parent-session.ts (plan B6; brief §9.15): the parent comes from the request's session only — the cookie client's
 * user, and her role read with that same client (never the service role). Anyone else → null. Never throws.
 */
import { afterEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ getUser: vi.fn(), single: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: h.getUser },
    from: (table: string) => {
      h.from(table);
      return { select: () => ({ eq: (_c: string, id: string) => ({ single: () => h.single(id) }) }) };
    },
  }),
}));

import { sessionCaller, sessionParentId } from "./parent-session";

const HER = "b0400000-0000-4000-8000-000000000001";

afterEach(() => {
  vi.restoreAllMocks();
  h.getUser.mockReset();
  h.single.mockReset();
  h.from.mockReset();
});

describe("sessionParentId", () => {
  it("a signed-in parent → her id, her role read for her own id", async () => {
    h.getUser.mockResolvedValue({ data: { user: { id: HER } }, error: null });
    h.single.mockResolvedValue({ data: { role: "parent" }, error: null });
    expect(await sessionParentId()).toBe(HER);
    expect(h.from).toHaveBeenCalledWith("user_roles");
    expect(h.single).toHaveBeenCalledWith(HER);
  });

  it.each(["nanny", "admin", "super_admin"])("a %s → null", async (role) => {
    h.getUser.mockResolvedValue({ data: { user: { id: HER } }, error: null });
    h.single.mockResolvedValue({ data: { role }, error: null });
    expect(await sessionParentId()).toBeNull();
  });

  it("signed out, an auth error, no role row → null, and the role isn't read without a user", async () => {
    h.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await sessionParentId()).toBeNull();
    expect(h.from).not.toHaveBeenCalled();
    h.getUser.mockResolvedValue({ data: { user: { id: HER } }, error: { message: "jwt expired" } });
    expect(await sessionParentId()).toBeNull();
    h.getUser.mockResolvedValue({ data: { user: { id: HER } }, error: null });
    h.single.mockResolvedValue({ data: null, error: { message: "no rows" } });
    expect(await sessionParentId()).toBeNull();
  });

  it("a throw → null, logged by name only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    h.getUser.mockRejectedValue(new TypeError("fetch failed"));
    expect(await sessionParentId()).toBeNull();
    expect(log).toHaveBeenCalledWith("[calls/parent-session] the session check failed", { name: "TypeError" });
  });
});

describe("sessionParentId — a role read error is logged (review F7)", () => {
  it("a real error (not 'no rows') → null, logged by name and code only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    h.getUser.mockResolvedValue({ data: { user: { id: HER } }, error: null });
    h.single.mockResolvedValue({ data: null, error: { name: "PostgrestError", code: "42501", message: "permission denied for jane@example.com" } });
    expect(await sessionParentId()).toBeNull();
    expect(log).toHaveBeenCalledWith("[calls/parent-session] the role read failed", { name: "PostgrestError", code: "42501" });
    expect(JSON.stringify(log.mock.calls)).not.toContain("jane@example.com");
  });

  it("'no rows' (PGRST116) → null, not logged", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    h.getUser.mockResolvedValue({ data: { user: { id: HER } }, error: null });
    h.single.mockResolvedValue({ data: null, error: { name: "PostgrestError", code: "PGRST116", message: "0 rows" } });
    expect(await sessionParentId()).toBeNull();
    expect(log).not.toHaveBeenCalled();
  });
});

// ── 04b rework (W1): the call slide lives at /matchmaking/call, which the middleware doesn't guard, so the page tells
//    "signed out" (→ /login?redirect=…) from "signed in but not a parent" (→ 404) itself. ──
describe("sessionCaller", () => {
  it("a signed-in parent → parent, with her id", async () => {
    h.getUser.mockResolvedValue({ data: { user: { id: HER } }, error: null });
    h.single.mockResolvedValue({ data: { role: "parent" }, error: null });
    expect(await sessionCaller()).toEqual({ kind: "parent", parentId: HER });
  });

  it("no user, or an auth error → signed_out, and no role read", async () => {
    h.getUser.mockResolvedValue({ data: { user: null }, error: null });
    expect(await sessionCaller()).toEqual({ kind: "signed_out" });
    h.getUser.mockResolvedValue({ data: { user: { id: HER } }, error: { message: "jwt expired" } });
    expect(await sessionCaller()).toEqual({ kind: "signed_out" });
    expect(h.from).not.toHaveBeenCalled();
  });

  it.each(["nanny", "admin", "super_admin"])("a signed-in %s → not_a_parent", async (role) => {
    h.getUser.mockResolvedValue({ data: { user: { id: HER } }, error: null });
    h.single.mockResolvedValue({ data: { role }, error: null });
    expect(await sessionCaller()).toEqual({ kind: "not_a_parent" });
  });

  it("signed in with no role row → not_a_parent", async () => {
    h.getUser.mockResolvedValue({ data: { user: { id: HER } }, error: null });
    h.single.mockResolvedValue({ data: null, error: { code: "PGRST116", message: "0 rows" } });
    expect(await sessionCaller()).toEqual({ kind: "not_a_parent" });
  });

  it("a throw → not_a_parent (404, never a login loop), logged by name only", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    h.getUser.mockRejectedValue(new TypeError("fetch failed"));
    expect(await sessionCaller()).toEqual({ kind: "not_a_parent" });
    expect(log).toHaveBeenCalledWith("[calls/parent-session] the session check failed", { name: "TypeError" });
  });
});
