// @vitest-environment node
/**
 * Unit 3c (BB-LDN-3c-061026) — integration: real pipeline + real verify-dbs + real mapper + real adapter against the
 * local fake DBS Update Service (tests/fakes/dbs-update-service.ts). Only the model client, storage and email are
 * stand-ins. I1–I8, I12 (04-test-plan §3); I9/I10 → 3d, I11 → 3i, I13 → run-verification route test, I14 → 3g.
 */
import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { createMemoryDb, type MemoryDb } from "../../../tests/fakes/memory-supabase";
import { startFakeDbsUpdateService, type FakeDbsServer } from "../../../tests/fakes/dbs-update-service";

const h = vi.hoisted(() => ({
  db: null as unknown as MemoryDb,
  create: vi.fn(),
  sendEmail: vi.fn(async () => ({ success: true })),
}));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("./client", () => ({ openai: { chat: { completions: { create: h.create } } } }));
vi.mock("@/lib/email/resend", () => ({ sendEmail: h.sendEmail }));
vi.mock("@/lib/email/helpers", () => ({
  getUserEmailInfo: vi.fn(async () => ({ email: "admin+3c@babybloomsydney.com.au", firstName: "Jane", lastName: "Doe", userId: "u1" })),
}));

import { runWWCCDocPhase } from "./verification-pipeline";
import { GUIDANCE_MESSAGES } from "@/lib/verification";
import { DBS_LINKS } from "@/lib/constants";

const extraction = (name: string) => JSON.parse(readFileSync(resolve(__dirname, "__fixtures__/dbs-extractions", `${name}.json`), "utf8"));
const withNumber = (n: string) => {
  const e = extraction("page1-pass");
  e.extracted.certificate_number = n;
  return e;
};

let fake: FakeDbsServer;

beforeAll(async () => {
  fake = await startFakeDbsUpdateService({ holdMs: 2000 });
  vi.stubEnv("DBS_UPDATE_SERVICE_BASE_URL", fake.baseUrl);
  vi.stubEnv("DBS_CHECK_ORGANISATION_NAME", "BabyBloom London");
  vi.stubEnv("DBS_CHECKER_FORENAME", "ALEX");
  vi.stubEnv("DBS_CHECKER_SURNAME", "CHECKER");
  vi.stubEnv("DBS_TIMEOUT_MS", "300");
  vi.stubEnv("DBS_RETRY_DELAY_MS", "1");
  vi.stubEnv("DBS_REFERENCE_ENHANCED_PATH", "");
  vi.stubEnv("DBS_REFERENCE_STANDARD_PATH", "");
});

afterAll(async () => {
  vi.unstubAllEnvs();
  await fake.close();
});

function seed(over: Record<string, unknown> = {}) {
  h.db = createMemoryDb({
    verifications: [
      {
        id: "v1", user_id: "u1", updated_at: "2026-10-06T00:00:00Z", identity_status: "verified", identity_verified: true,
        extracted_surname: "Doe", extracted_dob: "1990-03-05", wwcc_status: "pending", wwcc_verified: false,
        wwcc_verification_method: "dbs_certificate", wwcc_service_nsw_screenshot_url: "u1/1728000000000-page1-pass.jpg",
        cross_check_status: "not_started", verification_status: 29, ocg_result_status: null, ...over,
      },
    ],
    nannies: [{ id: "n1", user_id: "u1", verification_level: 2, status: "active" }],
  });
}
const v = () => h.db.tables.verifications[0];
const level = () => h.db.tables.nannies[0].verification_level;
const logs = () => (h.db.tables.activity_logs ?? []).filter((l) => l.action_type === "dbs_status_check");
const modelReturns = (body: unknown) => h.create.mockResolvedValue({ choices: [{ message: { content: JSON.stringify(body) } }] });

beforeEach(() => {
  vi.clearAllMocks();
  fake.requests.length = 0;
  seed();
});

