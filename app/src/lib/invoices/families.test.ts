/**
 * Which families she can invoice (plan 06 step 7, §12 R3 per BAI 2026-11-04; 06b-4 rework, BAI 2026-11-12): one entry
 * per family (one parent), from both sets — her non-dismissed placements of any status and her connections with a
 * trial date. Other nannies' rows, dismissed placements and connections without a trial date never count. Every read
 * is hers (the proof's nanny).
 *
 * The link rule (amendment 21, the database's own): her placement with that parent — active, then paused, then the
 * rest; the latest start first; then by id — else her connection with that parent that has the latest trial date.
 * The kind is the link's type. The earliest date is the earlier of her first trial date with that parent and the
 * linked placement's start; with neither, the placement's creation date in London. The rate: the linked placement's,
 * then the position's, then her profile's.
 *
 * Resolving any of her ids for a family (the review, a page parameter, a correction) gives that family's link.
 *
 * BB-wave1-041126/06a-build, 2026-11-04; BB-wave1-041126/06b2-build, 2026-11-06; BB-wave1-041126/06b4-server, 2026-11-12.
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
  start_date: "2027-01-11", hourly_rate: 18, end_notes: null, created_at: "2026-12-20T10:00:00+00:00", ...extra,
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
const NANNY_ROWS = [{ id: NANNY, hourly_rate_min: "16.00" }];

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
    return op.filters.some(([f]) => f === "range" || f === "in") ? hits : hits[0] ?? null;
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
  f.reads.nannies = matching(NANNY_ROWS);
}

/** Hartley: an ended and an active hire and an early trial; Bennett: paused, with an earlier trial; Shah: dismissed
 * only; Fletcher: two trials; Ahmed: one trial. */
