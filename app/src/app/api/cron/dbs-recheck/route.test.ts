/**
 * Unit 3i (BB-LDN-3i-141026) — the daily DBS re-check cron, R1–R20 (brief "Tests first", test plan §2.5 amended).
 *
 * The Supabase stand-in is the in-memory chained-builder fake (`tests/fakes/memory-supabase.ts`): it records every
 * write, applies the filters to updates (so the guarded UPDATE behaves as Postgres does) and enforces the London
 * verifications CHECKs incl. the 40 CHECK. The REAL `syncNannyVerificationState`, mapper, connection drop and DBS email
 * senders run; only the Update Service call, Resend and the user lookup are stand-ins.
 *
 * Rulings: #12, #28, #32, #33, #35 · README P-3 (hired kept, the rest dropped), P-7 (level 2 via the cross-check reset in
 * the same UPDATE), P-9 (R19: dropped connections are silent to parents — supersedes the brief's inbox message), P-14
 * (a bar is not this unit's) · addendum M1 (R14: the VER-003 selector skips a re-check failure by its log marker).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { createMemoryDb, type MemoryDb } from "../../../../../tests/fakes/memory-supabase";
import type { DbsCheckResult } from "@/lib/dbs/update-service";
import { CONNECTION_STAGE } from "@/lib/position/constants";

const h = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  check: vi.fn(),
  sends: [] as Array<{ to: string; subject: string; html: string; emailType: string }>,
  createInboxMessage: vi.fn(async () => {}),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/dbs/update-service", async (orig) => ({
  ...(await orig<typeof import("@/lib/dbs/update-service")>()),
  checkDbsStatus: h.check,
}));
vi.mock("@/lib/email/resend", () => ({
  sendEmail: async (p: { to: string; subject: string; html: string; emailType: string }) => {
    h.sends.push(p);
    return { success: true } as const;
  },
}));
vi.mock("@/lib/email/helpers", () => ({
  getUserEmailInfo: async (userId: string) => ({ email: `${userId}@example.test`, firstName: "Sophie", lastName: "Taylor", userId }),
}));
vi.mock("@/lib/actions/connection-helpers", () => ({ createInboxMessage: h.createInboxMessage }));

const SECRET = "test-cron-secret";
const APPROVED_AT = "2026-09-01T00:00:00.000Z";

const ok = (kind: "BLANK" | "NON_BLANK" | "NEW_INFO" | "NO_MATCH"): DbsCheckResult => {
  const status = { BLANK: "BLANK_NO_NEW_INFO", NON_BLANK: "NON_BLANK_NO_NEW_INFO", NEW_INFO: "NEW_INFO", NO_MATCH: "NO_MATCH_FOUND" }[kind];
  return { result: kind, status, raw: `<statusCheckResult>${status}</statusCheckResult>`, forename: "SOPHIE", surname: "TAYLOR", printDate: "2024-01-10" } as DbsCheckResult;
};
const ERR: DbsCheckResult = { result: "ERROR", reason: "http_500" };

/** A level-4 nanny: verifications row at 40 + nannies row at level 4. */
function level4(n: number, over: Record<string, unknown> = {}) {
  return {
    verification: {
      id: `v${n}`, user_id: `u${n}`, updated_at: APPROVED_AT,
      identity_status: "verified", identity_verified: true,
      wwcc_status: "doc_verified", wwcc_status_at: APPROVED_AT, wwcc_verified: true, wwcc_doc_verified: true,
      wwcc_verified_by: "admin-0", wwcc_verified_at: APPROVED_AT, cross_check_status: "passed",
      verification_status: 40, wwcc_user_guidance: null,
      extracted_wwcc_number: `00000000000${n}`, extracted_wwcc_surname: "Taylor", extracted_wwcc_dob: "1990-03-05",
      extracted_wwcc_first_name: "Sophie", extracted_wwcc_expiry: "2024-01-10",
      ocg_result_status: "BLANK_NO_NEW_INFO", ocg_result_text: "<old/>", ocg_verified_at: `2026-10-0${n}T00:00:00.000Z`,
      ...over,
    },
    nanny: { id: `n${n}`, user_id: `u${n}`, verification_level: 4, status: "active", identity_verified: true, wwcc_verified: true },
  };
}

