/**
 * Unit 3g (BB-LDN-3g-141026) — `send-delayed-emails` cron: VER-003 copy + the #20 trigger, LCY sub-variants (brief
 * changes 3–4), and P-10 (no "still not verified" nudge after a re-check fail).
 * Unit 3i (BB-LDN-3i-141026, addendum M1): VER-003 skips a once-approved row only when its CURRENT failure is marked as
 * a re-check failure in `activity_logs` (`dbs_status_check`, `recheck_fail: true`, `status_at` = her `wwcc_status_at`).
 *
 * Hoisted-mock pattern from `api/cron/trial-reminders/route.test.ts`, with a small chainable Supabase fake that
 * records every call and applies the simple filters (`eq`, `in`, `is`, `lt`) to the `verifications` rows, so a row the
 * real query would not select is not selected here either. `or()` is recorded, not evaluated (its string is asserted).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { DBS_LINKS } from "@/lib/constants";

type Row = Record<string, unknown>;
type Call = [string, unknown[]];
type Query = { table: string; calls: Call[] };

const h = vi.hoisted(() => ({
  verifications: [] as Row[],
  nanny: { verification_level: 2, status: "active" } as Row | null,
  queries: [] as Query[],
  sends: [] as Array<{ to: string; subject: string; html: string; emailType: string }>,
  readError: null as null | { message: string },
  logs: [] as Row[],
  logsError: null as null | { message: string },
}));

function applyFilters(rows: Row[], calls: Call[]): Row[] {
  return rows.filter((r) =>
    calls.every(([m, a]) => {
      const [col, val] = a as [string, unknown];
      if (m === "eq") return r[col] === val;
      if (m === "in") return (val as unknown[]).includes(r[col]);
      if (m === "is") return r[col] === val;
      if (m === "lt") return String(r[col]) < String(val);
      return true;
    }),
  );
}

function resolve(q: Query): { data: unknown; error: null; count?: number } {
  if (q.table === "verifications" && h.readError) return { data: null, error: h.readError } as never;
  if (q.table === "verifications") return { data: applyFilters(h.verifications, q.calls), error: null };
  if (q.table === "nannies") return { data: h.nanny, error: null };
  if (q.table === "activity_logs" && h.logsError) return { data: null, error: h.logsError } as never;
  if (q.table === "activity_logs") return { data: applyFilters(h.logs, q.calls), error: null };
  if (q.table === "email_logs") return { data: null, error: null, count: 0 };
  return { data: [], error: null };
}

function builder(table: string): unknown {
  const q: Query = { table, calls: [] };
  h.queries.push(q);
  const b: unknown = new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === "then") {
          return (ok: (v: unknown) => unknown, ko: (e: unknown) => unknown) => Promise.resolve(resolve(q)).then(ok, ko);
        }
        return (...args: unknown[]) => {
          q.calls.push([String(prop), args]);
          return b;
        };
      },
    },
  );
  return b;
}

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: (t: string) => builder(t) }) }));
vi.mock("@/lib/email/resend", () => ({
  sendEmail: async (p: { to: string; subject: string; html: string; emailType: string }) => {
    h.sends.push(p);
    return { success: true } as const;
  },
}));
vi.mock("@/lib/email/helpers", () => ({
  getUserEmailInfo: async (userId: string) => ({ email: `${userId}@example.test`, firstName: "Sophie", lastName: "Taylor", userId }),
}));
vi.mock("@/lib/actions/connection-helpers", () => ({ createInboxMessage: vi.fn() }));

const ago = (ms: number) => new Date(Date.now() - ms).toISOString();
const ELEVEN_MIN = 11 * 60 * 1000;
const ONE_HOUR = 60 * 60 * 1000;

/** A verifications row, idle since `idleMs` ago (status time = updated_at, so "no action taken"). */
function ver(userId: string, wwcc_status: string, idleMs: number, extra: Row = {}): Row {
  const t = ago(idleMs);
  return {
    id: `v-${userId}`,
    user_id: userId,
    identity_status: "verified",
    identity_status_at: t,
    wwcc_status,
    wwcc_status_at: t,
    wwcc_verified_at: null,
    updated_at: t,
    created_at: t,
    ...extra,
  };
}