const SPREAD = {
  placements: [
    placement(11, 11, "ended", { start_date: "2026-06-01" }),
    placement(12, 11, "active"),
    placement(13, 13, "paused", { hourly_rate: "20.00" }),
    placement(14, 14, "active", { end_notes: "[NANNY_DISMISSED] not for me" }),
  ],
  connections: [
    connection(11, 11, "2026-05-20"),
    connection(12, 12, "2027-02-03"),
    connection(13, 13, "2027-01-04"),
    connection(15, 15, "2026-12-01", { connection_stage: 50 }),
    connection(16, 15, "2026-11-20"),
  ],
};
const HARTLEY = {
  parentUserId: u(11), familyName: "Olivia Hartley", area: "Islington", targetId: u(412), kind: "regular_week",
  earliest: "2026-05-20", ratePence: 1800, rateSource: "placement",
};

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
  it("one entry per family, from both sets, each with its link, kind, earliest date and rate (spec a, h; readings 1, 2)", async () => {
    load(SPREAD.placements, SPREAD.connections);
    const r = await listInvoiceableFamilies(proof);
    expect(r).toEqual({
      ok: true,
      value: [
        { parentUserId: u(13), familyName: "Grace Bennett", area: "Camden", targetId: u(413), kind: "regular_week", earliest: "2027-01-04", ratePence: 2000, rateSource: "placement" },
        HARTLEY,
        { parentUserId: u(15), familyName: "Tom Fletcher", area: null, targetId: u(515), kind: "trial_shift", earliest: "2026-11-20", ratePence: 1600, rateSource: "position" },
        { parentUserId: u(12), familyName: "Yusuf Ahmed", area: "Hackney", targetId: u(512), kind: "trial_shift", earliest: "2027-02-03", ratePence: 1750, rateSource: "position" },
      ],
    });
    expect(JSON.stringify(r)).not.toMatch(/@|Shah/);
  });

  it("a dismissed hire never links: the family is listed through its trial, if it has one (R3)", async () => {
    load([placement(14, 14, "active", { end_notes: "x [NANNY_DISMISSED]" })], [connection(14, 14, "2027-01-15")]);
    const r = await listInvoiceableFamilies(proof);
    expect(r.ok && r.value).toEqual([
      { parentUserId: u(14), familyName: "Priya Shah", area: null, targetId: u(514), kind: "trial_shift", earliest: "2027-01-15", ratePence: 1600, rateSource: "profile" },
    ]);
  });

  it("links the hire in today's order: active, then paused, then the rest; the latest start first; then by id", async () => {
    const order = async (placements: readonly Record<string, unknown>[]) => {
      load(placements, []);
      const r = await listInvoiceableFamilies(proof);
      return r.ok ? r.value[0]?.targetId : null;
    };
    expect(await order([placement(1, 11, "ended"), placement(2, 11, "paused"), placement(3, 11, "ended")])).toBe(u(402));
    expect(await order([placement(1, 11, "paused"), placement(2, 11, "active", { start_date: null })])).toBe(u(402));
    expect(await order([placement(1, 11, "active", { start_date: null }), placement(2, 11, "active", { start_date: "2026-01-05" })])).toBe(u(402));
    expect(await order([placement(1, 11, "active", { start_date: "2026-01-05" }), placement(2, 11, "active", { start_date: "2026-09-07" })])).toBe(u(402));
    expect(await order([placement(2, 11, "ended"), placement(1, 11, "ended")])).toBe(u(401));
  });

  it("links the trial with the latest date when there is no hire; ties by id", async () => {
    load([], [connection(2, 12, "2027-01-20"), connection(1, 12, "2027-01-20"), connection(3, 12, "2026-12-01")]);
    const r = await listInvoiceableFamilies(proof);
    expect(r.ok && r.value.map((fam) => [fam.targetId, fam.earliest])).toEqual([[u(501), "2026-12-01"]]);
  });

  it.each([
    ["a trial before the start", { start_date: "2027-01-11" }, ["2026-12-14"], "2026-12-14"],
    ["a start before every trial", { start_date: "2026-09-07" }, ["2026-12-14", "2026-10-01"], "2026-09-07"],
    ["the start when there is no trial", { start_date: "2026-09-07" }, [], "2026-09-07"],
    ["the first trial when there is no start", { start_date: null }, ["2026-12-14", "2026-11-30"], "2026-11-30"],
    ["the hire's creation, in London, when there is neither", { start_date: null, created_at: "2026-06-30T23:30:00+00:00" }, [], "2026-07-01"],
  ] as const)("the earliest date: %s (reading 2)", async (_label, extra, trials, earliest) => {
    load([placement(12, 11, "active", extra)], trials.map((d, i) => connection(20 + i, 11, d)));
    const r = await listInvoiceableFamilies(proof);
    expect(r.ok && r.value.map((fam) => [fam.targetId, fam.earliest])).toEqual([[u(412), earliest]]);
  });

  it("the rate: the linked hire's, then the position's, then her profile's", async () => {
    load([placement(12, 11, "active", { hourly_rate: null })], []);
    let r = await listInvoiceableFamilies(proof);
    expect(r.ok && r.value[0]).toMatchObject({ ratePence: 1800, rateSource: "position" });
    load([placement(13, 13, "active", { hourly_rate: null })], []);
    r = await listInvoiceableFamilies(proof);
    expect(r.ok && r.value[0]).toMatchObject({ ratePence: 1600, rateSource: "profile" });
  });

  it("a failed or malformed profile-rate read leaves the rate to the hire and the position, logged by code", async () => {
    load([placement(13, 13, "active", { hourly_rate: null })], []);
    f.readErrors.nannies = { message: "x", code: "57014" };
    const r = await listInvoiceableFamilies(proof);
    expect(r.ok && r.value[0]).toMatchObject({ ratePence: null, rateSource: null });
    expect(console.error).toHaveBeenCalledWith("[invoices] families.rate failed", { code: "57014" });
  });

  it("reads only her rows, trials only with a date, paged and in chunks", async () => {
    load([placement(12, 11, "active")], [connection(12, 12, "2027-02-03")]);
    await listInvoiceableFamilies(proof);
    const onTable = (t: string) => f.ops.filter((o) => o.table === t).flatMap((o) => o.filters);
    expect(onTable("nanny_placements")).toEqual(expect.arrayContaining([["eq", "nanny_id", NANNY], ["range", 0, 499]]));
    expect(onTable("connection_requests")).toEqual(expect.arrayContaining([["eq", "nanny_id", NANNY], ["not", "trial_date", "is"], ["range", 0, 499]]));
    expect(onTable("parents")).toEqual(expect.arrayContaining([["in", "id", [u(211), u(212)]]]));
    expect(onTable("user_profiles")).toEqual(expect.arrayContaining([["in", "user_id", [u(11), u(12)]]]));
    expect(onTable("nannies")).toEqual([["eq", "id", NANNY]]);
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

  it("a missing service key is an error", async () => {
    load([placement(12, 11, "active")], []);
    createAdminClient.mockImplementationOnce(() => { throw new Error("Missing Supabase admin credentials"); });
    expect(await listInvoiceableFamilies(proof)).toEqual({ ok: false, error: "error" });
    expect(console.error).toHaveBeenLastCalledWith("[invoices] createAdminClient failed", { code: "Error" });
  });
});

