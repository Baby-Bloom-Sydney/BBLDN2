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
  pausedEmail: vi.fn(async () => {}),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }));
vi.mock("@/lib/actions/verification", () => ({ syncNannyVerificationState: h.sync }));
vi.mock("@/lib/email/dbs-emails", () => ({
  sendDbsRecheckFailedEmail: h.nannyEmail, sendDbsRecheckAdminAlert: h.adminEmail, sendDbsRecheckPausedAlert: h.pausedEmail,
}));

import { onDbsRecheckFailed, runDbsRecheck } from "./recheck";

type Admin = Parameters<typeof runDbsRecheck>[0];
const fast = { intervalMs: 1, batchLimit: 10, timeBudgetMs: 60_000, applyDeadlineMs: 120_000, pauseRatio: 0.2, pauseMinFailures: 3 };
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
    expect(r).toEqual({ kept: 0, dropped: 1, notDropped: 0, warnings: ["sync_failed", "sync_not_applied", "nanny_email_failed", "admin_email_failed"] });
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
    expect(r.warnings).toEqual(["nanny_read_failed"]); // the level re-read uses the same broken nannies read
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
    expect(r.warnings).toEqual(["sync_not_applied", "connections_not_dropped"]);
  });
});

// Code review (3i) MEDIUM 1 + 2 — written red first.
describe("review fixes — the marker is written first; a sync that did not apply is caught", () => {
  it("MEDIUM 1 writes the re-check marker before any follow-up, then completes the same row with the counts", async () => {
    let markerAtEmailTime: unknown;
    h.nannyEmail.mockImplementationOnce(async () => {
      markerAtEmailTime = logs()[0]?.action_details;
    });
    await runDbsRecheck(admin(), { check: async () => NEW_INFO, config: fast });
    expect(markerAtEmailTime).toMatchObject({ trigger: "recheck", result: "NEW_INFO", recheck_fail: true, status_at: expect.any(String) });
    expect(logs()).toHaveLength(1);
    expect(logs()[0].action_details).toMatchObject({ recheck_fail: true, kept: 0, dropped: 1, not_dropped: 0 });
  });

  it("MEDIUM 2 warns sync_not_applied when her nannies row is still level 3+ after the sync", async () => {
    // the mocked sync does nothing — exactly a sync whose nannies UPDATE silently failed
    const r = await onDbsRecheckFailed(admin(), { userId: "u1", result: "NEW_INFO" });
    expect(r.warnings).toContain("sync_not_applied");
  });

  it("MEDIUM 2 no warning when the sync did apply (level 2)", async () => {
    h.sync.mockImplementationOnce(async () => {
      h.db.tables.nannies[0].verification_level = 2;
    });
    const r = await onDbsRecheckFailed(admin(), { userId: "u1", result: "NEW_INFO" });
    expect(r.warnings).toEqual([]);
  });
});

// Security review MEDIUM 2 — a re-check whose after-fail step half-failed (sync or drop failed, or the run was killed
// after the guarded UPDATE) is repaired by the next run: she is 23/26 with an approval in her history but her nannies
// row still says level 4. Written red first.
describe("security review M2 — reconcile a half-failed re-check at the start of each run", () => {
  function halfFailed() {
    Object.assign(h.db.tables.verifications[0], { verification_status: 23, wwcc_status: "expired", wwcc_verified: false, cross_check_status: "not_started" });
  }

  it("re-syncs her and drops her non-hired connections; sends no second email", async () => {
    halfFailed();
    const s = await runDbsRecheck(admin(), { check: async () => NEW_INFO, config: fast });
    expect(h.sync).toHaveBeenCalledWith("u1");
    expect(h.db.tables.connection_requests[0]).toMatchObject({ connection_stage: 1, status: "expired" });
    expect(h.nannyEmail).not.toHaveBeenCalled();
    expect(h.adminEmail).not.toHaveBeenCalled();
    expect(s).toMatchObject({ reconciled: 1, checked: 0 });
  });

  it("leaves a healthy level-4 nanny to the normal check", async () => {
    const s = await runDbsRecheck(admin(), { check: async () => ({ result: "BLANK", status: "BLANK_NO_NEW_INFO", raw: "<x/>", forename: null, surname: null, printDate: null }) as DbsCheckResult, config: fast });
    expect(s).toMatchObject({ reconciled: 0, checked: 1, passed: 1 });
    expect(h.sync).not.toHaveBeenCalled();
  });

  it("a reconcile read error never blocks the run", async () => {
    halfFailed();
    const base = h.db.client() as { from: (t: string) => unknown };
    let first = true;
    const broken = {
      from: (t: string) => {
        if (t === "nannies" && first) {
          first = false;
          return { select: () => ({ eq: async () => ({ data: null, error: { message: "down" } }) }) };
        }
        return base.from(t);
      },
    };
    const s = await runDbsRecheck(broken as unknown as Admin, { check: async () => NEW_INFO, config: fast });
    expect(s).toMatchObject({ reconciled: 0 });
  });
});

describe("runDbsRecheck — failure branches", () => {
  it("records the warnings of a failed follow-up in the log row", async () => {
    h.nannyEmail.mockRejectedValueOnce(new Error("resend down"));
    await runDbsRecheck(admin(), { check: async () => NEW_INFO, config: fast });
    expect(logs()[0].action_details).toMatchObject({ trigger: "recheck", result: "NEW_INFO", recheck_fail: true, warnings: ["sync_not_applied", "nanny_email_failed"] });
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

describe("P-15 — config and the paused email failing", () => {
  it("reads the cut-off from named defaults (20 %, 3) and env, rejecting nonsense", async () => {
    const { getDbsRecheckConfig, DBS_RECHECK_DEFAULTS } = await import("./config");
    expect(DBS_RECHECK_DEFAULTS).toMatchObject({ pauseRatio: 0.2, pauseMinFailures: 3, timeBudgetMs: 180_000, applyDeadlineMs: 270_000 });
    expect(getDbsRecheckConfig({})).toMatchObject({ pauseRatio: 0.2, pauseMinFailures: 3 });
    expect(getDbsRecheckConfig({ DBS_RECHECK_PAUSE_RATIO: "0.5", DBS_RECHECK_PAUSE_MIN_FAILURES: "10" })).toMatchObject({ pauseRatio: 0.5, pauseMinFailures: 10 });
    for (const bad of ["0", "1", "-0.1", "abc", ""]) expect(getDbsRecheckConfig({ DBS_RECHECK_PAUSE_RATIO: bad }).pauseRatio).toBe(0.2);
  });

  it("a failed paused email is logged in the PAUSED row and still applies nothing", async () => {
    h.pausedEmail.mockRejectedValueOnce(new Error("resend down"));
    const s = await runDbsRecheck(admin(), { check: async () => NEW_INFO, config: { ...fast, pauseMinFailures: 1 } });
    expect(s).toMatchObject({ paused_on_fail_ratio: true, failures_held: 1 });
    expect(h.db.tables.verifications[0]).toMatchObject({ verification_status: 40 });
    expect(logs()[0]).toMatchObject({ user_id: null, action_details: expect.objectContaining({ result: "PAUSED", warnings: ["admin_email_failed"] }) });
  });
});