function seed(nannies: ReturnType<typeof level4>[], extra: Record<string, Record<string, unknown>[]> = {}) {
  h.db = createMemoryDb({
    verifications: nannies.map((x) => x.verification),
    nannies: nannies.map((x) => x.nanny),
    activity_logs: [],
    connection_requests: [],
    ...extra,
  });
}

const ver = (id = "v1") => h.db.tables.verifications.find((r) => r.id === id)!;
const nannyRow = (id = "n1") => h.db.tables.nannies.find((r) => r.id === id)!;
const logs = () => h.db.tables.activity_logs;
const verificationWrites = () => h.db.writes.filter((w) => w.table === "verifications");
const nannyEmails = () => h.sends.filter((s) => s.emailType === "verification_rejected");
const adminEmails = () => h.sends.filter((s) => s.emailType === "admin_notification");

async function callRoute(auth: string | null = `Bearer ${SECRET}`) {
  const { GET } = await import("./route");
  const headers: Record<string, string> = auth ? { authorization: auth } : {};
  return GET(new NextRequest("http://localhost/api/cron/dbs-recheck", { headers }));
}

async function runOk() {
  const res = await callRoute();
  expect(res.status).toBe(200);
  return res.json();
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  h.sends = [];
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.stubEnv("DBS_RECHECK_INTERVAL_MS", "1");
  h.check.mockImplementation(async () => ok("BLANK"));
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("cron/dbs-recheck — auth (change 1, fail-closed)", () => {
  it("R1 returns 503 and checks nobody when CRON_SECRET is missing", async () => {
    vi.stubEnv("CRON_SECRET", "");
    seed([level4(1)]);
    const res = await callRoute();
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ error: "cron_secret_not_configured" });
    expect(h.check).not.toHaveBeenCalled();
    expect(h.db.writes).toHaveLength(0);
  });

  it("R2 returns 401 when the bearer secret is wrong", async () => {
    seed([level4(1)]);
    expect((await callRoute("Bearer nope")).status).toBe(401);
    expect((await callRoute(null)).status).toBe(401);
    expect(h.check).not.toHaveBeenCalled();
  });

  it("exports maxDuration = 300", async () => {
    const mod = await import("./route");
    expect(mod.maxDuration).toBe(300);
  });
});

describe("cron/dbs-recheck — selection (change 2)", () => {
  it("R3 selects level-4 nannies only, never level 3 or below", async () => {
    const l3 = level4(2, { verification_status: 30, wwcc_verified: false, wwcc_verified_by: null, wwcc_verified_at: null });
    l3.nanny.verification_level = 3;
    const lagging = level4(3); // a 40 row whose nanny is not (yet) level 4 — not re-checked
    lagging.nanny.verification_level = 2;
    seed([level4(1), l3, lagging]);
    const body = await runOk();
    expect(h.check).toHaveBeenCalledTimes(1);
    expect(h.check.mock.calls[0][0]).toEqual({ certificateNumber: "000000000001", surname: "Taylor", dateOfBirth: "1990-03-05" });
    expect(body.checked).toBe(1);
  });

  it("checks the least recently checked first (ocg_verified_at ascending, never-checked first) and honours the batch limit", async () => {
    vi.stubEnv("DBS_RECHECK_BATCH_LIMIT", "2");
    seed([level4(3), level4(1), level4(2, { ocg_verified_at: null })]);
    await runOk();
    expect(h.check.mock.calls.map((c) => c[0].certificateNumber)).toEqual(["000000000002", "000000000001"]);
  });

  it("R15 skips and logs a level-4 row with no certificate number instead of failing her", async () => {
    seed([level4(1, { extracted_wwcc_number: null }), level4(2)]);
    const body = await runOk();
    expect(h.check).toHaveBeenCalledTimes(1);
    expect(ver("v1")).toMatchObject({ verification_status: 40, wwcc_verified: true });
    expect(logs()).toHaveLength(1);
    expect(logs()[0]).toMatchObject({ user_id: "u1", action_type: "dbs_status_check", action_details: { trigger: "recheck", result: "ERROR", reason: "missing_details" } });
    expect(body).toMatchObject({ checked: 1, passed: 1, skipped: 1 });
  });
});