describe("resolveInvoiceTarget (checked on the server before every write; the database checks again)", () => {
  beforeEach(() => {
    load([...SPREAD.placements, placement(16, 13, "active", { nanny_id: OTHER_NANNY })], [...SPREAD.connections, connection(17, 16, null)]);
  });

  it("her family by its link id: the list's entry, with a hint of its email for the review (brief §0.4 'olivia@…')", async () => {
    expect(await resolveInvoiceTarget(proof, u(412))).toEqual({ ok: true, value: { ...HARTLEY, familyEmailHint: "admin+b06-11@…" } });
    const filtersOn = (t: string) => f.ops.filter((o) => o.table === t).flatMap((o) => o.filters);
    expect(filtersOn("nanny_placements")).toEqual(expect.arrayContaining([["eq", "nanny_id", NANNY]]));
    expect(filtersOn("user_profiles")).toEqual([["eq", "user_id", u(11)]]);
    expect(filtersOn("nannies")).toEqual([["eq", "id", NANNY]]);
  });

  it.each([
    ["an ended hire of the same family", 411],
    ["a trial of a family she has hired", 511],
  ])("any of her ids for a family gives its link: %s", async (_label, n) => {
    expect(await resolveInvoiceTarget(proof, u(n))).toMatchObject({ ok: true, value: { targetId: u(412), kind: "regular_week", earliest: "2026-05-20" } });
  });

  it("a family with trials only: the latest trial, the first trial's date as the earliest", async () => {
    expect(await resolveInvoiceTarget(proof, u(516))).toMatchObject({
      ok: true,
      value: { targetId: u(515), kind: "trial_shift", earliest: "2026-11-20", familyName: "Tom Fletcher", ratePence: 1600, rateSource: "position" },
    });
  });

  it.each([
    ["another nanny's placement", 416],
    ["a dismissed placement", 414],
    ["no such placement", 499],
    ["a connection with no trial date", 517],
    ["no such connection", 599],
  ] as const)("refuses %s as not_hers", async (_label, n) => {
    expect(await resolveInvoiceTarget(proof, u(n))).toEqual({ ok: false, error: "not_hers" });
  });

  it("a family without a profile → no_contact; bad input → invalid before any read", async () => {
    f.reads.user_profiles = null;
    expect(await resolveInvoiceTarget(proof, u(412))).toEqual({ ok: false, error: "no_contact" });
    f.ops.length = 0;
    expect(await resolveInvoiceTarget(proof, "hartley")).toEqual({ ok: false, error: "invalid" });
    expect(f.ops).toEqual([]);
  });

  it("a failed position read fails (it names the family's area); a failed rate read leaves the rate blank", async () => {
    f.readErrors.nanny_positions = { message: "x", code: "XX000" };
    expect(await resolveInvoiceTarget(proof, u(412))).toEqual({ ok: false, error: "error" });
    f.readErrors.nanny_positions = undefined;
    f.reads.nannies = () => ({ id: NANNY, hourly_rate_min: { pounds: 16 } });
    expect(await resolveInvoiceTarget(proof, u(513))).toMatchObject({ ok: true, value: { targetId: u(413), ratePence: 2000 } });
    expect(console.error).toHaveBeenCalledWith("[invoices] families.rate failed", { code: "unexpected_row" });
  });

  it("a failed, malformed or throwing read is an error; the switch off reads nothing", async () => {
    f.readErrors.nanny_placements = { message: "x", code: "XX000" };
    expect(await resolveInvoiceTarget(proof, u(412))).toEqual({ ok: false, error: "error" });
    f.readErrors.nanny_placements = undefined;
    f.reads.nanny_placements = () => [{ id: u(412) }];
    expect(await resolveInvoiceTarget(proof, u(412))).toEqual({ ok: false, error: "error" });
    f.reads.nanny_placements = () => { throw new TypeError("network"); };
    expect(await resolveInvoiceTarget(proof, u(412))).toEqual({ ok: false, error: "error" });
    vi.stubEnv("NANNY_INVOICES_ENABLED", "");
    f.ops.length = 0;
    expect(await resolveInvoiceTarget(proof, u(412))).toEqual({ ok: false, error: "invoices_disabled" });
    expect(f.ops).toEqual([]);
  });
});