/** The 3i marker row for the re-check failure that set her CURRENT wwcc_status_at (addendum M1). */
function recheckMarker(userId: string): Row {
  const v = h.verifications.find((r) => r.user_id === userId)!;
  return {
    user_id: userId,
    action_type: "dbs_status_check",
    action_details: { trigger: "recheck", result: "NEW_INFO", recheck_fail: true, status_at: v.wwcc_status_at },
  };
}

async function run() {
  delete process.env.CRON_SECRET;
  const { GET } = await import("./route");
  const res = await GET(new NextRequest("http://localhost/api/cron/send-delayed-emails"));
  expect(res.status).toBe(200);
}

const ver003 = () => h.sends.filter((s) => s.emailType === "verification_rejected");
const reminders = () => h.sends.filter((s) => s.emailType === "verification_reminder");
const ver003Query = () =>
  h.queries.find((q) => q.table === "verifications" && q.calls.some(([m, a]) => m === "in" && a[0] === "wwcc_status"));
const lcyQuery = () => h.queries.find((q) => q.table === "verifications" && q.calls.some(([m]) => m === "or"));

beforeEach(() => {
  h.verifications = [];
  h.nanny = { verification_level: 2, status: "active" };
  h.queries = [];
  h.sends = [];
  h.readError = null;
  h.logs = [];
  h.logsError = null;
  vi.resetModules();
});

