// @vitest-environment node
/**
 * Unit 3i (BB-LDN-3i-141026) — integration I11 (04-test-plan §3): the real re-check runner + mapper + Update Service
 * adapter against the local fake DBS service (tests/fakes/dbs-update-service.ts, per-number override — brief change 9),
 * the real sync and the real accept action. Only Supabase (in-memory, London CHECKs), Resend and the user lookup are
 * stand-ins. Also proves the in-run retry on an API error (#32: two attempts, then nothing changes).
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { createMemoryDb, type MemoryDb } from "../../../tests/fakes/memory-supabase";
import { startFakeDbsUpdateService, type FakeDbsServer } from "../../../tests/fakes/dbs-update-service";

const h = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  sends: [] as Array<{ to: string; emailType: string; subject: string }>,
  authUser: { id: "u1" } as { id: string } | null,
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: h.authUser }, error: null }) } }),
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/email/resend", () => ({
  sendEmail: async (p: { to: string; emailType: string; subject: string }) => {
    h.sends.push(p);
    return { success: true } as const;
  },
}));
vi.mock("@/lib/email/helpers", () => ({
  getUserEmailInfo: vi.fn(async () => ({ email: "jane.doe@example.test", firstName: "Jane", lastName: "Doe", userId: "u1" })),
}));
vi.mock("@/lib/chat/proactive/action-triggered", () => ({ dispatchActionTriggeredInBackground: vi.fn() }));

import { runDbsRecheck } from "./recheck";
import { acceptConnectionRequest } from "@/lib/actions/connection";

const CERT = "200000000001"; // a `2…` number: the fake answers BLANK unless overridden
let fake: FakeDbsServer;

beforeAll(async () => {
  fake = await startFakeDbsUpdateService({ holdMs: 2000 });
  vi.stubEnv("DBS_UPDATE_SERVICE_BASE_URL", fake.baseUrl);
  vi.stubEnv("DBS_CHECK_ORGANISATION_NAME", "BabyBloom London");
  vi.stubEnv("DBS_CHECKER_FORENAME", "ALEX");
  vi.stubEnv("DBS_CHECKER_SURNAME", "CHECKER");
  vi.stubEnv("DBS_TIMEOUT_MS", "300");
  vi.stubEnv("DBS_RETRY_DELAY_MS", "1");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fake.close();
});

beforeEach(async () => {
  h.sends = [];
  fake.requests.length = 0;
  await fetch(`${fake.baseUrl.replace(/\/crsc$/, "")}/__override`, { method: "DELETE" });
  h.db = createMemoryDb({
    verifications: [
      {
        id: "v1", user_id: "u1", updated_at: "2026-09-01T00:00:00.000Z",
        identity_status: "verified", identity_verified: true,
        wwcc_status: "doc_verified", wwcc_status_at: "2026-09-01T00:00:00.000Z", wwcc_verified: true, wwcc_doc_verified: true,
        wwcc_verified_by: "admin-0", wwcc_verified_at: "2026-09-01T00:00:00.000Z", cross_check_status: "passed",
        verification_status: 40, extracted_wwcc_number: CERT, extracted_wwcc_surname: "Doe", extracted_wwcc_dob: "1990-03-05",
        extracted_wwcc_first_name: "Jane", extracted_wwcc_expiry: "2024-03-14",
        ocg_result_status: "BLANK_NO_NEW_INFO", ocg_result_text: "<old/>", ocg_verified_at: "2026-10-01T00:00:00.000Z",
      },
    ],
    nannies: [{ id: "n1", user_id: "u1", verification_level: 4, status: "active", identity_verified: true, wwcc_verified: true }],
    activity_logs: [],
    connection_requests: [
      { id: "c-open", nanny_id: "n1", parent_id: "p1", position_id: "pos1", connection_stage: 0, status: "pending", source: null },
    ],
  });
});

const admin = () => h.db.client() as Parameters<typeof runDbsRecheck>[0];
const fast = { intervalMs: 1, batchLimit: 500, timeBudgetMs: 60_000, applyDeadlineMs: 120_000, pauseRatio: 0.2, pauseMinFailures: 3 };
const override = (status: string) =>
  fetch(`${fake.baseUrl.replace(/\/crsc$/, "")}/__override/${CERT}?status=${status}`, { method: "PUT" });

describe("I11 — re-check against the fake Update Service", () => {
  it("I11 re-check with a NEW_INFO override drops an approved nanny to level 2 and her next accept is refused", async () => {
    expect((await override("NEW_INFO")).status).toBe(204);
    const summary = await runDbsRecheck(admin(), { config: fast });
    expect(summary).toMatchObject({ checked: 1, failed_new_info: 1 });
    expect(fake.requests[0].path).toBe(`/crsc/api/status/${CERT}`);
    expect(h.db.tables.verifications[0]).toMatchObject({ verification_status: 23, wwcc_verified: false, cross_check_status: "not_started" });
    expect(h.db.tables.nannies[0].verification_level).toBe(2);
    expect(h.db.tables.connection_requests[0]).toMatchObject({ connection_stage: 1, status: "expired" });

    const res = await acceptConnectionRequest("c-open", ["mon_am", "tue_am", "wed_am", "thu_am", "fri_am"]);
    expect(res).toEqual({ success: false, error: "Please complete verification to accept connections." });
  });

  it("a `2…` number with no override passes: only the result block moves", async () => {
    const summary = await runDbsRecheck(admin(), { config: fast });
    expect(summary).toMatchObject({ checked: 1, passed: 1 });
    expect(h.db.tables.verifications[0]).toMatchObject({ verification_status: 40, ocg_result_status: "BLANK_NO_NEW_INFO", ocg_result_text: expect.stringContaining("BLANK_NO_NEW_INFO") });
    expect(h.db.tables.activity_logs).toHaveLength(0);
  });

  it("an HTTP 500 is retried in the run (two attempts), then nothing changes and one error row is logged (#32)", async () => {
    await override("ERROR");
    const summary = await runDbsRecheck(admin(), { config: fast });
    expect(summary).toMatchObject({ checked: 1, errors: 1 });
    expect(fake.requests).toHaveLength(2);
    expect(h.db.tables.verifications[0]).toMatchObject({ verification_status: 40, ocg_result_text: "<old/>" });
    expect(h.db.tables.activity_logs).toEqual([
      expect.objectContaining({ action_type: "dbs_status_check", action_details: { trigger: "recheck", result: "ERROR", reason: "http_500" } }),
    ]);
  });

  it("the fake refuses an unknown override status", async () => {
    expect((await override("MAYBE")).status).toBe(400);
  });
});
