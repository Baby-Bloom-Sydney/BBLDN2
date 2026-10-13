/**
 * Unit 3c (BB-LDN-3c-061026) — the one table of API meanings: AR1, P1, P2, P3, M17, M18 + the ERROR row of M12
 * (brief change 6 table + change 7; README P-7; 00-RULINGS #30). Writes go to an in-memory store that enforces
 * the London CHECKs, so a write that Postgres would refuse fails here too.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryDb, type MemoryDb } from "../../../tests/fakes/memory-supabase";
import { applyDbsResult, type DbsApplyContext } from "./map-dbs-outcome";
import type { DbsCheckResult } from "./update-service";
import { GUIDANCE_MESSAGES } from "@/lib/verification";

const RAW = "<statusCheckResult>…</statusCheckResult>";
const ok = (result: "BLANK" | "NON_BLANK" | "NEW_INFO" | "NO_MATCH", over: Partial<DbsCheckResult> = {}): DbsCheckResult =>
  ({
    result,
    status: { BLANK: "BLANK_NO_NEW_INFO", NON_BLANK: "NON_BLANK_NO_NEW_INFO", NEW_INFO: "NEW_INFO", NO_MATCH: "NO_MATCH_FOUND" }[result],
    forename: result === "NO_MATCH" ? null : "JANE",
    surname: result === "NO_MATCH" ? null : "DOE",
    printDate: result === "NO_MATCH" ? null : "2024-03-14",
    raw: RAW,
    ...over,
  }) as DbsCheckResult;
const ERR: DbsCheckResult = { result: "ERROR", reason: "http_500" };

const CTX: DbsApplyContext = {
  identityStatus: "verified",
  certificateIssueDate: "2024-03-14",
  certificateSurname: "Doe",
  certificateForenames: "Jane",
};

let db: MemoryDb;
const row = () => db.tables.verifications[0];
const updates = () => db.writes.filter((w) => w.table === "verifications" && w.op === "update");

beforeEach(() => {
  db = createMemoryDb({
    verifications: [
      {
        id: "v1",
        user_id: "u1",
        identity_status: "verified",
        identity_verified: true,
        wwcc_status: "doc_verified",
        wwcc_verified: false,
        cross_check_status: "processing",
        verification_status: 20,
        wwcc_number: "200000000001",
        ocg_result_status: null,
      },
    ],
  });
});

const apply = (r: DbsCheckResult, mode: "first" | "admin_result_only" | "recheck" = "first", ctx = CTX) =>
  applyDbsResult(db.client() as never, "v1", "u1", ctx, r, { mode });

describe("applyDbsResult — first check", () => {
  it.each(["BLANK", "NON_BLANK"] as const)("P1 writes cross_check passed only after %s — status 30, raw result stored", async (kind) => {
    expect(await apply(ok(kind))).toEqual({ outcome: "passed" });
    expect(row()).toMatchObject({
      cross_check_status: "passed",
      verification_status: 30,
      ocg_result_status: kind === "BLANK" ? "BLANK_NO_NEW_INFO" : "NON_BLANK_NO_NEW_INFO",
      ocg_result_text: RAW,
    });
    expect(String(row().cross_check_reasoning)).toContain("Update Service");
    expect(row().ocg_verified_at).toBeTruthy();
    expect(updates()).toHaveLength(1);
  });

  it.each([
    ["NEW_INFO", "expired", 23, GUIDANCE_MESSAGES.DBS_NEW_INFO],
    ["NO_MATCH", "ocg_not_found", 26, GUIDANCE_MESSAGES.DBS_NO_MATCH],
  ] as const)(
    "P2 writes cross_check not_started (never passed), wwcc_status_at and the status in one update on %s",
    async (kind, wwcc, code, guidance) => {
      await apply(ok(kind));
      expect(updates()).toHaveLength(1);
      const u = updates()[0].payload;
      expect(u).toMatchObject({
        wwcc_status: wwcc,
        cross_check_status: "not_started",
        verification_status: code,
        wwcc_user_guidance: guidance,
        ocg_result_status: kind === "NEW_INFO" ? "NEW_INFO" : "NO_MATCH_FOUND",
        ocg_result_text: RAW,
      });
      expect(u.wwcc_status_at).toBeTruthy();
      expect(u.ocg_verified_at).toBeTruthy();
      expect(u).not.toHaveProperty("wwcc_verified");
    },
  );

  it("P3 sends api_mismatch to 21 when printDate differs from the certificate issue date", async () => {
    expect(await apply(ok("BLANK", { printDate: "2023-01-01" } as Partial<DbsCheckResult>))).toEqual({ outcome: "api_mismatch" });
    expect(row()).toMatchObject({ cross_check_status: "review", verification_status: 21, ocg_result_status: "BLANK_NO_NEW_INFO" });
    expect(row().cross_check_issues).toContain("api_mismatch");
  });

  it("P3b sends api_mismatch to 21 when the API surname or forename differs from the certificate", async () => {
    await apply(ok("NON_BLANK", { surname: "ROE" } as Partial<DbsCheckResult>));
    expect(row()).toMatchObject({ cross_check_status: "review", verification_status: 21 });
    beforeEachReset();
    await apply(ok("BLANK", { forename: "MARY" } as Partial<DbsCheckResult>));
    expect(row()).toMatchObject({ cross_check_status: "review", verification_status: 21 });
  });

  it("P3c treats a missing certificate issue date as a mismatch (fail closed)", async () => {
    await apply(ok("BLANK"), "first", { ...CTX, certificateIssueDate: null });
    expect(row()).toMatchObject({ cross_check_status: "review", verification_status: 21 });
  });

  it("M12 (write) leaves cross_check pending, writes TECHNICAL_RETRY and no ocg_* block when the API errors", async () => {
    expect(await apply(ERR)).toEqual({ outcome: "api_error" });
    const u = updates()[0].payload;
    expect(u).toMatchObject({ cross_check_status: "pending", wwcc_user_guidance: GUIDANCE_MESSAGES.TECHNICAL_RETRY, verification_status: 20 });
    expect(u.cross_check_at).toBeTruthy();
    expect(Object.keys(u).some((k) => k.startsWith("ocg_"))).toBe(false);
    expect(row().ocg_result_status).toBeNull();
  });

  it("M17 never writes wwcc_verified for any API result", async () => {
    for (const r of [ok("BLANK"), ok("NON_BLANK"), ok("NEW_INFO"), ok("NO_MATCH"), ERR]) {
      beforeEachReset();
      await apply(r);
      for (const w of updates()) expect(w.payload).not.toHaveProperty("wwcc_verified");
    }
  });

  it("M18 stores the raw XML in ocg_result_text and the result in ocg_result_status for every API outcome except ERROR", async () => {
    for (const r of [ok("BLANK"), ok("NON_BLANK"), ok("NEW_INFO"), ok("NO_MATCH")]) {
      beforeEachReset();
      await apply(r);
      expect(row().ocg_result_text).toBe(RAW);
      expect(row().ocg_result_status).toBe((r as { status: string }).status);
    }
  });

  it("does not overwrite a row whose cross-check left processing meanwhile (manual review raced it)", async () => {
    row().cross_check_status = "not_started";
    row().wwcc_status = "review";
    expect(await apply(ok("BLANK"))).toEqual({ outcome: "superseded" });
    expect(row()).toMatchObject({ cross_check_status: "not_started", wwcc_status: "review", ocg_result_status: null });
  });

  it("throws when the database refuses the write, so the caller can fail closed", async () => {
    await expect(apply(ok("BLANK", { status: "SOMETHING" } as Partial<DbsCheckResult>))).rejects.toThrow(/check constraint/);
  });
});

describe("applyDbsResult — admin_result_only + recheck", () => {
  it("AR1 admin_result_only writes only ocg_result_status, ocg_result_text and ocg_verified_at for every API result, and nothing on ERROR", async () => {
    for (const r of [ok("BLANK"), ok("NON_BLANK"), ok("NEW_INFO"), ok("NO_MATCH")]) {
      beforeEachReset();
      expect(await apply(r, "admin_result_only")).toEqual({ outcome: "result_recorded" });
      expect(updates()).toHaveLength(1);
      expect(Object.keys(updates()[0].payload).sort()).toEqual(["ocg_result_status", "ocg_result_text", "ocg_verified_at"]);
    }
    beforeEachReset();
    expect(await apply(ERR, "admin_result_only")).toEqual({ outcome: "no_write" });
    expect(updates()).toHaveLength(0);
  });

  it("AR2 admin_result_only throws when the database refuses the write", async () => {
    await expect(apply(ok("BLANK", { status: "SOMETHING" } as Partial<DbsCheckResult>), "admin_result_only")).rejects.toThrow(/check constraint/);
  });

  // Unit 3d (BB-LDN-3d-061026, README P-8): the recheck rows are written here so "Run DBS check now" on a level-4
  // nanny and 3i's daily re-check share one meaning. 3i keeps the cron, the connection drop (P-3) and the emails.
  function levelFour() {
    Object.assign(row(), {
      verification_status: 40, wwcc_status: "doc_verified", wwcc_verified: true, wwcc_verified_by: "admin-0",
      wwcc_verified_at: "2026-10-01T00:00:00Z", cross_check_status: "passed",
      ocg_result_status: "BLANK_NO_NEW_INFO", ocg_result_text: "<old/>", ocg_verified_at: "2026-10-01T00:00:00Z",
    });
    db.writes.length = 0;
  }

  it.each([
    ["NEW_INFO", 23, "expired", "new_info", GUIDANCE_MESSAGES.DBS_NEW_INFO],
    ["NO_MATCH", 26, "ocg_not_found", "no_match", GUIDANCE_MESSAGES.DBS_NO_MATCH],
  ] as const)("RC1 recheck %s on a level-4 row → %i in ONE update with wwcc_verified=false (40 CHECK, P-7, #28)", async (kind, code, wwcc, outcome, guidance) => {
    levelFour();
    expect(await apply(ok(kind), "recheck")).toEqual({ outcome });
    expect(updates()).toHaveLength(1);
    expect(row()).toMatchObject({
      verification_status: code, wwcc_status: wwcc, wwcc_verified: false, cross_check_status: "not_started",
      wwcc_user_guidance: guidance, ocg_result_text: RAW,
      wwcc_verified_by: "admin-0", wwcc_verified_at: "2026-10-01T00:00:00Z", identity_status: "verified",
    });
    expect(row().ocg_verified_at).not.toBe("2026-10-01T00:00:00Z");
    expect(row().wwcc_status_at).toBeTruthy();
  });

  it.each([["BLANK"], ["NON_BLANK"]] as const)("RC2 recheck %s writes nothing (#12 — a pass changes nothing)", async (kind) => {
    levelFour();
    expect(await apply(ok(kind), "recheck")).toEqual({ outcome: "no_write" });
    expect(updates()).toHaveLength(0);
  });

  it("RC3 recheck ERROR writes nothing (#32)", async () => {
    levelFour();
    expect(await apply(ERR, "recheck")).toEqual({ outcome: "no_write" });
    expect(updates()).toHaveLength(0);
  });

  it("RC4 recheck on a row no longer approved writes nothing (superseded)", async () => {
    levelFour();
    Object.assign(row(), { verification_status: 22, wwcc_status: "rejected", wwcc_verified: false });
    expect(await apply(ok("NEW_INFO"), "recheck")).toEqual({ outcome: "superseded" });
    // the fake logs a guarded UPDATE that matched no row; what matters is that the row is untouched
    expect(row()).toMatchObject({ verification_status: 22, wwcc_status: "rejected", ocg_result_text: "<old/>" });
  });
});

function beforeEachReset() {
  const r = row();
  Object.assign(r, { cross_check_status: "processing", wwcc_status: "doc_verified", verification_status: 20, ocg_result_status: null, ocg_result_text: null });
  db.writes.length = 0;
}
