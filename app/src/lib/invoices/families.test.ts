/**
 * Which families she can invoice (plan 06 step 7, §12 R3 per BAI 2026-11-04): her non-dismissed placements of any
 * status (Regular week), plus her connections with a trial date at any stage (Trial Shift). Other nannies' rows,
 * dismissed placements and connections without a trial date never appear. Every read is hers (the proof's nanny).
 *
 * 06b-2 (plan 14.3, b2.5): the review's pre-fill is shift rows and her rate — the rate from the placement, the
 * position, then her profile; the rows from her usual days (the position's schedule, else its days) with the weekly
 * hours split over them; a Trial Shift's one blank row. Two more reads: `position_schedule`, `nannies.hourly_rate_min`.
 *
 * BB-wave1-041126/06a-build, 2026-11-04; BB-wave1-041126/06b2-build, 2026-11-06.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getNannyId, createAdminClient } = vi.hoisted(() => ({ getNannyId: vi.fn(), createAdminClient: vi.fn() }));
vi.mock("@/lib/actions/connection", () => ({ getNannyId }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import { fakeAdmin, type FakeAdmin, type Op } from "@/lib/payments/fake-admin.test-util";
import { listInvoiceableFamilies, resolveInvoiceTarget } from "./families";
import { proveNanny, type NannyProof } from "./nanny-proof";

const u = (n: number) => `b0600000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const NANNY = u(101);
const OTHER_NANNY = u(102);

const placement = (n: number, parent: number, status: string, extra: Record<string, unknown> = {}) => ({
  id: u(400 + n), nanny_id: NANNY, parent_id: u(200 + parent), position_id: u(300 + parent), status,
  start_date: "2027-01-11", weekly_hours: 30, hourly_rate: 18, end_notes: null, ...extra,
});
const connection = (n: number, parent: number, trial: string | null, extra: Record<string, unknown> = {}) => ({
  id: u(500 + n), nanny_id: NANNY, parent_id: u(200 + parent), position_id: u(300 + parent), trial_date: trial, ...extra,
});
const PARENTS = [11, 12, 13, 14, 15, 16].map((n) => ({ id: u(200 + n), user_id: u(n) }));
const PROFILES = [
  { user_id: u(11), first_name: "Olivia", last_name: "Hartley", email: "admin+b06-11@babybloomnannies.co.uk" },
  { user_id: u(12), first_name: "Yusuf", last_name: "Ahmed", email: "admin+b06-12@babybloomnannies.co.uk" },
  { user_id: u(13), first_name: "Grace", last_name: "Bennett", email: "admin+b06-13@babybloomnannies.co.uk" },
  { user_id: u(14), first_name: "Priya", last_name: "Shah", email: "admin+b06-14@babybloomnannies.co.uk" },
  { user_id: u(15), first_name: "Tom", last_name: "Fletcher", email: "admin+b06-15@babybloomnannies.co.uk" },
];
const POSITIONS = [
  { id: u(311), suburb: "Islington", hourly_rate: 18, days_required: ["Monday", "Tuesday"] },
  { id: u(312), suburb: "Hackney", hourly_rate: "17.50", days_required: null },
  { id: u(313), suburb: "Camden", hourly_rate: null, days_required: ["Wed", "Fri"] },
  { id: u(315), suburb: null, hourly_rate: 16, days_required: null },
];
/** Her usual days: Hartley's position has a schedule (Mon–Fri mornings), which wins over its days_required. */
const SCHEDULES = [
  { position_id: u(311), schedule: { monday: ["morning"], tuesday: ["morning"], wednesday: ["morning"], thursday: ["morning"], friday: ["morning"] } },
];
const NANNY_ROWS = [{ id: NANNY, hourly_rate_min: "16.00" }];
const NOW = new Date("2027-02-15T10:00:00Z");

/** Answer a read by its `eq` / `in` filters, as PostgREST would. */
function matching(rows: readonly Record<string, unknown>[]) {
  return (op: Op) => {
    const hits = rows.filter((row) =>
      op.filters.every(([f, col, val]) => {
        if (f === "eq") return row[col] === val;
        if (f === "in") return (val as unknown[]).includes(row[col]);
        if (f === "not") return row[col] !== null;
        return true;
      }));
    return op.filters.some(([f]) => f === "range") ? hits : hits[0] ?? null;
  };
}

let f: FakeAdmin;
let proof: NannyProof;