describe("cron/dbs-recheck — pass (#12, #33)", () => {
  it.each(["BLANK", "NON_BLANK"] as const)("R4 writes only ocg_result_status, ocg_result_text and ocg_verified_at on %s — status stays 40, level 4, no activity_logs row, no email, no queue item", async (kind) => {
    seed([level4(1)]);
    h.check.mockImplementation(async () => ok(kind));
    const body = await runOk();
    expect(verificationWrites()).toHaveLength(1);
    expect(Object.keys(verificationWrites()[0].payload).sort()).toEqual(["ocg_result_status", "ocg_result_text", "ocg_verified_at"]);
    expect(ver()).toMatchObject({ verification_status: 40, wwcc_verified: true, cross_check_status: "passed", ocg_result_status: ok(kind).result === "BLANK" ? "BLANK_NO_NEW_INFO" : "NON_BLANK_NO_NEW_INFO" });
    expect(ver().ocg_verified_at).not.toBe("2026-10-01T00:00:00.000Z");
    expect(nannyRow().verification_level).toBe(4);
    expect(logs()).toHaveLength(0);
    expect(h.sends).toHaveLength(0);
    expect(h.db.writes.filter((w) => w.table !== "verifications")).toHaveLength(0);
    expect(body).toEqual({ checked: 1, passed: 1, failed_new_info: 0, failed_no_match: 0, errors: 0, skipped: 0, stopped_on_budget: false });
  });
});