describe("send-delayed-emails — VER-003 (deck §6.3, #20)", () => {
  it("returns VER-003 with subject \"Action needed: Your DBS certificate\" when a nanny's DBS step failed 10 minutes ago", async () => {
    h.verifications = [ver("u-failed", "failed", ELEVEN_MIN)];
    await run();
    expect(ver003()).toHaveLength(1);
    const [m] = ver003();
    expect(m.to).toBe("u-failed@example.test");
    expect(m.subject).toBe("Action needed: Your DBS certificate");
    expect(m.html).toContain("Your DBS check needs attention");
    expect(m.html).toContain(
      "Hi Sophie, we weren't able to verify your DBS certificate. This can happen if the photo was unclear, it wasn't page 1, or we couldn't confirm it with the DBS Update Service.",
    );
    expect(m.html).toContain(
      "Visit your verification page to see what needs fixing. You can upload it again or ask our team to check it.",
    );
    expect(m.html).toContain("Fix It Now");
  });

  it.each([
    ["23 new information", "expired"],
    ["26 no match", "ocg_not_found"],
  ])("selects a first-check %s row (wwcc_verified_at null) for VER-003 (#20)", async (_label, status) => {
    h.verifications = [ver("u-first", status, ELEVEN_MIN)];
    await run();
    expect(ver003().map((s) => s.to)).toEqual(["u-first@example.test"]);
  });

  // Retargeted by 3i (addendum M1): the exclusion is the re-check marker, not `wwcc_verified_at IS NULL`.
  it("never selects a re-check failure (marked in activity_logs — 3i emails it) or a 22 rejected row (P-4 email)", async () => {
    h.verifications = [
      ver("u-recheck-23", "expired", ELEVEN_MIN, { wwcc_verified_at: ago(30 * 24 * ONE_HOUR) }),
      ver("u-recheck-26", "ocg_not_found", ELEVEN_MIN, { wwcc_verified_at: ago(30 * 24 * ONE_HOUR) }),
      ver("u-rejected", "rejected", ELEVEN_MIN),
    ];
    h.logs = [recheckMarker("u-recheck-23"), recheckMarker("u-recheck-26")];
    await run();
    expect(ver003()).toHaveLength(0);
    const q = ver003Query();
    expect(q?.calls).toContainEqual(["in", ["wwcc_status", ["failed", "expired", "ocg_not_found"]]]);
    expect(q?.calls).not.toContainEqual(["is", ["wwcc_verified_at", null]]);
    // 3i code review LOW: the marker filter runs in the database (no 1000-row page can push a marker out)
    const logQ = h.queries.find((x) => x.table === "activity_logs");
    expect(logQ?.calls).toContainEqual(["filter", ["action_details->>recheck_fail", "eq", "true"]]);
  });

  // 3g code review M1, resolved by 3i (addendum): a once-approved nanny whose NEW upload fails gets VER-003 — her
  // current failure is not a re-check failure (no marker carries her current wwcc_status_at).
  it("M1 a once-approved nanny's later AI 'failed' gets VER-003", async () => {
    h.verifications = [ver("u-reupload", "failed", ELEVEN_MIN, { wwcc_verified_at: ago(30 * 24 * ONE_HOUR) })];
    await run();
    expect(ver003().map((s) => s.to)).toEqual(["u-reupload@example.test"]);
  });

  it("M1 an older re-check marker does not hide a later first-check 23/26 after she re-uploaded", async () => {
    h.verifications = [ver("u-again", "expired", ELEVEN_MIN, { wwcc_verified_at: ago(30 * 24 * ONE_HOUR) })];
    h.logs = [{ ...recheckMarker("u-again"), action_details: { trigger: "recheck", result: "NEW_INFO", recheck_fail: true, status_at: ago(3 * 24 * ONE_HOUR) } }];
    await run();
    expect(ver003().map((s) => s.to)).toEqual(["u-again@example.test"]);
  });

  it("M1 a log read error holds back once-approved rows this run (never a double email) and still sends first checks", async () => {
    h.verifications = [ver("u-first", "failed", ELEVEN_MIN), ver("u-once", "expired", ELEVEN_MIN, { wwcc_verified_at: ago(ONE_HOUR) })];
    h.logsError = { message: "logs down" };
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    await run();
    expect(ver003().map((s) => s.to)).toEqual(["u-first@example.test"]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("VER-003"), "logs down");
    log.mockRestore();
  });

  it("keeps the 10-minute delay and the 'no action since' test", async () => {
    h.verifications = [
      ver("u-too-soon", "failed", 5 * 60 * 1000),
      ver("u-acted", "failed", ELEVEN_MIN, { updated_at: ago(60 * 1000) }),
    ];
    await run();
    expect(ver003()).toHaveLength(0);
  });

  it("selectVer003Candidates is exported for 3i's R14 and applies the same filter", async () => {
    const { selectVer003Candidates } = await import("@/lib/email/ver003-candidates");
    h.verifications = [
      ver("u-first", "ocg_not_found", ELEVEN_MIN),
      ver("u-recheck", "ocg_not_found", ELEVEN_MIN, { wwcc_verified_at: ago(ONE_HOUR) }),
    ];
    h.logs = [recheckMarker("u-recheck")];
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const rows = await selectVer003Candidates(createAdminClient(), ago(10 * 60 * 1000));
    expect(rows.map((r) => r.user_id)).toEqual(["u-first"]);
  });
});

describe("selectVer003Candidates — read error", () => {
  it("logs and returns no rows, so the cron's other emails still go", async () => {
    const { selectVer003Candidates } = await import("@/lib/email/ver003-candidates");
    const { createAdminClient } = await import("@/lib/supabase/admin");
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    h.readError = { message: "boom" };
    expect(await selectVer003Candidates(createAdminClient(), ago(0))).toEqual([]);
    expect(log).toHaveBeenCalledWith(expect.stringContaining("VER-003"), "boom");
    log.mockRestore();
  });
});

