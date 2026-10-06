/**
 * Unit 3c (BB-LDN-3c-061026) — API-down retry on poll, R-P1 / R-P2 (brief change 9; 00-RULINGS #30).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMemoryDb, type MemoryDb } from "../../../../tests/fakes/memory-supabase";

const h = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  runCrossCheckPhase: vi.fn(),
}));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "u1" } } }) },
    from: (t: string) => (h.db.client() as { from: (t: string) => unknown }).from(t),
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }));
vi.mock("@/lib/actions/verification", () => ({ syncNannyVerificationState: vi.fn() }));
vi.mock("@/lib/ai/verification-pipeline", () => ({ runCrossCheckPhase: h.runCrossCheckPhase }));

import { GET, maxDuration } from "./route";

const MIN = 60_000;
const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

function seed(over: Record<string, unknown>) {
  h.db = createMemoryDb({
    verifications: [
      {
        id: "v1", user_id: "u1", identity_status: "verified", identity_verified: true, wwcc_status: "doc_verified",
        cross_check_status: "pending", cross_check_at: ago(11 * MIN), verification_status: 20, ...over,
      },
    ],
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
  h.runCrossCheckPhase.mockImplementation(async () => {
    Object.assign(h.db.tables.verifications[0], { cross_check_status: "passed", verification_status: 30 });
  });
});

describe("GET /api/verification-status — retry a pending cross-check (API down)", () => {
  it("R-P1 re-runs a pending cross-check when cross_check_at is older than the cooldown, then answers from the re-read row", async () => {
    seed({});
    const res = await GET();
    expect(h.runCrossCheckPhase).toHaveBeenCalledWith("v1", "retry");
    const body = await res.json();
    expect(body).toMatchObject({ status: 30, cross_check_status: "passed" });
  });

  it("R-P1b re-runs when cross_check_at is null", async () => {
    seed({ cross_check_at: null });
    await GET();
    expect(h.runCrossCheckPhase).toHaveBeenCalledTimes(1);
  });

  it("R-P2 does not call DBS again inside the cooldown", async () => {
    seed({ cross_check_at: ago(9 * MIN) });
    const body = await (await GET()).json();
    expect(h.runCrossCheckPhase).not.toHaveBeenCalled();
    expect(body).toMatchObject({ status: 20, cross_check_status: "pending" });
  });

  it("R-P2b honours DBS_RETRY_COOLDOWN_MS from config", async () => {
    vi.stubEnv("DBS_RETRY_COOLDOWN_MS", String(30 * MIN));
    seed({ cross_check_at: ago(20 * MIN) });
    await GET();
    expect(h.runCrossCheckPhase).not.toHaveBeenCalled();
  });

  it.each([
    ["identity not verified", { identity_status: "review" }],
    ["certificate not doc_verified", { wwcc_status: "review" }],
    ["cross-check not pending", { cross_check_status: "passed" }],
  ])("does not retry when %s", async (_n, over) => {
    seed(over);
    await GET();
    expect(h.runCrossCheckPhase).not.toHaveBeenCalled();
  });

  it("still answers when the retry throws (the row stays pending for the next poll)", async () => {
    seed({});
    h.runCrossCheckPhase.mockRejectedValue(new Error("boom"));
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).cross_check_status).toBe("pending");
  });

  it("S3 resets a cross-check stuck in processing past the stale threshold back to pending (review HIGH), so the retry path takes over", async () => {
    seed({ cross_check_status: "processing", cross_check_at: ago(6 * MIN) });
    h.runCrossCheckPhase.mockImplementation(async () => {});
    const body = await (await GET()).json();
    expect(h.db.tables.verifications[0]).toMatchObject({ cross_check_status: "pending", verification_status: 20 });
    expect(body.cross_check_status).toBe("pending");
  });

  it("S3b leaves a fresh processing cross-check alone", async () => {
    seed({ cross_check_status: "processing", cross_check_at: ago(1 * MIN) });
    await GET();
    expect(h.db.tables.verifications[0].cross_check_status).toBe("processing");
    expect(h.runCrossCheckPhase).not.toHaveBeenCalled();
  });

  it("allows 60 s for the two 15 s attempts plus the delay", () => {
    expect(maxDuration).toBe(60);
  });
});