function load(placements: readonly Record<string, unknown>[], connections: readonly Record<string, unknown>[]) {
  f.reads.nanny_placements = matching(placements);
  f.reads.connection_requests = matching(connections);
  f.reads.parents = matching(PARENTS);
  f.reads.user_profiles = matching(PROFILES);
  f.reads.nanny_positions = matching(POSITIONS);
  f.reads.position_schedule = matching(SCHEDULES);
  f.reads.nannies = matching(NANNY_ROWS);
}

beforeEach(async () => {
  vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
  f = fakeAdmin();
  createAdminClient.mockReset().mockReturnValue(f.client);
  getNannyId.mockResolvedValue({ nannyId: NANNY, userId: u(1) });
  const p = await proveNanny();
  if (!p) throw new Error("fixture proof");
  proof = p;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("listInvoiceableFamilies", () => {
  it("lists her placements of every status and her trials at any stage, grouped by family (R3)", async () => {
    load(
      [
        placement(11, 11, "ended", { start_date: "2026-06-01" }),
        placement(12, 11, "active"),
        placement(13, 13, "paused", { weekly_hours: "25", hourly_rate: "20.00" }),
        placement(14, 14, "active", { end_notes: "[NANNY_DISMISSED] not for me" }),
      ],
      [connection(12, 12, "2027-02-03"), connection(13, 13, "2027-01-04"), connection(15, 15, "2026-12-01", { connection_stage: 50 })],
    );
    const r = await listInvoiceableFamilies(proof);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.map((fam) => fam.familyName)).toEqual(["Grace Bennett", "Olivia Hartley", "Tom Fletcher", "Yusuf Ahmed"]);
    const hartley = r.value[1];
    expect(hartley).toEqual({
      parentUserId: u(11),
      familyName: "Olivia Hartley",
      area: "Islington",
      placements: [
        { placementId: u(412), status: "active", startDate: "2027-01-11", weeklyHours: 30, ratePence: 1800 },
        { placementId: u(411), status: "ended", startDate: "2026-06-01", weeklyHours: 30, ratePence: 1800 },
      ],
      trials: [],
    });
    expect(r.value[0]).toMatchObject({ area: "Camden", placements: [{ status: "paused", weeklyHours: 25, ratePence: 2000 }], trials: [{ connectionId: u(513), trialDate: "2027-01-04", ratePence: null }] });
    expect(r.value[2]).toMatchObject({ area: null, placements: [], trials: [{ connectionId: u(515), trialDate: "2026-12-01", ratePence: 1600 }] });
    expect(r.value[3]).toMatchObject({ area: "Hackney", trials: [{ connectionId: u(512), ratePence: 1750 }] });
    expect(JSON.stringify(r.value)).not.toMatch(/@|Shah/);
  });

  it("reads only her rows, trials only with a date, paged and in chunks", async () => {
    load([placement(12, 11, "active")], [connection(12, 12, "2027-02-03")]);
    await listInvoiceableFamilies(proof);
    const onTable = (t: string) => f.ops.filter((o) => o.table === t).flatMap((o) => o.filters);
    expect(onTable("nanny_placements")).toEqual(expect.arrayContaining([["eq", "nanny_id", NANNY], ["range", 0, 499]]));
    expect(onTable("connection_requests")).toEqual(expect.arrayContaining([["eq", "nanny_id", NANNY], ["not", "trial_date", "is"], ["range", 0, 499]]));
    expect(onTable("parents")).toEqual(expect.arrayContaining([["in", "id", [u(211), u(212)]]]));
    expect(onTable("user_profiles")).toEqual(expect.arrayContaining([["in", "user_id", [u(11), u(12)]]]));
  });

  it("drops what a query should never have returned: another nanny's row, a connection with no trial date", async () => {
    load([], []);
    f.reads.nanny_placements = [placement(13, 13, "active", { nanny_id: OTHER_NANNY })];
    f.reads.connection_requests = [connection(15, 15, null), connection(12, 12, "2027-02-03", { nanny_id: OTHER_NANNY })];
    expect(await listInvoiceableFamilies(proof)).toEqual({ ok: true, value: [] });
  });

  it("leaves out a family with no profile (it can't be invoiced), and lists nothing when she has nothing", async () => {
    load([placement(17, 16, "active")], []);
    expect(await listInvoiceableFamilies(proof)).toEqual({ ok: true, value: [] });
    load([], []);
    f.ops.length = 0;
    expect(await listInvoiceableFamilies(proof)).toEqual({ ok: true, value: [] });
    expect(f.ops.filter((o) => o.table === "parents")).toEqual([]);
  });

  it("a failed or malformed read fails the list", async () => {
    load([placement(12, 11, "active")], []);
    f.readErrors.user_profiles = { message: "x", code: "XX000" };
    expect(await listInvoiceableFamilies(proof)).toEqual({ ok: false, error: "error" });
    f.readErrors.user_profiles = undefined;
    f.reads.nanny_placements = [{ ...placement(12, 11, "active"), status: "archived" }];
    expect(await listInvoiceableFamilies(proof)).toEqual({ ok: false, error: "error" });
  });

  it("switch off → invoices_disabled, nothing read; a look-alike proof → invalid", async () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "false");
    expect(await listInvoiceableFamilies(proof)).toEqual({ ok: false, error: "invoices_disabled" });
    vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
    expect(await listInvoiceableFamilies({ ...proof })).toEqual({ ok: false, error: "invalid" });
    expect(f.ops).toEqual([]);
    expect(createAdminClient).not.toHaveBeenCalled();
  });
});

