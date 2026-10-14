/**
 * Unit 3i (BB-LDN-3i-141026) — the failure branches of `runDbsRecheck` / `onDbsRecheckFailed` (lib/dbs/recheck.ts):
 * a refused write, a failed read, a non-Error throw, and every follow-up of a failed re-check failing on its own. Each
 * must leave the batch running and be visible in the log row or the summary — never swallowed (#32, #33).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMemoryDb, type MemoryDb } from "../../../tests/fakes/memory-supabase";
import type { DbsCheckResult } from "./update-service";

const h = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  sync: vi.fn(async () => {}),
  nannyEmail: vi.fn(async () => {}),
  adminEmail: vi.fn(async () => {}),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }));
vi.mock("@/lib/actions/verification", () => ({ syncNannyVerificationState: h.sync }));
vi.mock("@/lib/email/dbs-emails", () => ({ sendDbsRecheckFailedEmail: h.nannyEmail, sendDbsRecheckAdminAlert: h.adminEmail }));

import { onDbsRecheckFailed, runDbsRecheck } from "./recheck";

type Admin = Parameters<typeof runDbsRecheck>[0];
const fast = { intervalMs: 1, batchLimit: 10, timeBudgetMs: 60_000 };
const NEW_INFO = { result: "NEW_INFO", status: "NEW_INFO", raw: "<x/>", forename: null, surname: null, printDate: null } as DbsCheckResult;

function seed() {
  h.db = createMemoryDb({
    verifications: [{
      id: "v1", user_id: "u1", identity_status: "verified", identity_verified: true, wwcc_status: "doc_verified",
      wwcc_verified: true, wwcc_verified_by: "a", wwcc_verified_at: "2026-09-01T00:00:00Z", cross_check_status: "passed",
      verification_status: 40, extracted_wwcc_number: "200000000001", extracted_wwcc_surname: "Doe", extracted_wwcc_dob: "1990-03-05",
      ocg_result_status: "BLANK_NO_NEW_INFO", ocg_verified_at: null,
    }],
    nannies: [{ id: "n1", user_id: "u1", verification_level: 4 }],
    activity_logs: [],
    connection_requests: [{ id: "c1", nanny_id: "n1", parent_id: "p", position_id: null, connection_stage: 20, status: "accepted", source: null }],
  });
}
const admin = () => h.db.client() as Admin;
const logs = () => h.db.tables.activity_logs;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, "error").mockImplementation(() => {});
  seed();
});

describe("onDbsRecheckFailed — every follow-up failure is a warning, the rest still run", () => {
  it("collects sync, email and admin-alert failures as warnings and still drops connections", async () => {
    h.sync.mockRejectedValueOnce(new Error("sync down"));
    h.nannyEmail.mockRejectedValueOnce(new Error("resend down"));
    h.adminEmail.mockRejectedValueOnce("not an Error");
    const r = await onDbsRecheckFailed(admin(), { userId: "u1", result: "NEW_INFO" });
    expect(r).toEqual({ kept: 0, dropped: 1, notDropped: 0, warnings: ["sync_failed", "nanny_email_failed", "admin_email_failed"] });
    expect(h.db.tables.connection_requests[0]).toMatchObject({ connection_stage: 1, status: "expired" });
  });

  it("reads her nanny id when none is given; a read error skips the drop and says so", async () => {
    const base = h.db.client() as { from: (t: string) => unknown };
    const broken = {
      from: (t: string) =>
        t === "nannies"
          ? { select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: { message: "down" } }) }) }) }
          : base.from(t),
    };
    const r = await onDbsRecheckFailed(broken as unknown as Admin, { userId: "u1", result: "NO_MATCH" });
    expect(r.warnings).toEqual(["nanny_read_failed"]);
    expect(r).toMatchObject({ kept: 0, dropped: 0, notDropped: 0 });
    expect(h.db.tables.connection_requests[0]).toMatchObject({ connection_stage: 20 });
    expect(h.nannyEmail).toHaveBeenCalledWith("u1", "NO_MATCH");
    expect(h.adminEmail).toHaveBeenCalledWith("u1", "NO_MATCH", expect.objectContaining({ kept: 0, dropped: 0, notDropped: 0 }));
  });

  it("a connection read failure is a warning, not a throw", async () => {
    const base = h.db.client() as { from: (t: string) => unknown };
    const broken = {
      from: (t: string) =>
        t === "connection_requests" ? { select: () => ({ eq: async () => ({ data: null, error: { message: "down" } }) }) } : base.from(t),
    };
    const r = await onDbsRecheckFailed(broken as unknown as Admin, { userId: "u1", nannyId: "n1", result: "NEW_INFO" });
    expect(r.warnings).toEqual(["connections_not_dropped"]);
  });
});

describe("runDbsRecheck — failure branches", () => {
  it("records the warnings of a failed follow-up in the log row", async () => {
    h.nannyEmail.mockRejectedValueOnce(new Error("resend down"));
    await runDbsRecheck(admin(), { check: async () => NEW_INFO, config: fast });
    expect(logs()[0].action_details).toMatchObject({ trigger: "recheck", result: "NEW_INFO", recheck_fail: true, warnings: ["nanny_email_failed"] });
  });

  it("a write the database refuses is logged as write_refused and counted as an error; she is unchanged", async () => {
    const refused = { ...NEW_INFO, status: "SOMETHING_ELSE" } as unknown as DbsCheckResult; // breaks the ocg result CHECK
    const s = await runDbsRecheck(admin(), { check: async () => refused, config: fast });
    expect(s).toMatchObject({ checked: 1, errors: 1, failed_new_info: 0 });
    expect(h.db.tables.verifications[0]).toMatchObject({ verification_status: 40, wwcc_verified: true });
    expect(logs()[0].action_details).toEqual({ trigger: "recheck", result: "NEW_INFO", reason: "write_refused" });
    expect(h.nannyEmail).not.toHaveBeenCalled();
  });

  it("an adapter that throws a non-Error is an ERROR (exception), nothing written", async () => {
    const s = await runDbsRecheck(admin(), { check: () => Promise.reject("boom"), config: fast });
    expect(s).toMatchObject({ checked: 1, errors: 1 });
    expect(logs()[0].action_details).toEqual({ trigger: "recheck", result: "ERROR", reason: "exception" });
  });

  it("a throw outside the adapter (e.g. the log insert) is counted as an error and the batch goes on", async () => {
    const base = h.db.client() as { from: (t: string) => unknown };
    const broken = { from: (t: string) => (t === "activity_logs" ? { insert: () => { throw "insert blew up"; } } : base.from(t)) };
    const s = await runDbsRecheck(broken as unknown as Admin, { check: async () => ({ result: "ERROR", reason: "timeout" }), config: fast });
    expect(s).toMatchObject({ checked: 1, errors: 1 });
  });

  it("throws when the nanny-level read fails (the route answers 500)", async () => {
    const base = h.db.client() as { from: (t: string) => unknown };
    const broken = {
      from: (t: string) =>
        t === "nannies" ? { select: () => ({ eq: () => ({ in: async () => ({ data: null, error: { message: "down" } }) }) }) } : base.from(t),
    };
    await expect(runDbsRecheck(broken as unknown as Admin, { check: async () => NEW_INFO, config: fast })).rejects.toThrow(/nanny read failed/);
  });

  it("throws when the selection read fails", async () => {
    const broken = { from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ order: () => ({ limit: async () => ({ data: null, error: { message: "down" } }) }) }) }) }) }) };
    await expect(runDbsRecheck(broken as unknown as Admin, { check: async () => NEW_INFO, config: fast })).rejects.toThrow(/selection failed/);
  });
});