describe("cron/dbs-recheck — fail (change 4, #12, #28, P-7)", () => {
  it("R5 sets 23, wwcc_verified=false and keeps wwcc_verified_at and wwcc_verified_by on NEW_INFO; ocg_verified_at is this run", async () => {
    seed([level4(1)]);
    h.check.mockImplementation(async () => ok("NEW_INFO"));
    const before = Date.now();
    const body = await runOk();
    expect(ver()).toMatchObject({
      verification_status: 23, wwcc_status: "expired", wwcc_verified: false, ocg_result_status: "NEW_INFO",
      wwcc_verified_at: APPROVED_AT, wwcc_verified_by: "admin-0", identity_status: "verified", identity_verified: true,
    });
    expect(Date.parse(String(ver().ocg_verified_at))).toBeGreaterThanOrEqual(before - 1);
    expect(Date.parse(String(ver().wwcc_status_at))).toBeGreaterThanOrEqual(before - 1);
    expect(body).toMatchObject({ checked: 1, failed_new_info: 1, failed_no_match: 0 });
  });

  it("R6 sets 26 on NO_MATCH", async () => {
    seed([level4(1)]);
    h.check.mockImplementation(async () => ok("NO_MATCH"));
    const body = await runOk();
    expect(ver()).toMatchObject({ verification_status: 26, wwcc_status: "ocg_not_found", wwcc_verified: false, ocg_result_status: "NO_MATCH_FOUND" });
    expect(body).toMatchObject({ failed_no_match: 1, failed_new_info: 0 });
  });

  it("R7 drops her to level 2 through the real sync — not level 3 — because cross_check_status is reset", async () => {
    seed([level4(1)]);
    h.check.mockImplementation(async () => ok("NEW_INFO"));
    await runOk();
    expect(ver().cross_check_status).toBe("not_started");
    expect(nannyRow()).toMatchObject({ verification_level: 2, wwcc_verified: false, identity_verified: true, status: "active" });
  });

  it("R20 (P-7) writes cross_check_status not_started in the same update as status 23/26, so she has no Verified badge", async () => {
    seed([level4(1)]);
    h.check.mockImplementation(async () => ok("NO_MATCH"));
    await runOk();
    expect(verificationWrites()).toHaveLength(1);
    expect(verificationWrites()[0].payload).toMatchObject({ verification_status: 26, cross_check_status: "not_started", wwcc_verified: false });
    expect(nannyRow().verification_level).toBeLessThan(3);
  });

  it("R8 sends the nanny the re-check failure email once", async () => {
    seed([level4(1)]);
    h.check.mockImplementation(async () => ok("NEW_INFO"));
    await runOk();
    expect(nannyEmails()).toHaveLength(1);
    expect(nannyEmails()[0]).toMatchObject({ to: "u1@example.test", subject: "Action needed: you'll need a new DBS certificate" });
    // A second run the same day: she is level 2 now, so she is not selected and not emailed again.
    await runOk();
    expect(nannyEmails()).toHaveLength(1);
  });

  it("R9 sends the admin alert email and creates no queue item", async () => {
    vi.stubEnv("ADMIN_EMAIL", "ops@example.test");
    seed([level4(1)]);
    h.check.mockImplementation(async () => ok("NO_MATCH"));
    await runOk();
    expect(adminEmails()).toHaveLength(1);
    expect(adminEmails()[0].to).toBe("ops@example.test");
    expect(adminEmails()[0].subject).toBe("DBS re-check failed: Sophie Taylor — No Update Service match");
    expect(adminEmails()[0].html).toContain("/admin/users");
    const tablesWritten = new Set(h.db.writes.map((w) => w.table));
    expect([...tablesWritten].sort()).toEqual(["activity_logs", "nannies", "verifications"]);
  });

  it("logs one dbs_status_check row per failure with the re-check marker (#33, addendum M1)", async () => {
    seed([level4(1)]);
    h.check.mockImplementation(async () => ok("NEW_INFO"));
    await runOk();
    expect(logs()).toHaveLength(1);
    expect(logs()[0]).toMatchObject({
      user_id: "u1", action_type: "dbs_status_check",
      action_details: { trigger: "recheck", result: "NEW_INFO", recheck_fail: true, status_at: ver().wwcc_status_at, kept: 0, dropped: 0, not_dropped: 0 },
    });
    expect(JSON.stringify(logs()[0])).not.toContain("000000000001");
  });
});

describe("cron/dbs-recheck — API error, throws, races (#32)", () => {
  it("R10 changes nothing on ERROR after the in-run retry and writes one dbs_status_check row", async () => {
    seed([level4(1)]);
    h.check.mockImplementation(async () => ERR);
    const body = await runOk();
    expect(verificationWrites()).toHaveLength(0);
    expect(nannyRow().verification_level).toBe(4);
    expect(logs()).toHaveLength(1);
    expect(logs()[0].action_details).toEqual({ trigger: "recheck", result: "ERROR", reason: "http_500" });
    expect(h.sends).toHaveLength(0);
    expect(body).toMatchObject({ checked: 1, errors: 1, passed: 0 });
  });

  it("R11 processes every nanny when one call throws", async () => {
    seed([level4(1), level4(2), level4(3)]);
    h.check.mockImplementationOnce(async () => ok("BLANK")).mockImplementationOnce(async () => {
      throw new Error("boom");
    }).mockImplementationOnce(async () => ok("NEW_INFO"));
    const body = await runOk();
    expect(h.check).toHaveBeenCalledTimes(3);
    expect(body).toMatchObject({ checked: 3, passed: 1, errors: 1, failed_new_info: 1 });
    expect(ver("v3").verification_status).toBe(23);
  });

  it("R13 does not overwrite a row an admin changed mid-run (guarded update matches 0 rows → no email, no log)", async () => {
    seed([level4(1)]);
    h.check.mockImplementation(async () => {
      // The admin bars her while the call is in flight.
      Object.assign(ver(), { wwcc_status: "barred", wwcc_verified: false, verification_status: 27 });
      return ok("NEW_INFO");
    });
    const body = await runOk();
    // (the fake records a guarded UPDATE even when it matched no row — what matters is that her row is untouched)
    expect(ver()).toMatchObject({ wwcc_status: "barred", verification_status: 27, ocg_result_text: "<old/>", cross_check_status: "passed" });
    expect(h.sends).toHaveLength(0);
    expect(logs()).toHaveLength(0);
    expect(body).toMatchObject({ checked: 1, skipped: 1, failed_new_info: 0 });
  });

  it("returns 500 with no names when the selection read fails", async () => {
    seed([level4(1)]);
    const client = h.db.client() as { from: (t: string) => unknown };
    h.db.client = () => ({
      ...client,
      from: (t: string) => (t === "verifications" ? { select: () => { throw new Error("db down"); } } : client.from(t)),
    });
    const res = await callRoute();
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "recheck_failed" });
    h.db.client = () => ({ ...client, from: () => ({ select: () => { throw "not an Error"; } }) });
    expect((await callRoute()).status).toBe(500);
  });
});

