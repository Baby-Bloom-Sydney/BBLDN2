/**
 * 04's default dependencies with brief 05 (05a-2, D4): the JustCall words source is 05's, and with logging off it makes
 * no read at all — so 04's readers are exactly today's (plan §8 A: unsetting the switches undoes 05).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ requireAdmin: vi.fn(), clients: 0 }));
vi.mock("@/lib/admin/require-admin", () => ({ requireAdmin: h.requireAdmin }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    h.clients += 1;
    throw new Error("no admin client in unit tests");
  },
}));

import { proveAdmin, type AdminProof } from "./admin-proof";
import { defaultDashboardDeps } from "./dashboard";
import { entryRow } from "./fake-calls-repo.test-util";

let proof: AdminProof;
beforeEach(async () => {
  h.requireAdmin.mockResolvedValue({ userId: "a0400000-0000-4000-8000-000000000001", error: null });
  proof = (await proveAdmin()) as AdminProof;
  h.clients = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const JC = entryRow({ parentUserId: "b0400000-0000-4000-8000-000000000001", occurredAt: "2027-02-03T16:00:00.000Z", result: "answered", method: "justcall", source: "justcall", justcallCallId: "CAtest0001" });

describe("defaultDashboardDeps().justcallAttempts", () => {
  it("logging off → no words and no client made", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    vi.stubEnv("JUSTCALL_WEBHOOK_ENABLED", "");
    const source = defaultDashboardDeps().justcallAttempts;
    expect(source).toBeTypeOf("function");
    expect((await source?.(proof, [JC]))?.size).toBe(0);
    expect(h.clients).toBe(0);
  });

  it("logging on → 05's read (here it fails: no words, never thrown)", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    vi.stubEnv("JUSTCALL_WEBHOOK_ENABLED", "true");
    expect((await defaultDashboardDeps().justcallAttempts?.(proof, [JC]))?.size).toBe(0);
    expect(h.clients).toBeGreaterThan(0);
  });
});