describe("integration — upload → AI → cross-check → fake Update Service", () => {
  it("I1 returns level 3 / status 30 when AI pass → cross-check → fake API BLANK (number 2…)", async () => {
    modelReturns(withNumber("200000000001"));
    await runWWCCDocPhase("v1");
    expect(v()).toMatchObject({ cross_check_status: "passed", verification_status: 30, ocg_result_status: "BLANK_NO_NEW_INFO" });
    expect(String(v().ocg_result_text)).toContain("<statusCheckResult>");
    expect(level()).toBe(3);
    expect(logs()).toHaveLength(1);
  });

  it("I2 returns level 3 / status 30 with the result kept for the admin when the number starts 3 (NON_BLANK)", async () => {
    modelReturns(withNumber("300000000001"));
    await runWWCCDocPhase("v1");
    expect(v()).toMatchObject({ verification_status: 30, ocg_result_status: "NON_BLANK_NO_NEW_INFO" });
    expect(level()).toBe(3);
  });

  it("I3 returns 23 / level 2 + guidance when the number starts 4 (NEW_INFO)", async () => {
    modelReturns(withNumber("400000000001"));
    await runWWCCDocPhase("v1");
    expect(v()).toMatchObject({ wwcc_status: "expired", cross_check_status: "not_started", verification_status: 23, wwcc_user_guidance: GUIDANCE_MESSAGES.DBS_NEW_INFO });
    expect(level()).toBe(2);
  });

  it("I4 returns 26 / level 2 + no-match guidance (explainer + both links from the constant, #22) when the number starts 1", async () => {
    modelReturns(withNumber("100000000001"));
    await runWWCCDocPhase("v1");
    expect(v()).toMatchObject({ wwcc_status: "ocg_not_found", verification_status: 26 });
    const g = v().wwcc_user_guidance as { explainer: string; links: { href: string }[] };
    expect(g.explainer).toBeTruthy();
    expect(g.links.map((l) => l.href)).toEqual([DBS_LINKS.joinUpdateService, DBS_LINKS.getEnhanced]);
    expect(level()).toBe(2);
  });

  it.each(["9", "5", "6", "7", "8"])(
    "I5 retries once in the run, then leaves cross-check pending (level 2) with TECHNICAL_RETRY and one log row, when the number starts %s (#30)",
    async (digit) => {
      modelReturns(withNumber(`${digit}00000000001`));
      await runWWCCDocPhase("v1");
      expect(fake.requests).toHaveLength(2);
      expect(v()).toMatchObject({ cross_check_status: "pending", verification_status: 20, wwcc_user_guidance: GUIDANCE_MESSAGES.TECHNICAL_RETRY, ocg_result_status: null });
      expect(level()).toBe(2);
      expect(logs()).toHaveLength(1);
    },
  );

  it("I6 returns 24 + reason and never calls the fake when AI fails", async () => {
    modelReturns(extraction("standard"));
    await runWWCCDocPhase("v1");
    expect(v()).toMatchObject({ wwcc_status: "failed", verification_status: 24 });
    expect((v().wwcc_user_guidance as { reason_code: string }).reason_code).toBe("not_enhanced");
    expect(fake.requests).toHaveLength(0);
  });

  it("I7 returns 21 and never calls the fake when cross-check is review", async () => {
    seed({ extracted_surname: "Roe" });
    modelReturns(withNumber("200000000001"));
    await runWWCCDocPhase("v1");
    expect(v()).toMatchObject({ cross_check_status: "review", verification_status: 21 });
    expect(fake.requests).toHaveLength(0);
  });

  it("I8 sends the fake exactly: certificate surname, DOB DD/MM/YYYY, 12-char number, consent true, configured org + checker", async () => {
    modelReturns(withNumber("200000000001"));
    await runWWCCDocPhase("v1");
    expect(fake.requests).toEqual([
      {
        path: "/crsc/api/status/200000000001",
        query: {
          dateOfBirth: "05/03/1990", surname: "Doe", hasAgreedTermsAndConditions: "true",
          organisationName: "BabyBloom London", employeeSurname: "CHECKER", employeeForename: "ALEX",
        },
      },
    ]);
  });

  it("I12 resubmit after a 24: a second upload clears the old guidance and runs the full chain again", async () => {
    modelReturns(extraction("standard"));
    await runWWCCDocPhase("v1");
    expect(v().verification_status).toBe(24);
    // 3b's submitWWCCSection puts the section back to pending with the new file; the chain re-runs from there.
    Object.assign(v(), { wwcc_status: "pending", wwcc_service_nsw_screenshot_url: "u1/1728000000001-page1-pass.jpg" });
    modelReturns(withNumber("200000000001"));
    await runWWCCDocPhase("v1");
    expect(v()).toMatchObject({ verification_status: 30, wwcc_user_guidance: null });
    expect(level()).toBe(3);
  });
});