describe("runDbsRecheck — throttle and time budget (change 3)", () => {
  it("R12 waits the configured interval between calls and stops starting checks after the time budget", async () => {
    seed([level4(1), level4(2), level4(3), level4(4)]);
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const { runDbsRecheck } = await import("@/lib/dbs/recheck");
    let clock = 0;
    const sleeps: number[] = [];
    const check = vi.fn(async () => {
      clock += 1_000; // each call takes 1 s
      return ok("BLANK");
    });
    const summary = await runDbsRecheck(createAdminClient(), {
      check,
      now: () => clock,
      sleep: async (ms: number) => {
        sleeps.push(ms);
        clock += ms;
      },
      config: { intervalMs: 500, batchLimit: 500, timeBudgetMs: 3_000 },
    });
    // t=0 check1 → 1000; sleep → 1500 check2 → 2500; sleep → 3000 ≥ budget → stop.
    expect(check).toHaveBeenCalledTimes(2);
    expect(sleeps).toEqual([500, 500]);
    expect(summary).toMatchObject({ checked: 2, passed: 2, stopped_on_budget: true });
  });
});

describe("cron/dbs-recheck — connections on a re-check fail (P-3, P-9)", () => {
  const conn = (id: string, stage: number, over: Record<string, unknown> = {}) => ({
    id, nanny_id: "n1", parent_id: `p-${id}`, position_id: `pos-${id}`, connection_stage: stage,
    status: stage === CONNECTION_STAGE.CONFIRMED || stage === CONNECTION_STAGE.ACTIVE ? "confirmed" : "pending",
    source: null, parent_phone_shared: null, updated_at: APPROVED_AT, ...over,
  });
  const rows = () => [
    conn("hired-34", CONNECTION_STAGE.CONFIRMED),
    conn("hired-40", CONNECTION_STAGE.ACTIVE),
    conn("open-0", CONNECTION_STAGE.REQUEST_SENT),
    conn("open-10", CONNECTION_STAGE.ACCEPTED, { status: "accepted" }),
    conn("open-20", CONNECTION_STAGE.INTRO_SCHEDULED, { status: "accepted" }),
    conn("open-33", CONNECTION_STAGE.OFFERED, { status: "accepted" }),
    conn("held-4", CONNECTION_STAGE.NANNY_APPLIED_PENDING),
    conn("done-41", CONNECTION_STAGE.FINISHED, { status: "confirmed" }),
    conn("done-2", CONNECTION_STAGE.DECLINED, { status: "declined" }),
    conn("other-nanny-20", CONNECTION_STAGE.INTRO_SCHEDULED, { nanny_id: "n9" }),
  ];
  const byId = (id: string) => h.db.tables.connection_requests.find((r) => r.id === id);

  it("R16 keeps CONFIRMED and ACTIVE connections and drops every other open connection when the re-check fails", async () => {
    seed([level4(1)], { connection_requests: rows() });
    h.check.mockImplementation(async () => ok("NEW_INFO"));
    await runOk();
    expect(byId("hired-34")).toMatchObject({ connection_stage: CONNECTION_STAGE.CONFIRMED, status: "confirmed", updated_at: APPROVED_AT });
    expect(byId("hired-40")).toMatchObject({ connection_stage: CONNECTION_STAGE.ACTIVE, status: "confirmed", updated_at: APPROVED_AT });
    for (const id of ["open-0", "open-20", "open-33"]) {
      expect(byId(id)).toMatchObject({ connection_stage: CONNECTION_STAGE.REQUEST_EXPIRED, status: "expired" });
    }
    expect(byId("open-10")).toMatchObject({ connection_stage: CONNECTION_STAGE.SCHEDULE_EXPIRED, status: "expired" });
    expect(byId("held-4")).toBeUndefined();
    expect(logs()[0].action_details).toMatchObject({ kept: 2, dropped: 5, not_dropped: 0 });
  });

  it("R17 leaves FINISHED and other hidden-stage rows untouched (and another nanny's rows)", async () => {
    seed([level4(1)], { connection_requests: rows() });
    h.check.mockImplementation(async () => ok("NO_MATCH"));
    await runOk();
    expect(byId("done-41")).toMatchObject({ connection_stage: CONNECTION_STAGE.FINISHED, status: "confirmed", updated_at: APPROVED_AT });
    expect(byId("done-2")).toMatchObject({ connection_stage: CONNECTION_STAGE.DECLINED, status: "declined", updated_at: APPROVED_AT });
    expect(byId("other-nanny-20")).toMatchObject({ connection_stage: CONNECTION_STAGE.INTRO_SCHEDULED, status: "pending", updated_at: APPROVED_AT });
  });

  it.each([["BLANK"], ["NON_BLANK"], ["ERROR"]] as const)("R18 drops nothing on %s", async (kind) => {
    seed([level4(1)], { connection_requests: rows() });
    h.check.mockImplementation(async () => (kind === "ERROR" ? ERR : ok(kind)));
    await runOk();
    expect(h.db.writes.filter((w) => w.table === "connection_requests")).toHaveLength(0);
    expect(h.db.tables.connection_requests).toHaveLength(rows().length);
  });

  it("R19 (P-9) tells the parent of a dropped connection nothing — no inbox message, no email, no reason", async () => {
    seed([level4(1)], { connection_requests: rows() });
    h.check.mockImplementation(async () => ok("NEW_INFO"));
    await runOk();
    expect(h.createInboxMessage).not.toHaveBeenCalled();
    expect(h.db.writes.filter((w) => w.table === "inbox_messages")).toHaveLength(0);
    // The only two emails: hers and the admin's. No parent address appears anywhere.
    expect(h.sends.map((s) => s.emailType).sort()).toEqual(["admin_notification", "verification_rejected"]);
    expect(h.sends.filter((s) => s.to.startsWith("p-"))).toHaveLength(0);
  });
});

describe("R14 — VER-003 never also fires for a re-check failure (addendum M1)", () => {
  it("R14 a re-check failure row is not selected by the VER-003 first-check email trigger", async () => {
    seed([level4(1)]);
    h.check.mockImplementation(async () => ok("NO_MATCH"));
    await runOk();
    const { selectVer003Candidates } = await import("@/lib/email/ver003-candidates");
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const later = new Date(Date.now() + 60 * 60 * 1000).toISOString(); // well past the 10-minute delay
    expect(ver().wwcc_status).toBe("ocg_not_found");
    expect(await selectVer003Candidates(createAdminClient(), later)).toEqual([]);
  });
});
