/**
 * Unit 3d (BB-LDN-3d-061026) — the DBS queue split (Q1, Q2; brief change 9, #30, #35) and the stat counts (S1, S2;
 * brief change 10, spec §1.3).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  splitDbsQueues,
  whyHereChip,
  hasRecordChip,
  apiDownSince,
  fetchVerificationStats,
  type DbsQueueRow,
} from "./dbs-queues";
import { ADMIN_PENDING_CODES } from "@/lib/verification";

const base: DbsQueueRow = {
  id: "x", user_id: "u", verification_status: 30, wwcc_status: "doc_verified", wwcc_status_at: "2026-10-06T10:00:00Z",
  cross_check_status: "passed", cross_check_issues: null, wwcc_user_guidance: null, ocg_result_status: "BLANK_NO_NEW_INFO",
  ocg_verified_at: null, wwcc_verified_at: null, extracted_wwcc_clearance_type: null, history: [],
};
const r = (id: string, over: Partial<DbsQueueRow>): DbsQueueRow => ({ ...base, id, ...over });

describe("splitDbsQueues", () => {
  it("Q1 puts 30 in A with BLANK first, 21 and the API-down state in B, approved-then-23/26 in C, 27 in D", () => {
    const rows = [
      r("a-nonblank-old", { ocg_result_status: "NON_BLANK_NO_NEW_INFO", wwcc_status_at: "2026-10-01T00:00:00Z" }),
      r("a-blank-new", { wwcc_status_at: "2026-10-05T00:00:00Z" }),
      r("a-blank-old", { wwcc_status_at: "2026-10-02T00:00:00Z" }),
      r("b-21", { verification_status: 21, cross_check_status: "review" }),
      r("b-apidown", { verification_status: 20, cross_check_status: "pending", ocg_result_status: null }),
      r("not-20-plain", { verification_status: 20, cross_check_status: "not_started", wwcc_status: "not_started" }),
      r("c-23", { verification_status: 23, wwcc_status: "expired", wwcc_verified_at: "2026-09-01T00:00:00Z" }),
      r("not-26-never-approved", { verification_status: 26, wwcc_status: "ocg_not_found", wwcc_verified_at: null }),
      r("c-26", { verification_status: 26, wwcc_status: "ocg_not_found", wwcc_verified_at: "2026-09-01T00:00:00Z" }),
      r("d-27", { verification_status: 27, wwcc_status: "barred" }),
      r("not-40", { verification_status: 40 }),
    ];
    const q = splitDbsQueues(rows);
    expect(q.awaiting.map((x) => x.id)).toEqual(["a-blank-old", "a-blank-new", "a-nonblank-old"]);
    expect(q.needsPerson.map((x) => x.id)).toEqual(["b-21", "b-apidown"]);
    expect(q.recheckAlerts.map((x) => x.id)).toEqual(["c-23", "c-26"]);
    expect(q.barred.map((x) => x.id)).toEqual(["d-27"]);
    expect(q.badgeCount).toBe(5);
  });

  it("does not mutate its input", () => {
    const rows = [r("2", { wwcc_status_at: "2026-10-05T00:00:00Z" }), r("1", { wwcc_status_at: "2026-10-01T00:00:00Z" })];
    splitDbsQueues(rows);
    expect(rows.map((x) => x.id)).toEqual(["2", "1"]);
  });
});

describe("chips", () => {
  it("Q2 Why-here chip resolves mismatch / API details differ / AI unsure / nanny asked / API down", () => {
    expect(whyHereChip(r("1", { verification_status: 21, cross_check_status: "review", cross_check_issues: ["Surname mismatch"] }))).toBe("Name/DOB mismatch");
    expect(whyHereChip(r("2", { verification_status: 21, cross_check_status: "review", cross_check_issues: ["api_mismatch", "x"] }))).toBe("API details differ");
    expect(whyHereChip(r("3", { verification_status: 21, cross_check_status: "not_started", wwcc_status: "review", wwcc_user_guidance: { confidence: "low" } }))).toBe("AI unsure");
    expect(whyHereChip(r("4", { verification_status: 21, cross_check_status: "not_started", wwcc_status: "review", wwcc_user_guidance: null }))).toBe("Nanny asked for review");
    expect(whyHereChip(r("5", { verification_status: 30 }))).toBeNull();
  });

  it("Has a record on NON_BLANK or has_disclosed_content", () => {
    expect(hasRecordChip(r("1", { ocg_result_status: "NON_BLANK_NO_NEW_INFO" }))).toBe(true);
    expect(hasRecordChip(r("2", { extracted_wwcc_clearance_type: JSON.stringify({ has_disclosed_content: true }) }))).toBe(true);
    expect(hasRecordChip(r("3", { extracted_wwcc_clearance_type: "not json" }))).toBe(false);
    expect(hasRecordChip(r("4", {}))).toBe(false);
  });

  it("API not answering since = her latest dbs_status_check row whose result is ERROR", () => {
    expect(apiDownSince([
      { action_type: "dbs_status_check", action_details: { result: "ERROR" }, created_at: "2026-10-06T09:00:00Z" },
      { action_type: "dbs_status_check", action_details: { result: "ERROR" }, created_at: "2026-10-06T08:00:00Z" },
      { action_type: "verification_rejected", action_details: {}, created_at: "2026-10-06T10:00:00Z" },
    ])).toBe("2026-10-06T09:00:00Z");
    expect(apiDownSince([])).toBeNull();
  });
});

/** Captures `.in()` / `.eq()` per counted query, so the code lists are asserted, not re-implemented. */
function countingClient() {
  const queries: { in?: unknown[]; eq?: unknown; gte?: string }[] = [];
  const client = {
    from: () => ({
      select: () => {
        const q: { in?: unknown[]; eq?: unknown; gte?: string } = {};
        queries.push(q);
        const b = {
          in: (_c: string, v: unknown[]) => ((q.in = v), b),
          eq: (_c: string, v: unknown) => ((q.eq = v), b),
          gte: (_c: string, v: string) => ((q.gte = v), b),
          then: (res: (x: unknown) => unknown) => Promise.resolve({ count: 1, error: null }).then(res),
        };
        return b;
      },
    }),
  };
  return { client, queries };
}