describe("send-delayed-emails — LCY-101…104 (deck §6.9)", () => {
  it("never selects closed (the query string asserted)", async () => {
    await run();
    const [, args] = lcyQuery()!.calls.find(([m]) => m === "or")!;
    expect(args[0]).toBe(
      "identity_status.in.(not_started,failed,rejected)," +
        "wwcc_status.eq.not_started," +
        "wwcc_status.in.(failed,rejected,ocg_not_found,expired)",
    );
    expect(String(args[0])).not.toContain("closed");
  });

  it("returns sub-variant dbs_no_match when wwcc_status is ocg_not_found", async () => {
    h.verifications = [ver("u-26", "ocg_not_found", ONE_HOUR)];
    await run();
    const [m] = reminders();
    expect(m.html).toContain(
      "We couldn’t find your certificate on the DBS Update Service. This usually means you haven’t joined yet, or your subscription has ended.",
    );
    expect(m.html).toContain(
      "1. Join the Update Service, or check your subscription is active<br/>" +
        "2. If your certificate is over 30 days old and not on it, you’ll need a new enhanced DBS<br/>" +
        "3. Go to your Verification page and upload page 1 again",
    );
  });

  it("returns sub-variant dbs_new_info when wwcc_status is expired, with the GOV.UK step linked to DBS_LINKS.getEnhanced", async () => {
    h.verifications = [ver("u-23", "expired", ONE_HOUR)];
    await run();
    const [m] = reminders();
    expect(m.html).toContain(
      "The DBS Update Service shows there’s new information since your certificate was issued, so you’ll need a new enhanced DBS before we can verify you.",
    );
    expect(m.html).toContain(`href="${DBS_LINKS.getEnhanced}"`);
    expect(m.html).toContain("2. Join the Update Service when it arrives<br/>3. Upload page 1 on your Verification page");
  });

  it("renders the wwcc_not_started instructions with \"Verify DBS\" and no \"Grant Email\"", async () => {
    h.verifications = [ver("u-20", "not_started", ONE_HOUR)];
    await run();
    const [m] = reminders();
    expect(m.html).toContain(
      "Your identity is verified — you’re one step away! Upload page 1 of your enhanced DBS certificate and your profile will be visible to families in your area.",
    );
    expect(m.html).toContain(
      "1. Go to your Verification page<br/>" +
        "2. Take a clear photo of page 1 of your DBS certificate (or use a PDF)<br/>" +
        "3. Make sure you’re on the DBS Update Service<br/>" +
        "4. Click “Verify DBS”",
    );
    expect(m.html).not.toContain("Grant Email");
  });

  it("renders the wwcc_failed message and instructions (deck §6.9)", async () => {
    h.verifications = [ver("u-24", "failed", ONE_HOUR)];
    await run();
    const [m] = reminders();
    expect(m.html).toContain(
      "Your DBS check needs a quick fix. A clearer photo of page 1 usually does it — or you can ask our team to check it by hand.",
    );
    expect(m.html).toContain(
      "1. Go to your Verification page<br/>" +
        "2. Read the feedback on what went wrong<br/>" +
        "3. Upload page 1 again, or click “Request manual review”<br/>" +
        "4. Click “Verify DBS”",
    );
  });

  // Orchestrator ruling 2026-10-14 (review M2): 22 = Edit & Resubmit only — the manual-review half is dropped, no new words.
  it("renders the 22 (rejected) reminder without the manual-review half", async () => {
    h.verifications = [ver("u-22", "rejected", ONE_HOUR)];
    await run();
    const [m] = reminders();
    expect(m.html).toContain("Your DBS check needs a quick fix. A clearer photo of page 1 usually does it.");
    expect(m.html).toContain(
      "1. Go to your Verification page<br/>" +
        "2. Read the feedback on what went wrong<br/>" +
        "3. Upload page 1 again<br/>" +
        "4. Click “Verify DBS”",
    );
    expect(m.html).not.toMatch(/manual review|check it by hand/i);
  });

  it.each([
    ["new information", "expired"],
    ["no match", "ocg_not_found"],
  ])("P-10: sends no reminder after a re-check fail (%s, wwcc_verified_at set)", async (_label, status) => {
    h.verifications = [ver("u-recheck", status, ONE_HOUR, { wwcc_verified_at: ago(30 * 24 * ONE_HOUR) })];
    await run();
    expect(reminders()).toHaveLength(0);
  });
});
