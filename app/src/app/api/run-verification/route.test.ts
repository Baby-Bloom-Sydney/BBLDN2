/**
 * Unit 3c (BB-LDN-3c-061026) — I13: run-verification checks the caller owns the verification row
 * (04-integration-design §7; 3h security review MEDIUM handed to 3c). Fail closed.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMemoryDb, type MemoryDb } from "../../../../tests/fakes/memory-supabase";

const h = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  user: { id: "u1" } as { id: string } | null,
  runIdentityPhase: vi.fn(async () => {}),
  runWWCCDocPhase: vi.fn(async () => {}),
  failRead: false,
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => {
    const c = h.db.client() as { from: (t: string) => unknown };
    return {
      auth: { getUser: async () => ({ data: { user: h.user }, error: h.user ? null : { message: "no" } }) },
      from: (t: string) => {
        if (h.failRead) {
          const b: Record<string, unknown> = {};
          for (const k of ["select", "eq"]) b[k] = () => b;
          b.maybeSingle = async () => ({ data: null, error: { message: "boom" } });
          return b;
        }
        return c.from(t);
      },
    };
  },
}));
vi.mock("@/lib/ai/verification-pipeline", () => ({ runIdentityPhase: h.runIdentityPhase, runWWCCDocPhase: h.runWWCCDocPhase }));

import { POST } from "./route";

const req = (body: unknown) => new Request("http://localhost/api/run-verification", { method: "POST", body: JSON.stringify(body) }) as never;

beforeEach(() => {
  vi.clearAllMocks();
  h.user = { id: "u1" };
  h.failRead = false;
  h.db = createMemoryDb({ verifications: [{ id: "mine", user_id: "u1" }, { id: "theirs", user_id: "u2" }] });
});

describe("POST /api/run-verification — ownership", () => {
  it("I13 run-verification returns 403 when the verificationId is not the caller's", async () => {
    const res = await POST(req({ verificationId: "theirs", phase: "wwcc" }));
    expect(res.status).toBe(403);
    expect(h.runWWCCDocPhase).not.toHaveBeenCalled();
    expect(h.runIdentityPhase).not.toHaveBeenCalled();
  });

  it("returns 403 for an unknown id and for an identity phase on someone else's row", async () => {
    expect((await POST(req({ verificationId: "nope", phase: "wwcc" }))).status).toBe(403);
    expect((await POST(req({ verificationId: "theirs", phase: "identity" }))).status).toBe(403);
    expect(h.runIdentityPhase).not.toHaveBeenCalled();
  });

  it("fails closed (403) when the ownership read errors", async () => {
    h.failRead = true;
    expect((await POST(req({ verificationId: "mine", phase: "wwcc" }))).status).toBe(403);
    expect(h.runWWCCDocPhase).not.toHaveBeenCalled();
  });

  it("runs the phase when the row is the caller's", async () => {
    const res = await POST(req({ verificationId: "mine", phase: "wwcc" }));
    expect(res.status).toBe(200);
    expect(h.runWWCCDocPhase).toHaveBeenCalledWith("mine");
    await POST(req({ verificationId: "mine", phase: "identity" }));
    expect(h.runIdentityPhase).toHaveBeenCalledWith("mine");
  });

  it("keeps 401 when signed out and 400 for a missing or non-string id or an unknown phase", async () => {
    h.user = null;
    expect((await POST(req({ verificationId: "mine", phase: "wwcc" }))).status).toBe(401);
    h.user = { id: "u1" };
    expect((await POST(req({ phase: "wwcc" }))).status).toBe(400);
    expect((await POST(req({ verificationId: { id: "mine" }, phase: "wwcc" }))).status).toBe(400);
    expect((await POST(req({ verificationId: "mine", phase: "other" }))).status).toBe(400);
  });
});
