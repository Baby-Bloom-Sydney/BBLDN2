/**
 * Unit 3c (BB-LDN-3c-061026) — submitDbsForManualReview, N1–N5 + the API-down state (brief change 8; 00-RULINGS #7).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMemoryDb, type MemoryDb } from "../../../tests/fakes/memory-supabase";

const h = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  user: { id: "u1" } as { id: string } | null,
  sendDbsManualReviewEmail: vi.fn(async () => {}),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: h.user }, error: h.user ? null : { message: "no" } }) } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("@/lib/email/dbs-emails", () => ({ sendDbsManualReviewEmail: h.sendDbsManualReviewEmail }));
vi.mock("@/lib/ai/verification-pipeline", () => ({ triggerCrossCheck: vi.fn() }));
vi.mock("@/lib/email/resend", () => ({ sendEmail: vi.fn(async () => ({})) }));
vi.mock("@/lib/email/helpers", () => ({ getUserEmailInfo: vi.fn(async () => null) }));

import { submitDbsForManualReview } from "./dbs-review";

function seed(over: Record<string, unknown>) {
  h.db = createMemoryDb({
    verifications: [
      {
        id: "v1", user_id: "u1", updated_at: "2026-10-06T00:00:00Z", identity_status: "verified", identity_verified: true,
        wwcc_status: "failed", wwcc_verified: false, cross_check_status: "not_started", verification_status: 24,
        wwcc_user_guidance: { title: "x" }, cross_check_reasoning: "r", cross_check_issues: ["i"], cross_check_at: "2026-10-06T00:00:00Z",
        ...over,
      },
      { id: "v2", user_id: "someone-else", identity_status: "verified", wwcc_status: "failed", cross_check_status: "not_started", verification_status: 24 },
    ],
    nannies: [{ id: "n1", user_id: "u1", verification_level: 2, status: "active" }],
  });
}
const v = () => h.db.tables.verifications[0];

beforeEach(() => {
  vi.clearAllMocks();
  h.user = { id: "u1" };
});

describe("submitDbsForManualReview", () => {
  it.each([
    ["failed", 24],
    ["expired", 23],
    ["ocg_not_found", 26],
  ])("N1 returns success and sets wwcc_status='review' / 21 when the DBS step is %s (%i)", async (wwcc, code) => {
    seed({ wwcc_status: wwcc, verification_status: code });
    expect(await submitDbsForManualReview()).toEqual({ success: true, error: null });
    expect(v()).toMatchObject({
      wwcc_status: "review", verification_status: 21, wwcc_user_guidance: null,
      cross_check_status: "not_started", cross_check_reasoning: null, cross_check_issues: null, cross_check_at: null,
    });
    expect(v().wwcc_status_at).toBeTruthy();
    expect(h.db.tables.verifications[1].wwcc_status).toBe("failed");
    expect(h.revalidatePath).toHaveBeenCalledWith("/nanny/verification");
  });

  it("N1b allowed from the API-down state (doc_verified + cross-check pending, 20) → 21", async () => {
    seed({ wwcc_status: "doc_verified", cross_check_status: "pending", verification_status: 20 });
    expect((await submitDbsForManualReview()).success).toBe(true);
    expect(v()).toMatchObject({ wwcc_status: "review", cross_check_status: "not_started", verification_status: 21 });
  });

  it("N2 sends the VER-004-DBS email when it succeeds", async () => {
    seed({});
    await submitDbsForManualReview();
    expect(h.sendDbsManualReviewEmail).toHaveBeenCalledWith("u1");
  });

  it("N3 returns an error when the caller is not signed in", async () => {
    seed({});
    h.user = null;
    expect(await submitDbsForManualReview()).toEqual({ success: false, error: "Not authenticated" });
    expect(h.db.writes).toHaveLength(0);
  });

  it.each([
    ["not_started", "not_started"],
    ["pending", "not_started"],
    ["processing", "not_started"],
    ["review", "not_started"],
    ["rejected", "not_started"],
    ["barred", "not_started"],
    ["doc_verified", "passed"],
    ["doc_verified", "processing"],
    ["doc_verified", "not_started"],
  ])("N4 returns an error and writes nothing when the DBS step is %s / cross-check %s", async (wwcc, cross) => {
    seed({ wwcc_status: wwcc, cross_check_status: cross });
    const r = await submitDbsForManualReview();
    expect(r.success).toBe(false);
    expect(h.db.writes).toHaveLength(0);
    expect(h.sendDbsManualReviewEmail).not.toHaveBeenCalled();
  });

  it("N4c tells her a check is in progress when the cross-check is processing", async () => {
    seed({ wwcc_status: "doc_verified", cross_check_status: "processing" });
    expect((await submitDbsForManualReview()).error).toMatch(/in progress/);
  });

  it("N4b returns an error when she has no verification row", async () => {
    seed({ user_id: "nobody" });
    expect((await submitDbsForManualReview()).success).toBe(false);
  });

  it("N5 allows a second request after a resubmit fails again (no attempt count — ruling 7)", async () => {
    seed({});
    expect((await submitDbsForManualReview()).success).toBe(true);
    Object.assign(v(), { wwcc_status: "failed", verification_status: 24 }); // resubmitted, failed again
    expect((await submitDbsForManualReview()).success).toBe(true);
    expect(v().verification_status).toBe(21);
    expect(h.sendDbsManualReviewEmail).toHaveBeenCalledTimes(2);
  });
});
