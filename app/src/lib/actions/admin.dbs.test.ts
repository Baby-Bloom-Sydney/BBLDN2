/**
 * Unit 3d (BB-LDN-3d-061026) — the DBS parts of `lib/actions/admin.ts`: Reject → 22 (D4, P-4 email D4b/D4c),
 * Ask for page 2 through `adminSendEmail` (D8, #27), `adminConfirmWWCC` gone, and R-A1 (identity approve/reject
 * unchanged after `requireAdmin` moved to `lib/admin/require-admin.ts`).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMemoryDb, type MemoryDb } from "../../../tests/fakes/memory-supabase";

const h = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  user: { id: "admin-1" } as { id: string } | null,
  sendDbsRejectedEmail: vi.fn(async () => {}),
  sendEmail: vi.fn(async () => ({ success: true, error: null as string | null })),
  revalidatePath: vi.fn(),
  runCrossCheckPhase: vi.fn(async () => {}),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    ...(h.db.client() as object),
    auth: { getUser: async () => ({ data: { user: h.user }, error: h.user ? null : { message: "no" } }) },
  }),
}));
vi.mock("next/cache", () => ({ revalidatePath: h.revalidatePath }));
vi.mock("@/lib/email/dbs-emails", () => ({ sendDbsRejectedEmail: h.sendDbsRejectedEmail, sendBarredEmails: vi.fn() }));
vi.mock("@/lib/email/resend", () => ({ sendEmail: h.sendEmail }));
vi.mock("@/lib/email/helpers", () => ({ getUserEmailInfo: vi.fn(async () => null) }));
vi.mock("@/lib/ai/verification-pipeline", () => ({ runCrossCheckPhase: h.runCrossCheckPhase, runWWCCDocPhase: vi.fn(), triggerCrossCheck: vi.fn() }));
vi.mock("@/lib/ai/client", () => ({ openai: {} }));
vi.mock("./connection-helpers", () => ({ createInboxMessage: vi.fn() }));

import * as adminActions from "./admin";
import { adminRejectWWCC, adminSendEmail, adminVerifyIdentity, adminRejectIdentity } from "./admin";
import { ADMIN_FROM_ADDRESSES } from "@/lib/constants";

function seed(over: Record<string, unknown> = {}) {
  h.db = createMemoryDb({
    user_roles: [{ user_id: "admin-1", role: "admin" }, { user_id: "nanny-u", role: "nanny" }],
    verifications: [
      {
        id: "v1", user_id: "nanny-u", updated_at: "2026-10-06T00:00:00Z",
        identity_status: "verified", identity_verified: true,
        wwcc_status: "doc_verified", wwcc_verified: false, wwcc_doc_verified: true, cross_check_status: "passed",
        cross_check_reasoning: "ok", verification_status: 30, ocg_result_status: "BLANK_NO_NEW_INFO",
        ...over,
      },
    ],
    nannies: [{ id: "n1", user_id: "nanny-u", verification_level: 3, status: "active" }],
    activity_logs: [],
  });
}
const v = () => h.db.tables.verifications[0];
const logs = (t: string) => h.db.tables.activity_logs.filter((r) => r.action_type === t);
const REASON = "Your DBS certificate image is unclear or unreadable";

beforeEach(() => {
  vi.clearAllMocks();
  h.user = { id: "admin-1" };
  h.sendEmail.mockResolvedValue({ success: true, error: null });
});

describe("adminRejectWWCC — Reject → 22 (#11, #26)", () => {
  it("D4 sets 22, stamps wwcc_verified_by and wwcc_status_at, writes guidance and an activity row", async () => {
    seed();
    const r = await adminRejectWWCC("v1", `  ${REASON} `);
    expect(r).toMatchObject({ success: true, error: null });
    expect(v()).toMatchObject({
      verification_status: 22, wwcc_status: "rejected", wwcc_verified: false, wwcc_doc_verified: false,
      wwcc_verified_by: "admin-1", wwcc_rejection_reason: REASON, cross_check_status: "not_started", cross_check_reasoning: null,
    });
    expect(v().wwcc_status_at).toBeTruthy();
    expect(v().wwcc_user_guidance).toMatchObject({ title: expect.any(String), explanation: REASON, steps_to_fix: [expect.any(String)] });
    expect(h.db.tables.nannies[0].verification_level).toBe(2);
    expect(logs("verification_rejected")).toHaveLength(1);
    expect(logs("verification_rejected")[0].action_details).toMatchObject({ admin_id: "admin-1", decision: "reject", reason: REASON });
  });

  it("D4b (P-4) sends sendDbsRejectedEmail once with the reason after a successful write", async () => {
    seed();
    await adminRejectWWCC("v1", REASON);
    expect(h.sendDbsRejectedEmail).toHaveBeenCalledTimes(1);
    expect(h.sendDbsRejectedEmail).toHaveBeenCalledWith("nanny-u", REASON);
  });

  it("D4b sends nothing when the write is refused", async () => {
    seed({ wwcc_status: "barred", verification_status: 27 });
    const r = await adminRejectWWCC("v1", REASON);
    expect(r.success).toBe(false);
    expect(h.sendDbsRejectedEmail).not.toHaveBeenCalled();
    expect(h.db.writes).toHaveLength(0);
  });

  it("D4c a failed reject-email send still leaves the row at 22 and returns a warning", async () => {
    seed();
    h.sendDbsRejectedEmail.mockRejectedValueOnce(new Error("resend down"));
    const r = await adminRejectWWCC("v1", REASON);
    expect(r).toMatchObject({ success: true, warning: expect.stringMatching(/email/i) });
    expect(v().verification_status).toBe(22);
  });

  it("requires a reason and an admin", async () => {
    seed();
    expect((await adminRejectWWCC("v1", " ")).success).toBe(false);
    h.user = { id: "nanny-u" };
    expect((await adminRejectWWCC("v1", REASON)).success).toBe(false);
    expect(h.db.writes).toHaveLength(0);
  });
});

describe("D8 — Ask for page 2 (#27)", () => {
  const base = { toEmail: "admin+3d@babybloomsydney.com.au", toUserId: "nanny-u", fromAddress: ADMIN_FROM_ADDRESSES[0], subject: "Your DBS certificate — page 2", body: "Please reply with a photo of page 2." };

  it("sends one email via adminSendEmail, writes one dbs_page2_requested row and changes no status", async () => {
    seed();
    const r = await adminSendEmail({ ...base, logActionType: "dbs_page2_requested" });
    expect(r).toEqual({ success: true, error: null });
    expect(h.sendEmail).toHaveBeenCalledTimes(1);
    expect(logs("dbs_page2_requested")).toHaveLength(1);
    expect(logs("dbs_page2_requested")[0]).toMatchObject({ user_id: "nanny-u", action_details: { admin_id: "admin-1" } });
    expect(h.db.writes.filter((w) => w.table === "verifications")).toHaveLength(0);
    expect(v().verification_status).toBe(30);
  });

  it("writes no log row when the send fails, or when no logActionType is passed", async () => {
    seed();
    h.sendEmail.mockResolvedValueOnce({ success: false, error: "x" });
    await adminSendEmail({ ...base, logActionType: "dbs_page2_requested" });
    await adminSendEmail(base);
    expect(h.db.tables.activity_logs).toHaveLength(0);
  });

  it("refuses an unknown logActionType (fail closed)", async () => {
    seed();
    const r = await adminSendEmail({ ...base, logActionType: "verification_approved" as unknown as "dbs_page2_requested" });
    expect(r.success).toBe(false);
    expect(h.sendEmail).not.toHaveBeenCalled();
  });
});

describe("removed / moved", () => {
  it("adminConfirmWWCC (the OCG Confirm stamp) is gone", () => {
    expect("adminConfirmWWCC" in adminActions).toBe(false);
  });

  it("R-A1 adminVerifyIdentity still verifies identity for an admin and refuses a non-admin", async () => {
    seed({ identity_status: "review", identity_verified: false, verification_status: 11, wwcc_status: "not_started", cross_check_status: "not_started", ocg_result_status: null });
    h.user = { id: "nanny-u" };
    expect((await adminVerifyIdentity("v1")).success).toBe(false);
    h.user = { id: "admin-1" };
    expect((await adminVerifyIdentity("v1")).success).toBe(true);
    expect(v()).toMatchObject({ identity_status: "verified", identity_verified: true });
  });

  it("R-A1 adminRejectIdentity still rejects identity for an admin", async () => {
    seed({ identity_status: "review", identity_verified: false, verification_status: 11, wwcc_status: "not_started", cross_check_status: "not_started", ocg_result_status: null });
    expect((await adminRejectIdentity("v1", "Your passport image is unclear or unreadable")).success).toBe(true);
    expect(v().verification_status).toBe(12);
  });
});