describe("stats", () => {
  it("S1 pending counts ADMIN_PENDING_CODES [10,11,21,30]", async () => {
    const { client, queries } = countingClient();
    await fetchVerificationStats(client as never);
    expect(queries[0].in).toEqual([...ADMIN_PENDING_CODES]);
    expect([...ADMIN_PENDING_CODES]).toEqual([10, 11, 21, 30]);
  });

  it("S1 the Verification tab, dashboard and analytics all read ADMIN_PENDING_CODES, none filters on the string 'pending'", () => {
    const SRC = resolve(__dirname, "../..");
    for (const f of ["lib/admin/dbs-queues.ts", "app/admin/dashboard/page.tsx", "app/api/admin/analytics/route.ts"]) {
      const src = readFileSync(resolve(SRC, f), "utf8");
      expect(src, f).toContain("ADMIN_PENDING_CODES");
      expect(src, f).not.toMatch(/eq\(\s*["']verification_status["']\s*,\s*["']pending["']/);
    }
  });

  it("S2 approved today counts 40 only; rejected today counts 12, 22, 27; total verified = 40", async () => {
    const { client, queries } = countingClient();
    const s = await fetchVerificationStats(client as never);
    expect(queries[1]).toMatchObject({ eq: 40 });
    expect(queries[1].gte).toBeTruthy();
    expect(queries[2].in).toEqual([12, 22, 27]);
    expect(queries[2].gte).toBeTruthy();
    expect(queries[3]).toMatchObject({ eq: 40 });
    expect(queries[3].gte).toBeUndefined();
    expect(s).toEqual({ pending: 1, approvedToday: 1, rejectedToday: 1, totalVerified: 1 });
  });
});
