/**
 * The row data for /admin/calls, read in batches for the visible families (plan C3; brief §0.9, §3 admin 2;
 * BB-wave1-041126/04c1-build): one request per table per chunk of ids, never one per row (no N+1).
 *
 *   parents                  → her sign-up source and time
 *   nanny_positions          → the booking's position, else her latest
 *   position_children        → the children's ages, in display order
 *   dfy_match_notifications  → nannies contacted (distinct nannies)
 *   connection_requests      → nannies replied (distinct nannies with `responded_at` set)
 *   parent_subscriptions     → the deposit (the drawer only)
 *
 * Every read fails closed: a PostgREST error, a row that doesn't fit, or a page longer than asked → `error`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, type FakeAdmin, type Op } from "@/lib/payments/fake-admin.test-util";
import { createDashboardReads } from "./dashboard-reads";

const P1 = "b0400000-0000-4000-8000-000000000001";
const P2 = "b0400000-0000-4000-8000-000000000002";
const P3 = "b0400000-0000-4000-8000-000000000003";
const POS_OLD = "d0400000-0000-4000-8000-000000000001";
const POS_NEW = "d0400000-0000-4000-8000-000000000002";
const POS_2 = "d0400000-0000-4000-8000-000000000003";

const inIds = (op: Op): readonly string[] => (op.filters.find((f) => f[0] === "in")?.[2] as string[] | undefined) ?? [];
const pick = <T extends Record<string, unknown>>(rows: readonly T[], key: keyof T) => (op: Op) => rows.filter((r) => inIds(op).includes(r[key] as string));

const PARENTS = [
  { id: "parent-1", user_id: P1, signup_source: "advanced_match", created_at: "2027-02-01T09:00:00+00:00" },
  { id: "parent-2", user_id: P2, signup_source: null, created_at: "2027-02-02T09:00:00+00:00" },
  { id: "parent-3", user_id: P3, signup_source: "standard_match", created_at: "2027-02-03T09:00:00+00:00" },
];
const POSITIONS = [
  { id: POS_NEW, parent_id: "parent-1", suburb: "Islington", hours_per_week: 30, days_required: ["Monday"], start_date: "2027-03-01", created_at: "2027-02-01T10:00:00+00:00" },
  { id: POS_OLD, parent_id: "parent-1", suburb: "Hackney", hours_per_week: 20, days_required: null, start_date: null, created_at: "2027-01-01T10:00:00+00:00" },
  { id: POS_2, parent_id: "parent-2", suburb: null, hours_per_week: null, days_required: ["Friday"], start_date: null, created_at: "2027-02-02T10:00:00+00:00" },
];
const CHILDREN = [
  { position_id: POS_NEW, age_months: 30, display_order: 2 },
  { position_id: POS_NEW, age_months: 8, display_order: 1 },
  { position_id: POS_OLD, age_months: 50, display_order: 1 },
];
const NOTIFIED = [
  { position_id: POS_NEW, nanny_id: "n1" },
  { position_id: POS_NEW, nanny_id: "n2" },
  { position_id: POS_NEW, nanny_id: "n2" },
  { position_id: POS_NEW, nanny_id: "n3" },
  { position_id: POS_2, nanny_id: "n1" },
];
const REPLIED = [
  { position_id: POS_NEW, nanny_id: "n2" },
  { position_id: POS_NEW, nanny_id: "n2" },
];

let fake: FakeAdmin;

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  fake = fakeAdmin({
    parents: pick(PARENTS, "user_id"),
    nanny_positions: pick(POSITIONS, "parent_id"),
    position_children: pick(CHILDREN, "position_id"),
    dfy_match_notifications: pick(NOTIFIED, "position_id"),
    connection_requests: pick(REPLIED, "position_id"),
  });
});
afterEach(() => vi.restoreAllMocks());

const reads = () => createDashboardReads({ client: fake.client });

describe("readFamilyDetails", () => {
  it("no families → no request at all", async () => {
    const got = await reads().readFamilyDetails([]);
    expect(got).toEqual({ ok: true, value: { families: new Map(), positions: new Map() } });
    expect(fake.ops).toEqual([]);
  });

  it("her parents row; her latest position with its children (display order) and distinct nanny counts", async () => {
    const got = await reads().readFamilyDetails([P1, P2, P3]);
    expect(got.ok).toBe(true);
    if (!got.ok) return;
    expect(got.value.families.get(P1)).toEqual({ userId: P1, signupSource: "advanced_match", signedUpAt: "2027-02-01T09:00:00.000Z" });
    expect(got.value.families.get(P2)?.signupSource).toBeNull();
    expect(got.value.positions.get(P1)).toEqual({
      id: POS_NEW,
      parentUserId: P1,
      area: "Islington",
      hoursPerWeek: 30,
      daysRequired: ["Monday"],
      startDate: "2027-03-01",
      createdAt: "2027-02-01T10:00:00.000Z",
      childAgesMonths: [8, 30],
      nanniesContacted: 3,
      nanniesReplied: 1,
    });
    expect(got.value.positions.get(P2)).toMatchObject({ id: POS_2, area: null, daysRequired: ["Friday"], childAgesMonths: [], nanniesContacted: 1, nanniesReplied: 0 });
    // A quick-match family: no position at all.
    expect(got.value.positions.has(P3)).toBe(false);
  });

  it("the booking's own position wins over her latest", async () => {
    const got = await reads().readFamilyDetails([P1], new Map([[P1, POS_OLD]]));
    expect(got.ok && got.value.positions.get(P1)).toMatchObject({ id: POS_OLD, area: "Hackney", childAgesMonths: [50], nanniesContacted: 0 });
  });

  it("one request per table, the replies only with responded_at set", async () => {
    await reads().readFamilyDetails([P1, P2, P3]);
    expect(fake.ops.map((o) => o.table)).toEqual(["parents", "nanny_positions", "position_children", "dfy_match_notifications", "connection_requests"]);
    const replies = fake.ops.find((o) => o.table === "connection_requests");
    expect(replies?.filters).toContainEqual(["not", "responded_at", "is"]);
    expect(inIds(fake.ops.find((o) => o.table === "position_children")!)).toEqual([POS_NEW, POS_2]);
  });

  it("ids go 100 to a request, and a full page asks for the next one", async () => {
    const many = Array.from({ length: 150 }, (_, i) => `b0400000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    fake.reads.parents = (op: Op) => {
      const range = op.filters.find((f) => f[0] === "range");
      return String(range?.[1]) === "0" && inIds(op).length === 100 ? Array.from({ length: 500 }, () => PARENTS[0]) : [];
    };
    await reads().readFamilyDetails(many);
    const parentReads = fake.ops.filter((o) => o.table === "parents");
    expect(parentReads.map((o) => inIds(o).length)).toEqual([100, 100, 50]);
  });

  it.each(["parents", "nanny_positions", "position_children", "dfy_match_notifications", "connection_requests"])(
    "a failed %s read fails the whole read (logged, no partial rows)",
    async (table) => {
      fake.readErrors[table] = { message: "boom", code: "XX000" };
      expect(await reads().readFamilyDetails([P1, P2])).toEqual({ ok: false, error: "error" });
      expect(console.error).toHaveBeenCalled();
    },
  );

  it("a row that doesn't fit fails closed", async () => {
    fake.reads.parents = () => [{ id: "parent-1", user_id: P1, signup_source: 7, created_at: "x" }];
    expect(await reads().readFamilyDetails([P1])).toEqual({ ok: false, error: "error" });
  });

  it("a page longer than asked fails closed (a capped read can't pass for a whole one)", async () => {
    fake.reads.parents = () => Array.from({ length: 1000 }, () => PARENTS[0]);
    expect(await reads().readFamilyDetails([P1])).toEqual({ ok: false, error: "error" });
  });

  it("a thrown client fails closed", async () => {
    const throwing = { from: () => { throw new Error("no client"); } } as unknown as FakeAdmin["client"];
    expect(await createDashboardReads({ client: throwing }).readFamilyDetails([P1])).toEqual({ ok: false, error: "error" });
  });
});

describe("readDeposit", () => {
  it("her subscription's deposit facts", async () => {
    fake.reads.parent_subscriptions = { status: "deposit_paid", deposit_paid_at: "2027-02-03T10:00:00+00:00", deposit_refunded_at: null };
    expect(await reads().readDeposit(P1)).toEqual({ ok: true, value: { status: "deposit_paid", depositPaidAt: "2027-02-03T10:00:00.000Z", depositRefundedAt: null } });
    expect(fake.ops[0].filters).toContainEqual(["eq", "parent_user_id", P1]);
  });

  it("no subscription → null; a failed read → error", async () => {
    expect(await reads().readDeposit(P1)).toEqual({ ok: true, value: null });
    fake.readErrors.parent_subscriptions = { message: "boom" };
    expect(await reads().readDeposit(P1)).toEqual({ ok: false, error: "error" });
  });

  it("a row that doesn't fit → error", async () => {
    fake.reads.parent_subscriptions = { status: null };
    expect(await reads().readDeposit(P1)).toEqual({ ok: false, error: "error" });
  });
});