describe("failures and ordering", () => {
  it("a missing service key, a malformed row and a throwing read are errors", async () => {
    load([placement(12, 11, "active")], []);
    createAdminClient.mockImplementationOnce(() => { throw new Error("Missing Supabase admin credentials"); });
    expect(await listInvoiceableFamilies(proof)).toEqual({ ok: false, error: "error" });
    expect(console.error).toHaveBeenLastCalledWith("[invoices] createAdminClient failed", { code: "Error" });
    f.reads.nanny_placements = () => ({ id: u(412) });
    expect(await resolveInvoiceTarget(proof, "regular_week", u(412))).toEqual({ ok: false, error: "error" });
    f.reads.nanny_placements = () => { throw new TypeError("network"); };
    expect(await resolveInvoiceTarget(proof, "regular_week", u(412))).toEqual({ ok: false, error: "error" });
  });

  it("lists a family's trials newest first", async () => {
    load([], [connection(12, 12, "2027-01-20"), connection(14, 12, "2027-02-03")]);
    const r = await listInvoiceableFamilies(proof);
    expect(r.ok && r.value[0].trials.map((t) => t.trialDate)).toEqual(["2027-02-03", "2027-01-20"]);
  });
});

describe("resolveInvoiceTarget (checked on the server before every write; the database checks again)", () => {
  beforeEach(() => {
    load(
      [placement(12, 11, "active"), placement(14, 14, "active", { end_notes: "x [NANNY_DISMISSED]" }), placement(16, 13, "active", { nanny_id: OTHER_NANNY })],
      [connection(12, 12, "2027-02-03"), connection(15, 15, null)],
    );
  });

  it("her Regular week: the family, a hint of its email for the review screen (brief §0.4 'olivia@…'), the pre-fill", async () => {
    expect(await resolveInvoiceTarget(proof, "regular_week", u(412), "2027-02-08", NOW)).toEqual({
      ok: true,
      value: {
        kind: "regular_week", targetId: u(412), parentUserId: u(11), familyName: "Olivia Hartley",
        familyEmailHint: "admin+b06-11@…", area: "Islington",
        prefill: {
          shifts: ["2027-02-08", "2027-02-09", "2027-02-10", "2027-02-11", "2027-02-12"].map((date) => ({ date, hours: 6, ratePence: 1800, description: null })),
          ratePence: 1800,
          rateSource: "placement",
        },
      },
    });
    const filtersOn = (t: string) => f.ops.filter((o) => o.table === t).flatMap((o) => o.filters);
    expect(filtersOn("nanny_placements")).toEqual([["eq", "id", u(412)], ["eq", "nanny_id", NANNY]]);
    expect(filtersOn("position_schedule")).toEqual([["eq", "position_id", u(311)]]);
    expect(filtersOn("nannies")).toEqual([["eq", "id", NANNY]]);
  });

  it("the rate falls back to the position's, then her profile's (14.3); the days to the position's days_required", async () => {
    load([placement(12, 11, "active", { hourly_rate: null, weekly_hours: 25 })], []);
    f.reads.position_schedule = null;
    const r = await resolveInvoiceTarget(proof, "regular_week", u(412), "2027-02-08", NOW);
    expect(r.ok && r.value.prefill).toEqual({
      shifts: [{ date: "2027-02-08", hours: 12.5, ratePence: 1800, description: null }, { date: "2027-02-09", hours: 12.5, ratePence: 1800, description: null }],
      ratePence: 1800,
      rateSource: "position",
    });
    load([placement(16, 13, "active", { hourly_rate: null, weekly_hours: null })], []);
    const camden = await resolveInvoiceTarget(proof, "regular_week", u(416), "2027-02-08", NOW);
    expect(camden.ok && camden.value.prefill).toEqual({
      shifts: [{ date: "2027-02-10", hours: null, ratePence: 1600, description: null }, { date: "2027-02-12", hours: null, ratePence: 1600, description: null }],
      ratePence: 1600,
      rateSource: "profile",
    });
  });

  it("this week: days after London's today are dropped; no week given means this week", async () => {
    const wednesday = new Date("2027-02-17T12:00:00Z");
    const r = await resolveInvoiceTarget(proof, "regular_week", u(412), null, wednesday);
    expect(r.ok && r.value.prefill.shifts.map((s) => s.date)).toEqual(["2027-02-15", "2027-02-16", "2027-02-17"]);
  });

  it("a week that isn't a Monday is invalid, a future week is future — before any read", async () => {
    f.ops.length = 0;
    expect(await resolveInvoiceTarget(proof, "regular_week", u(412), "2027-02-10", NOW)).toEqual({ ok: false, error: "invalid" });
    expect(await resolveInvoiceTarget(proof, "regular_week", u(412), "2027-02-22", NOW)).toEqual({ ok: false, error: "future" });
    expect(f.ops).toEqual([]);
  });

  it("her Trial Shift: one blank row on the trial date at the position's rate", async () => {
    expect(await resolveInvoiceTarget(proof, "trial_shift", u(512), null, NOW)).toMatchObject({
      ok: true,
      value: {
        kind: "trial_shift", parentUserId: u(12), familyName: "Yusuf Ahmed",
        prefill: { shifts: [{ date: "2027-02-03", hours: null, ratePence: 1750, description: null }], ratePence: 1750, rateSource: "position" },
      },
    });
  });

  it("a malformed rate or schedule row fails the read (never a guess)", async () => {
    f.reads.nannies = () => ({ id: NANNY, hourly_rate_min: { pounds: 16 } });
    expect(await resolveInvoiceTarget(proof, "regular_week", u(412), "2027-02-08", NOW)).toEqual({ ok: false, error: "error" });
  });

  it.each([
    ["another nanny's placement", "regular_week", 416, "not_hers"],
    ["a dismissed placement", "regular_week", 414, "not_hers"],
    ["no such placement", "regular_week", 499, "not_hers"],
    ["a connection id as a placement", "regular_week", 512, "not_hers"],
    ["a connection with no trial date (R3)", "trial_shift", 515, "no_trial"],
    ["no such connection", "trial_shift", 599, "not_hers"],
  ] as const)("refuses %s", async (_label, kind, n, error) => {
    expect(await resolveInvoiceTarget(proof, kind, u(n))).toEqual({ ok: false, error });
  });

  it("a family without a profile → no_contact; bad input → invalid before any read", async () => {
    load([placement(12, 11, "active")], []);
    f.reads.user_profiles = null;
    expect(await resolveInvoiceTarget(proof, "regular_week", u(412), "2027-02-08", NOW)).toEqual({ ok: false, error: "no_contact" });
    f.ops.length = 0;
    expect(await resolveInvoiceTarget(proof, "regular_week", "hartley")).toEqual({ ok: false, error: "invalid" });
    expect(await resolveInvoiceTarget(proof, "meet_and_greet" as "trial_shift", u(512))).toEqual({ ok: false, error: "invalid" });
    expect(f.ops).toEqual([]);
  });

  it("a failed read is an error; the switch off reads nothing", async () => {
    f.readErrors.nanny_placements = { message: "x", code: "XX000" };
    expect(await resolveInvoiceTarget(proof, "regular_week", u(412))).toEqual({ ok: false, error: "error" });
    vi.stubEnv("NANNY_INVOICES_ENABLED", "");
    f.ops.length = 0;
    expect(await resolveInvoiceTarget(proof, "regular_week", u(412))).toEqual({ ok: false, error: "invoices_disabled" });
    expect(f.ops).toEqual([]);
  });
});
