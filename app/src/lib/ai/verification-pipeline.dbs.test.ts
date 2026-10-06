/**
 * Unit 3c (BB-LDN-3c-061026) — pipeline phases 2 + 3 with `verifyDBS` and the adapter mocked, the real mapper and
 * the real (unchanged) sync over an in-memory store. Covers G1, M1–M12, C5–C7, C9, P4–P6, the phase-2 column
 * writes (brief change 5) and the one `dbs_status_check` log row per call (#33).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMemoryDb, type MemoryDb } from "../../../tests/fakes/memory-supabase";

const h = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  verifyDBS: vi.fn(),
  verifyPassport: vi.fn(),
  checkDbsStatus: vi.fn(),
  sendEmail: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./verify-dbs", () => ({ verifyDBS: h.verifyDBS }));
vi.mock("./verify-passport", () => ({ verifyPassport: h.verifyPassport }));
vi.mock("@/lib/dbs/update-service", async (orig) => ({
  ...(await orig<typeof import("@/lib/dbs/update-service")>()),
  checkDbsStatus: h.checkDbsStatus,
}));
vi.mock("@/lib/email/resend", () => ({ sendEmail: h.sendEmail }));
vi.mock("@/lib/email/helpers", () => ({
  getUserEmailInfo: vi.fn(async () => ({ email: "admin+3c@babybloomsydney.com.au", firstName: "Jane", lastName: "Doe", userId: "u1" })),
}));

import { runWWCCDocPhase, runCrossCheckPhase, runIdentityPhase, triggerCrossCheck } from "./verification-pipeline";
import { DBS_REASON_GUIDANCE } from "@/lib/dbs/reason-guidance";
import { GUIDANCE_MESSAGES, deriveOverallStatus } from "@/lib/verification";

const EXTRACTED = {
  level: "enhanced", page: 1, certificate_number: "200000000001", issue_date: "2024-03-14", surname: "DOE", forenames: "JANE MARY",
  other_names: null, date_of_birth: "1990-03-05", position_applied_for: "Child Workforce / Nanny", workforce: "child",
  employer_name: "Specimen Nursery Ltd", registered_body: "Specimen Umbrella", countersignatory: "A SPECIMEN", police_records: "none_recorded",
  s142_list: "none_recorded", childrens_barred_list: "none_recorded", adults_barred_list: "not_requested", other_police_info: "none_recorded",
  statutory_statement_section: "113B", has_disclosed_content: false,
};
const aiPass = (over: Record<string, unknown> = {}) => ({
  outcome: "pass", reason_code: null, confidence: "high", extracted: { ...EXTRACTED, ...over }, tamper_flags: [],
  reasoning: "ok", issues: ["refs:none"], user_guidance: null,
});
const api = (result: string, status: string) => ({ result, status, forename: "JANE", surname: "DOE", printDate: "2024-03-14", raw: `<x>${status}</x>` });

function seed(over: Record<string, unknown> = {}) {
  h.db = createMemoryDb({
    verifications: [
      {
        id: "v1", user_id: "u1", updated_at: "2026-10-06T00:00:00Z",
        identity_status: "verified", identity_verified: true, extracted_surname: "Doe", extracted_dob: "1990-03-05",
        wwcc_status: "pending", wwcc_verified: false, wwcc_verification_method: "dbs_certificate",
        wwcc_service_nsw_screenshot_url: "u1/1728000000000-page1-pass.pdf", cross_check_status: "not_started",
        verification_status: 29, ocg_result_status: null,
        ...over,
      },
    ],
    nannies: [{ id: "n1", user_id: "u1", verification_level: 2, status: "active" }],
  });
}
const v = () => h.db.tables.verifications[0];
const level = () => h.db.tables.nannies[0].verification_level;
const logs = () => (h.db.tables.activity_logs ?? []).filter((l) => l.action_type === "dbs_status_check");
const verifiedEmails = () => h.sendEmail.mock.calls.filter((c) => (c as unknown as [{ emailType: string }])[0].emailType === "verification_approved");

beforeEach(() => {
  vi.clearAllMocks();
  seed();
  h.verifyDBS.mockResolvedValue(aiPass());
  h.checkDbsStatus.mockResolvedValue(api("BLANK", "BLANK_NO_NEW_INFO"));
});

describe("phase 2 — verify-dbs writes", () => {
  it("writes the extraction into the existing columns, issue date into the expiry columns and the clearance JSON", async () => {
    await runWWCCDocPhase("v1");
    expect(h.verifyDBS).toHaveBeenCalledWith("https://storage.test/signed/u1/1728000000000-page1-pass.pdf", {
      isPdf: true, passportSurname: "Doe", passportDob: "1990-03-05", documentPath: "u1/1728000000000-page1-pass.pdf",
    });
    expect(v()).toMatchObject({
      extracted_wwcc_surname: "Doe", extracted_wwcc_first_name: "Jane Mary", extracted_wwcc_number: "200000000001", wwcc_number: "200000000001",
      extracted_wwcc_dob: "1990-03-05", extracted_wwcc_expiry: "2024-03-14", wwcc_expiry_date: "2024-03-14", wwcc_ai_reasoning: "ok",
    });
    expect(JSON.parse(String(v().extracted_wwcc_clearance_type))).toMatchObject({ level: "enhanced", workforce: "child", statutory_statement_section: "113B" });
  });

  it("P5 writes confidence:high into wwcc_ai_issues on a pass (#31)", async () => {
    await runWWCCDocPhase("v1");
    expect(JSON.parse(String(v().wwcc_ai_issues))).toEqual(["refs:none", "confidence:high"]);
  });

  it("P6 stores reason_code and confidence inside wwcc_user_guidance on a fail (#24) → 24", async () => {
    h.verifyDBS.mockResolvedValue({
      ...aiPass({ level: "standard" }), outcome: "fail", reason_code: "not_enhanced", tamper_flags: [],
      user_guidance: { ...DBS_REASON_GUIDANCE.not_enhanced, reason_code: "not_enhanced", confidence: "high" },
    });
    await runWWCCDocPhase("v1");
    expect(v()).toMatchObject({ wwcc_status: "failed", verification_status: 24 });
    expect(v().wwcc_user_guidance).toMatchObject({ reason_code: "not_enhanced", confidence: "high", title: DBS_REASON_GUIDANCE.not_enhanced.title });
    expect(h.checkDbsStatus).not.toHaveBeenCalled();
  });

  it("keeps tamper flags in wwcc_ai_issues on an altered_document fail", async () => {
    h.verifyDBS.mockResolvedValue({ ...aiPass(), outcome: "fail", reason_code: "altered_document", tamper_flags: ["font_mismatch"], user_guidance: { title: "t", explanation: "e", steps_to_fix: [], reason_code: "altered_document" } });
    await runWWCCDocPhase("v1");
    expect(JSON.parse(String(v().wwcc_ai_issues))).toEqual(["refs:none", "font_mismatch"]);
  });

  it("does not write wwcc_number when the number read is not 12 digits (CHECK), keeps the raw read", async () => {
    h.verifyDBS.mockResolvedValue({ ...aiPass({ certificate_number: "12345" }), outcome: "fail", reason_code: "unreadable", user_guidance: { title: "t", explanation: "e", steps_to_fix: [], reason_code: "unreadable" } });
    await runWWCCDocPhase("v1");
    expect(v()).toMatchObject({ extracted_wwcc_number: "12345", wwcc_status: "failed" });
    expect(v().wwcc_number).toBeUndefined();
  });

  it("M5 review → wwcc review, 21, guidance carries reason_code + confidence, no API call", async () => {
    h.verifyDBS.mockResolvedValue({ ...aiPass({ workforce: "unknown" }), outcome: "review", reason_code: null, confidence: "low", user_guidance: null });
    await runWWCCDocPhase("v1");
    expect(v()).toMatchObject({ wwcc_status: "review", verification_status: 21 });
    expect(v().wwcc_user_guidance).toMatchObject({ confidence: "low" });
    expect(level()).toBe(2);
    expect(h.checkDbsStatus).not.toHaveBeenCalled();
  });

  it("M11 — AI transport errors twice → back to pending with TECHNICAL_RETRY (2 attempts)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    h.verifyDBS.mockRejectedValue(new Error("ECONNRESET"));
    const p = runWWCCDocPhase("v1");
    await vi.runAllTimersAsync();
    await p;
    vi.useRealTimers();
    expect(h.verifyDBS).toHaveBeenCalledTimes(2);
    expect(v()).toMatchObject({ wwcc_status: "pending", wwcc_user_guidance: GUIDANCE_MESSAGES.TECHNICAL_RETRY, verification_status: 29 });
  });

  it("skips when the row is not pending (atomic claim)", async () => {
    seed({ wwcc_status: "processing" });
    await runWWCCDocPhase("v1");
    expect(h.verifyDBS).not.toHaveBeenCalled();
  });
});

describe("phase 3 — cross-check + Update Service (status / level table)", () => {
  it.each([
    ["M7/I1", "BLANK", "BLANK_NO_NEW_INFO", "doc_verified", "passed", 30, 3],
    ["M8/I2", "NON_BLANK", "NON_BLANK_NO_NEW_INFO", "doc_verified", "passed", 30, 3],
    ["M9", "NEW_INFO", "NEW_INFO", "expired", "not_started", 23, 2],
    ["M10", "NO_MATCH", "NO_MATCH_FOUND", "ocg_not_found", "not_started", 26, 2],
  ])("%s returns the right status and level when the API answers %s", async (_id, result, status, wwcc, cross, code, lvl) => {
    h.checkDbsStatus.mockResolvedValue(api(result, status));
    await runWWCCDocPhase("v1");
    expect(v()).toMatchObject({ wwcc_status: wwcc, cross_check_status: cross, verification_status: code, ocg_result_status: status });
    expect(level()).toBe(lvl);
    expect(logs()).toHaveLength(1);
    expect(logs()[0].action_details).toEqual({ trigger: "first", result });
  });

  it("calls the adapter with the certificate number, the certificate surname and the certificate DOB", async () => {
    await runWWCCDocPhase("v1");
    expect(h.checkDbsStatus).toHaveBeenCalledWith({ certificateNumber: "200000000001", surname: "Doe", dateOfBirth: "1990-03-05" });
  });

  it("M12 leaves cross_check pending, writes TECHNICAL_RETRY, writes no ocg_* block, logs one dbs_status_check row and stays level 2 when the API errors twice", async () => {
    h.checkDbsStatus.mockResolvedValue({ result: "ERROR", reason: "http_500" });
    await runWWCCDocPhase("v1");
    expect(v()).toMatchObject({ cross_check_status: "pending", wwcc_user_guidance: GUIDANCE_MESSAGES.TECHNICAL_RETRY, verification_status: 20, ocg_result_status: null });
    expect(v().ocg_result_text).toBeUndefined();
    expect(level()).toBe(2);
    expect(logs()).toHaveLength(1);
    expect(logs()[0].action_details).toEqual({ trigger: "first", result: "ERROR", reason: "http_500" });
    expect(verifiedEmails()).toHaveLength(0);
  });

  it("fails closed to pending + TECHNICAL_RETRY when the adapter throws", async () => {
    h.checkDbsStatus.mockRejectedValue(new Error("boom"));
    await runWWCCDocPhase("v1");
    expect(v()).toMatchObject({ cross_check_status: "pending", verification_status: 20 });
    expect(level()).toBe(2);
    expect(logs()[0].action_details).toMatchObject({ result: "ERROR", reason: "exception" });
  });

  it("P4 sends VER-001 only on an API pass", async () => {
    for (const [result, status, n] of [["BLANK", "BLANK_NO_NEW_INFO", 1], ["NEW_INFO", "NEW_INFO", 0], ["NO_MATCH", "NO_MATCH_FOUND", 0]] as const) {
      vi.clearAllMocks();
      seed();
      h.verifyDBS.mockResolvedValue(aiPass());
      h.checkDbsStatus.mockResolvedValue(api(result, status));
      await runWWCCDocPhase("v1");
      expect(verifiedEmails()).toHaveLength(n);
    }
    vi.clearAllMocks();
    seed();
    h.verifyDBS.mockResolvedValue(aiPass());
    h.checkDbsStatus.mockResolvedValue({ ...api("BLANK", "BLANK_NO_NEW_INFO"), printDate: "2020-01-01" });
    await runWWCCDocPhase("v1");
    expect(v().verification_status).toBe(21);
    expect(verifiedEmails()).toHaveLength(0);
  });

  it("C5 returns review when the certificate holds a different surname (married name) — 21, no API call", async () => {
    h.verifyDBS.mockResolvedValue(aiPass({ surname: "ROE" }));
    await runWWCCDocPhase("v1");
    expect(v()).toMatchObject({ cross_check_status: "review", verification_status: 21 });
    expect(String(v().cross_check_reasoning)).toMatch(/surname/i);
    expect(h.checkDbsStatus).not.toHaveBeenCalled();
    expect(level()).toBe(2);
  });

  it("C6 returns review when DOB differs by one day", async () => {
    h.verifyDBS.mockResolvedValue(aiPass({ date_of_birth: "1990-03-06" }));
    await runWWCCDocPhase("v1");
    expect(v()).toMatchObject({ cross_check_status: "review", verification_status: 21 });
    expect(String(v().cross_check_reasoning)).toMatch(/date of birth/i);
  });

  it("C7 returns review when the certificate DOB is missing", async () => {
    h.verifyDBS.mockResolvedValue(aiPass({ date_of_birth: null }));
    await runWWCCDocPhase("v1");
    expect(v()).toMatchObject({ cross_check_status: "review", verification_status: 21 });
  });

  it("C9 does not call the Update Service when the result is review", async () => {
    h.verifyDBS.mockResolvedValue(aiPass({ surname: "Smith-Jones" }));
    seed({ extracted_surname: "Smith" });
    await runWWCCDocPhase("v1");
    expect(h.checkDbsStatus).not.toHaveBeenCalled();
    expect(logs()).toHaveLength(0);
  });

  it("C2–C4 normalised surnames still reach the API", async () => {
    seed({ extracted_surname: "O'Brien-Núñez" });
    h.verifyDBS.mockResolvedValue(aiPass({ surname: "O BRIEN NUNEZ" }));
    await runWWCCDocPhase("v1");
    expect(h.checkDbsStatus).toHaveBeenCalledTimes(1);
  });

  it("retry trigger: a pending cross-check re-runs with trigger 'retry' and logs it", async () => {
    seed({ wwcc_status: "doc_verified", cross_check_status: "pending", extracted_wwcc_surname: "Doe", extracted_wwcc_first_name: "Jane", extracted_wwcc_dob: "1990-03-05", extracted_wwcc_number: "200000000001", extracted_wwcc_expiry: "2024-03-14", verification_status: 20 });
    await runCrossCheckPhase("v1", "retry");
    expect(v()).toMatchObject({ cross_check_status: "passed", verification_status: 30 });
    expect(logs()[0].action_details).toEqual({ trigger: "retry", result: "BLANK" });
  });

  it("triggerCrossCheck does nothing until identity is verified and the certificate is doc_verified", async () => {
    seed({ identity_status: "pending", wwcc_status: "doc_verified" });
    await triggerCrossCheck("v1");
    expect(h.checkDbsStatus).not.toHaveBeenCalled();
    expect(v().cross_check_status).toBe("not_started");
  });
});

describe("status ladder rows the pipeline relies on (M1–M4, M6, M13)", () => {
  it.each([
    ["M1 pending/29", "pending", "not_started", 29],
    ["M2 processing/25", "processing", "not_started", 25],
    ["M3 failed/24", "failed", "not_started", 24],
    ["M4 doc_verified/20", "doc_verified", "not_started", 20],
    ["M6 cross-check review/21 (not 30)", "doc_verified", "review", 21],
    ["M13 manual review/21", "review", "not_started", 21],
    ["API down: doc_verified + pending/20", "doc_verified", "pending", 20],
  ] as const)("%s", (_n, wwcc, cross, code) => {
    expect(deriveOverallStatus("verified", wwcc, cross)).toBe(code);
  });
});

describe("G1 regression — identity phase unchanged", () => {
  it("G1 returns level 2 when passport + selfie pass (identity flow unchanged)", async () => {
    seed({ identity_status: "pending", identity_verified: false, wwcc_status: "not_started", passport_upload_url: "u1/p.jpg", identification_photo_url: "u1/s.jpg", surname: "Doe", given_names: "Jane", date_of_birth: "1990-03-05" });
    h.db.tables.nannies[0].verification_level = 1;
    h.db.tables.user_profiles = [{ user_id: "u1" }];
    h.verifyPassport.mockResolvedValue({
      pass: true, extracted: { surname: "DOE", given_names: "JANE", dob: "1990-03-05", nationality: "GBR", passport_number: "X", expiry: "2030-01-01" },
      reasoning: "ok", issues: [], user_guidance: null,
    });
    await runIdentityPhase("v1");
    expect(v()).toMatchObject({ identity_status: "verified", identity_verified: true, verification_status: 20 });
    expect(level()).toBe(2);
    expect(h.checkDbsStatus).not.toHaveBeenCalled();
  });
});
