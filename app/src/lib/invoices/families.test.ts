/**
 * Which families she can invoice (plan 06 step 7, §12 R3 per BAI 2026-11-04): her non-dismissed placements of any
 * status (Regular week), plus her connections with a trial date at any stage (Trial Shift). Other nannies' rows,
 * dismissed placements and connections without a trial date never appear. Every read is hers (the proof's nanny).
 *
 * BB-wave1-041126/06a-build, 2026-11-04.
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
  { id: u(311), suburb: "Islington", hourly_rate: 18 },
  { id: u(312), suburb: "Hackney", hourly_rate: "17.50" },
  { id: u(313), suburb: "Camden", hourly_rate: null },
  { id: u(315), suburb: null, hourly_rate: 16 },
];

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
    expect(await resolveInvoiceTarget(proof, "regular_week", u(412))).toEqual({
      ok: true,
      value: {
        kind: "regular_week", targetId: u(412), parentUserId: u(11), familyName: "Olivia Hartley",
        familyEmailHint: "admin+b06-11@…", area: "Islington",
        prefill: { hours: 30, ratePence: 1800, date: null },
      },
    });
    const placementFilters = f.ops.filter((o) => o.table === "nanny_placements").flatMap((o) => o.filters);
    expect(placementFilters).toEqual([["eq", "id", u(412)], ["eq", "nanny_id", NANNY]]);
  });

  it("her Trial Shift: the position's rate and the trial date pre-filled", async () => {
    expect(await resolveInvoiceTarget(proof, "trial_shift", u(512))).toMatchObject({
      ok: true,
      value: { kind: "trial_shift", parentUserId: u(12), familyName: "Yusuf Ahmed", prefill: { hours: null, ratePence: 1750, date: "2027-02-03" } },
    });
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
    expect(await resolveInvoiceTarget(proof, "regular_week", u(412))).toEqual({ ok: false, error: "no_contact" });
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
