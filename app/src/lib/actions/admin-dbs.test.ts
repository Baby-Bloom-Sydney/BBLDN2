/**
 * Unit 3d (BB-LDN-3d-061026) — the admin DBS decisions: Approve (D1–D1d), forbidden (D2), Bar (D5), Lift bar (D6, #36),
 * Run DBS check now (D7–D7e; D7e rewritten by P-8: a level-4 fail = a failed re-check, 23/26, level 2).
 * Real `syncNannyVerificationState` against the in-memory Supabase (London CHECKs incl. amendment 10).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMemoryDb, type MemoryDb } from "../../../tests/fakes/memory-supabase";
import type { DbsCheckResult } from "@/lib/dbs/update-service";

const h = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  user: { id: "admin-1" } as { id: string } | null,
  dbs: { result: "BLANK", status: "BLANK_NO_NEW_INFO", raw: "<xml/>", forename: "SOPHIE", surname: "TAYLOR", printDate: "2024-01-10" } as DbsCheckResult,
  checkDbsStatus: vi.fn(),
  runCrossCheckPhase: vi.fn(async () => {}),
  sendBarredEmails: vi.fn(async () => {}),
  createInboxMessage: vi.fn(async () => {}),
  revalidatePath: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    ...(h.db.client() as object),
    auth: { getUser: async () => ({ data: { user: h.user }, error: h.user ? null : { message: "no" } }) },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("@/lib/dbs/update-service", async (orig) => ({
  ...(await orig<typeof import("@/lib/dbs/update-service")>()),
  checkDbsStatus: h.checkDbsStatus,
}));
vi.mock("@/lib/ai/verification-pipeline", () => ({ runCrossCheckPhase: h.runCrossCheckPhase, triggerCrossCheck: vi.fn() }));
vi.mock("@/lib/email/dbs-emails", () => ({ sendBarredEmails: h.sendBarredEmails, sendDbsRejectedEmail: vi.fn() }));
vi.mock("@/lib/email/resend", () => ({ sendEmail: vi.fn(async () => ({ success: true })) }));
vi.mock("@/lib/email/helpers", () => ({ getUserEmailInfo: vi.fn(async () => null) }));
vi.mock("./connection-helpers", () => ({ createInboxMessage: h.createInboxMessage }));

import { adminVerifyWWCC, adminBarDbs, adminLiftDbsBar, adminRunDbsCheck } from "./admin-dbs";

const PASS = { ocg_result_status: "BLANK_NO_NEW_INFO", ocg_result_text: "<xml/>", ocg_verified_at: "2026-10-06T00:00:00Z" };

function seed(over: Record<string, unknown> = {}, nanny: Record<string, unknown> = {}, extra: Record<string, Record<string, unknown>[]> = {}) {
  h.db = createMemoryDb({
    user_roles: [{ user_id: "admin-1", role: "admin" }, { user_id: "nanny-u", role: "nanny" }],
    verifications: [
      {
        id: "v1", user_id: "nanny-u", updated_at: "2026-10-06T00:00:00Z",
        identity_status: "verified", identity_verified: true,
        wwcc_status: "doc_verified", wwcc_verified: false, wwcc_doc_verified: true, cross_check_status: "passed",
        verification_status: 30, wwcc_verified_by: null, wwcc_verified_at: null,
        extracted_wwcc_number: "001234567890", extracted_wwcc_surname: "Taylor", extracted_wwcc_dob: "1990-03-05",
        extracted_wwcc_first_name: "Sophie", extracted_wwcc_expiry: "2024-01-10",
        wwcc_user_guidance: { title: "x", explanation: "y", steps_to_fix: [], reason_code: "PASS" },
        ...PASS,
        ...over,
      },
    ],
    nannies: [{ id: "n1", user_id: "nanny-u", verification_level: 3, status: "active", ...nanny }],
    activity_logs: [],
    connection_requests: [],
    ...extra,
  });
}
const v = () => h.db.tables.verifications[0];
const nanny = () => h.db.tables.nannies[0];
const logs = (type?: string) => h.db.tables.activity_logs.filter((r) => !type || r.action_type === type);
const verificationWrites = () => h.db.writes.filter((w) => w.table === "verifications");

beforeEach(() => {
  vi.clearAllMocks();
  h.user = { id: "admin-1" };
  h.checkDbsStatus.mockImplementation(async () => h.dbs);
});

describe("adminVerifyWWCC — Approve, the only writer of level 4 (#11, P-1)", () => {
  it.each([30, 21])("D1 sets wwcc_verified, status 40 and calls sync when caller is admin and status is %i with an API pass", async (code) => {
    seed({ verification_status: code, cross_check_status: code === 21 ? "review" : "passed", wwcc_status: code === 21 ? "doc_verified" : "doc_verified" });
    const r = await adminVerifyWWCC("v1");
    expect(r).toEqual({ success: true, error: null });
    expect(v()).toMatchObject({
      wwcc_verified: true, wwcc_verified_by: "admin-1", wwcc_doc_verified: true, wwcc_status: "doc_verified",
      cross_check_status: "passed", verification_status: 40, wwcc_rejection_reason: null, wwcc_user_guidance: null,
    });
    expect(v().wwcc_verified_at).toBeTruthy();
    expect(nanny()).toMatchObject({ verification_level: 4, status: "active", wwcc_verified: true });
    expect(logs("verification_approved")).toHaveLength(1);
    expect(logs("verification_approved")[0].action_details).toMatchObject({ admin_id: "admin-1", decision: "approve", api_result: "BLANK_NO_NEW_INFO", ai_reason_code: "PASS" });
    expect(h.revalidatePath).toHaveBeenCalledWith("/admin/users");
  });

  it.each([[null], ["NEW_INFO"], ["NO_MATCH_FOUND"]])("D1b refuses and writes nothing when ocg_result_status is %s", async (ocg) => {
    seed({ ocg_result_status: ocg });
    const r = await adminVerifyWWCC("v1");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Update Service pass/);
    expect(verificationWrites()).toHaveLength(0);
    expect(nanny().verification_level).toBe(3);
  });

  it("D1c refuses when identity is not verified", async () => {
    seed({ identity_status: "review", identity_verified: false });
    const r = await adminVerifyWWCC("v1");
    expect(r.success).toBe(false);
    expect(verificationWrites()).toHaveLength(0);
  });

  it.each([20, 22, 23, 26, 27])("D1 refuses from status %i (only 21 or 30 can be approved)", async (code) => {
    seed({ verification_status: code, wwcc_status: code === 27 ? "barred" : "doc_verified" });
    expect((await adminVerifyWWCC("v1")).success).toBe(false);
    expect(verificationWrites()).toHaveLength(0);
  });

  it("D1d is a no-op success when already 40", async () => {
    seed({ verification_status: 40, wwcc_verified: true, wwcc_verified_by: "admin-0", wwcc_verified_at: "2026-10-01T00:00:00Z" }, { verification_level: 4 });
    expect(await adminVerifyWWCC("v1")).toEqual({ success: true, error: null });
    expect(verificationWrites()).toHaveLength(0);
    expect(v().wwcc_verified_by).toBe("admin-0");
  });

  it("releases her held stage-9 accept to stage 10 and notifies the parent once (I9)", async () => {
    seed({}, {}, {
      connection_requests: [{ id: "c1", nanny_id: "n1", parent_id: "p1", position_id: "pos1", connection_stage: 9, status: "accepted", source: "parent" }],
      nanny_positions: [{ id: "pos1", status: "active" }],
      parents: [{ id: "p1", user_id: "parent-u" }],
    });
    await adminVerifyWWCC("v1");
    expect(h.db.tables.connection_requests[0].connection_stage).toBe(10);
    expect(h.createInboxMessage).toHaveBeenCalledTimes(1);
    expect(h.createInboxMessage).toHaveBeenCalledWith(expect.objectContaining({ userId: "parent-u", type: "connection_accepted" }));
  });
});

describe("D2 — every action returns forbidden and writes nothing for a non-admin", () => {
  const actions: [string, () => Promise<{ success: boolean; error: string | null }>][] = [
    ["adminVerifyWWCC", () => adminVerifyWWCC("v1")],
    ["adminBarDbs", () => adminBarDbs("v1", "reason")],
    ["adminLiftDbsBar", () => adminLiftDbsBar("v1")],
    ["adminRunDbsCheck", () => adminRunDbsCheck("v1")],
  ];
  it.each(actions)("%s as a nanny", async (_n, call) => {
    seed({ wwcc_status: "barred", verification_status: 27, ocg_result_status: null });
    h.user = { id: "nanny-u" };
    const r = await call();
    expect(r).toMatchObject({ success: false, error: expect.stringMatching(/admin role required/) });
    expect(h.db.writes).toHaveLength(0);
    expect(h.checkDbsStatus).not.toHaveBeenCalled();
  });
  it.each(actions)("%s signed out", async (_n, call) => {
    seed();
    h.user = null;
    expect((await call()).success).toBe(false);
    expect(h.db.writes).toHaveLength(0);
  });
});

describe("adminBarDbs — Bar → 27 (#13, #23)", () => {
  it("D5 sets 27, level 0, suspended, runs cleanupPendingConnections and sends VER-010 + VER-011", async () => {
    seed({}, {}, {
      connection_requests: [
        { id: "c9", nanny_id: "n1", parent_id: "p1", connection_stage: 9, status: "accepted", source: "parent" },
        { id: "c4", nanny_id: "n1", parent_id: "p2", connection_stage: 4, status: "pending", source: "parent" },
      ],
      parents: [{ id: "p1", user_id: "parent-u" }],
    });
    const r = await adminBarDbs("v1", "Certificate shows barred-list entry");
    expect(r.success).toBe(true);
    expect(v()).toMatchObject({
      wwcc_status: "barred", verification_status: 27, wwcc_verified: false, wwcc_verified_by: "admin-1",
      wwcc_rejection_reason: "Certificate shows barred-list entry",
    });
    expect(v().wwcc_status_at).toBeTruthy();
    expect(nanny()).toMatchObject({ verification_level: 0, status: "suspended" });
    // cleanup ran: the held application is gone; P-9 — the held accept expires silently, no parent message
    expect(h.db.tables.connection_requests.find((c) => c.id === "c4")).toBeUndefined();
    expect(h.db.tables.connection_requests.find((c) => c.id === "c9")).toMatchObject({ connection_stage: 1, status: "expired" });
    expect(h.createInboxMessage).not.toHaveBeenCalled();
    expect(h.sendBarredEmails).toHaveBeenCalledWith("nanny-u");
    expect(logs("user_suspended")).toHaveLength(1);
  });

  it("D5 writes wwcc_verified=false in the same UPDATE when barring a level-4 nanny (amendment 10)", async () => {
    seed({ verification_status: 40, wwcc_verified: true, wwcc_verified_by: "admin-0", wwcc_verified_at: "2026-10-01T00:00:00Z" }, { verification_level: 4 });
    expect((await adminBarDbs("v1", "reason")).success).toBe(true);
    expect(v()).toMatchObject({ verification_status: 27, wwcc_verified: false });
    expect(verificationWrites()).toHaveLength(1);
  });

  it("requires a reason", async () => {
    seed();
    expect((await adminBarDbs("v1", "  ")).success).toBe(false);
    expect(h.db.writes).toHaveLength(0);
  });

  it("a failed barred email still leaves her barred and returns a warning", async () => {
    seed();
    h.sendBarredEmails.mockRejectedValueOnce(new Error("resend down"));
    const r = await adminBarDbs("v1", "reason");
    expect(r).toMatchObject({ success: true, warning: expect.stringMatching(/email/i) });
    expect(v().verification_status).toBe(27);
  });
});

describe("adminLiftDbsBar — #36", () => {
  it("D6 resets the DBS section to not_started, keeps wwcc_verified_at/_by, sets nannies.status active and leaves level 2", async () => {
    seed({
      wwcc_status: "barred", verification_status: 27, wwcc_verified: false, wwcc_verified_by: "admin-0",
      wwcc_verified_at: "2026-10-01T00:00:00Z", wwcc_rejection_reason: "r", cross_check_status: "passed",
    }, { verification_level: 0, status: "suspended" });
    const r = await adminLiftDbsBar("v1");
    expect(r).toEqual({ success: true, error: null });
    expect(v()).toMatchObject({
      wwcc_status: "not_started", wwcc_doc_verified: false, wwcc_verified: false, wwcc_user_guidance: null,
      wwcc_rejection_reason: null, cross_check_status: "not_started", cross_check_reasoning: null, cross_check_issues: null,
      verification_status: 20, wwcc_verified_by: "admin-0", wwcc_verified_at: "2026-10-01T00:00:00Z",
      ocg_result_status: "BLANK_NO_NEW_INFO",
    });
    expect(nanny()).toMatchObject({ verification_level: 2, status: "active" });
    expect(logs("user_reinstated")).toHaveLength(1);
  });

  it("refuses when she is not barred", async () => {
    seed();
    expect((await adminLiftDbsBar("v1")).success).toBe(false);
    expect(h.db.writes).toHaveLength(0);
  });
});

describe("adminRunDbsCheck — Run DBS check now (#30, P-8, #33)", () => {
  it("D7 writes only the ocg_* block and one dbs_status_check row when the cross-check is not pending", async () => {
    seed({ ocg_result_status: null, ocg_result_text: null, ocg_verified_at: null, verification_status: 21, cross_check_status: "review" });
    const r = await adminRunDbsCheck("v1");
    expect(r).toMatchObject({ success: true, result: "BLANK" });
    expect(verificationWrites()).toHaveLength(1);
    expect(Object.keys(verificationWrites()[0].payload).sort()).toEqual(["ocg_result_status", "ocg_result_text", "ocg_verified_at"]);
    expect(v()).toMatchObject({ ocg_result_status: "BLANK_NO_NEW_INFO", verification_status: 21 });
    expect(logs("dbs_status_check")).toHaveLength(1);
    expect(logs("dbs_status_check")[0].action_details).toEqual({ trigger: "admin", result: "BLANK" });
    expect(h.checkDbsStatus).toHaveBeenCalledWith({ certificateNumber: "001234567890", surname: "Taylor", dateOfBirth: "1990-03-05" });
  });

  it("D7b runs the full cross-check phase when the nanny is in the API-down state", async () => {
    seed({ cross_check_status: "pending", verification_status: 20, ocg_result_status: null });
    const r = await adminRunDbsCheck("v1");
    expect(r.success).toBe(true);
    expect(h.runCrossCheckPhase).toHaveBeenCalledWith("v1", "admin");
    expect(h.checkDbsStatus).not.toHaveBeenCalled();
  });

  it("D7c writes nothing on ERROR and returns the reason", async () => {
    seed({ verification_status: 21, cross_check_status: "review" });
    h.dbs = { result: "ERROR", reason: "timeout" } as DbsCheckResult;
    const r = await adminRunDbsCheck("v1");
    h.dbs = { result: "BLANK", status: "BLANK_NO_NEW_INFO", raw: "<xml/>", forename: "SOPHIE", surname: "TAYLOR", printDate: "2024-01-10" } as DbsCheckResult;
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/timeout/);
    expect(verificationWrites()).toHaveLength(0);
    expect(logs("dbs_status_check")[0].action_details).toEqual({ trigger: "admin", result: "ERROR", reason: "timeout" });
  });

  it.each(["extracted_wwcc_number", "extracted_wwcc_surname", "extracted_wwcc_dob"])("D7d refuses when %s is missing", async (col) => {
    seed({ [col]: null });
    const r = await adminRunDbsCheck("v1");
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/certificate number, surname and date of birth/);
    expect(h.checkDbsStatus).not.toHaveBeenCalled();
    expect(h.db.writes).toHaveLength(0);
  });

  it.each([
    ["NEW_INFO", 23, "expired"],
    ["NO_MATCH", 26, "ocg_not_found"],
  ] as const)("D7e (P-8) on a status-40 row a %s result = a failed re-check: %i, wwcc_verified=false, level 2, one UPDATE", async (kind, code, wwcc) => {
    seed({ verification_status: 40, wwcc_verified: true, wwcc_verified_by: "admin-0", wwcc_verified_at: "2026-10-01T00:00:00Z" }, { verification_level: 4 });
    h.dbs = { result: kind, status: kind === "NEW_INFO" ? "NEW_INFO" : "NO_MATCH_FOUND", raw: "<x/>", forename: null, surname: null, printDate: null } as unknown as DbsCheckResult;
    const r = await adminRunDbsCheck("v1");
    h.dbs = { result: "BLANK", status: "BLANK_NO_NEW_INFO", raw: "<xml/>", forename: "SOPHIE", surname: "TAYLOR", printDate: "2024-01-10" } as DbsCheckResult;
    expect(r).toMatchObject({ success: true, result: kind });
    expect(verificationWrites()).toHaveLength(1);
    expect(v()).toMatchObject({
      verification_status: code, wwcc_status: wwcc, wwcc_verified: false, cross_check_status: "not_started",
      identity_status: "verified", identity_verified: true, wwcc_verified_by: "admin-0", wwcc_verified_at: "2026-10-01T00:00:00Z",
    });
    expect(nanny()).toMatchObject({ verification_level: 2 });
    expect(logs("dbs_status_check")).toHaveLength(1);
  });

  it("on a status-40 row a pass refreshes the ocg_* block and leaves her at 40", async () => {
    seed({ verification_status: 40, wwcc_verified: true, wwcc_verified_by: "admin-0", wwcc_verified_at: "2026-10-01T00:00:00Z" }, { verification_level: 4 });
    expect((await adminRunDbsCheck("v1")).success).toBe(true);
    expect(v().verification_status).toBe(40);
  });

  it("refuses on a barred row (list D has only Lift bar)", async () => {
    seed({ wwcc_status: "barred", verification_status: 27 });
    expect((await adminRunDbsCheck("v1")).success).toBe(false);
    expect(h.checkDbsStatus).not.toHaveBeenCalled();
  });
});
