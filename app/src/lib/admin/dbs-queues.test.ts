/**
 * Unit 3d (BB-LDN-3d-061026) — the DBS queue split (Q1, Q2; brief change 9, #30, #35) and the stat counts (S1, S2;
 * brief change 10, spec §1.3).
 */
import { describe, it, expect, vi } from "vitest";
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

describe("getDbsQueues (fetch)", () => {
  it("Q3 one query → lists, 1-hour signed certificate URL (never the path), is_pdf, profile, last 10 history rows, API-down time", async () => {
    const { createMemoryDb } = await import("../../../tests/fakes/memory-supabase");
    const { getDbsQueues } = await import("./dbs-queues");
    const logs = Array.from({ length: 12 }, (_, i) => ({
      user_id: "u2", action_type: "dbs_status_check", action_details: { trigger: "retry", result: "ERROR", reason: "timeout" },
      created_at: `2026-10-06T0${Math.floor(i / 2)}:${i % 2 ? "30" : "00"}:00Z`,
    }));
    const db = createMemoryDb({
      verifications: [
        { id: "v1", user_id: "u1", created_at: "2026-10-06T00:00:00Z", verification_status: 30, identity_status: "verified", wwcc_status: "doc_verified",
          wwcc_status_at: "2026-10-06T01:00:00Z", cross_check_status: "passed", ocg_result_status: "BLANK_NO_NEW_INFO",
          wwcc_service_nsw_screenshot_url: "u1/123-page1.pdf", wwcc_ai_issues: ["confidence:high"], cross_check_issues: "[\"x\"]" },
        { id: "v2", user_id: "u2", created_at: "2026-10-06T00:00:00Z", verification_status: 20, identity_status: "verified", wwcc_status: "doc_verified",
          cross_check_status: "pending", wwcc_service_nsw_screenshot_url: "u2/9-page1.png" },
        { id: "v3", user_id: "u3", created_at: "2026-10-06T00:00:00Z", verification_status: 40, wwcc_status: "doc_verified" },
      ],
      user_profiles: [{ user_id: "u1", first_name: "Sophie", last_name: "Taylor", email: "sophie.taylor+3d@example.test", profile_picture_url: null }],
      activity_logs: logs,
    });
    const q = await getDbsQueues(db.client() as never);
    expect(q.awaiting).toHaveLength(1);
    expect(q.awaiting[0]).toMatchObject({ first_name: "Sophie", is_pdf: true, certificate_url: "https://storage.test/signed/u1/123-page1.pdf", wwcc_ai_issues: "[\"confidence:high\"]", cross_check_issues: ["x"] });
    expect(q.needsPerson.map((r) => r.id)).toEqual(["v2"]);
    expect(q.needsPerson[0].is_pdf).toBe(false);
    expect(q.needsPerson[0].history).toHaveLength(10);
    expect(q.needsPerson[0].api_down_since).toBe("2026-10-06T05:30:00Z");
    expect(JSON.stringify(q)).not.toContain("\"u1/123-page1.pdf\"");
    expect(q.badgeCount).toBe(2);
  });

  it("Q3 a failed query yields empty lists (the page still renders)", async () => {
    const { getDbsQueues } = await import("./dbs-queues");
    const broken = { from: () => ({ select: () => ({ in: () => ({ not: () => ({ order: () => ({ limit: async () => ({ data: null, error: { message: "boom" } }) }) }) }) }) }) };
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const q = await getDbsQueues(broken as never);
    spy.mockRestore();
    expect(q).toEqual({ awaiting: [], needsPerson: [], recheckAlerts: [], barred: [], badgeCount: 0 });
  });
});

describe("review fix (security M2)", () => {
  it("history keeps only DBS decision types and only the keys the modal shows", async () => {
    const { createMemoryDb } = await import("../../../tests/fakes/memory-supabase");
    const { getDbsQueues } = await import("./dbs-queues");
    const db = createMemoryDb({
      verifications: [{ id: "v1", user_id: "u1", created_at: "2026-10-06T00:00:00Z", verification_status: 30, ocg_result_status: "BLANK_NO_NEW_INFO" }],
      activity_logs: [
        { user_id: "u1", action_type: "verification_rejected", action_details: { admin_id: "a", reason: "r", secret: "x" }, created_at: "2026-10-06T02:00:00Z" },
        { user_id: "u1", action_type: "payout_paid", action_details: { amount: 1 }, created_at: "2026-10-06T03:00:00Z" },
      ],
    });
    const q = await getDbsQueues(db.client() as never);
    expect(q.awaiting[0].history).toEqual([
      { action_type: "verification_rejected", action_details: { admin_id: "a", reason: "r" }, created_at: "2026-10-06T02:00:00Z" },
    ]);
  });
});

