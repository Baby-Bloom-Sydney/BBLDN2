/**
 * The readers 03, 04 and the family panel use (plan 02 step 4, §8, R13): current / next / next available with
 * counts, one cohort's places left, and the current-cohort summary. A failed read is `error`, never a zero.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";
import { findCohorts, readCurrentCohortSummary, readPlacesLeft } from "./read";

const NOW = new Date("2027-02-03T10:00:00Z");
const SCHEDULE = { first_start_date: "2027-02-01", repeat_weeks: 1, default_places: 5, created_at: "2026-11-04T05:00:00Z" };
const row = (n: number, fields: Record<string, unknown>) => ({
  id: `c0200000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
  cohort_start_date: "2027-02-01", parent_user_id: `b0200000-0000-4000-8000-0000000000${String(n).padStart(2, "0")}`,
  state: "taken", is_goodwill: false, hold_expires_at: null, paid_by: "card", taken_at: "2027-02-02T09:00:00Z",
  reopened_at: null, reopen_reason: null, ...fields,
});
const PLACES = [
  row(1, {}), row(2, { paid_by: "bank_transfer" }), row(3, {}),
  row(4, { cohort_start_date: "2027-02-08", is_goodwill: true }),
  row(5, { state: "held", paid_by: null, taken_at: null, hold_expires_at: "2027-02-03T10:20:00Z", cohort_start_date: "2027-02-08" }),
];

/** Answers each `.in("cohort_start_date", …)` chunk with only its cohorts' rows, as PostgREST would. */
const placesFor = (rows: readonly ReturnType<typeof row>[]) => (op: FakeAdmin["ops"][number]) => {
  const starts = op.filters.find(([f, col]) => f === "in" && col === "cohort_start_date")?.[2] as string[] | undefined;
  return starts ? rows.filter((r) => starts.includes(r.cohort_start_date)) : rows;
};

function db(reads: Record<string, unknown> = {}) {
  return fakeAdmin({ cohort_schedule: SCHEDULE, cohorts: [{ start_date: "2027-02-01", places: 5 }], cohort_places: placesFor(PLACES), ...reads });
}

beforeEach(() => {
  vi.stubEnv("COHORTS_ENABLED", "true");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.unstubAllEnvs());

describe("findCohorts — what 03 decides with", () => {
  it("on 3 Feb with 3 taken: current {5, 3, 0, 2}; next counts goodwill and live holds", async () => {
    const r = await findCohorts(db().client, NOW);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.value.current).toEqual({ start: "2027-02-01", places: 5, taken: 3, beingPaid: 0, left: 2, overBy: 0 });
    expect(r.value.next).toEqual({ start: "2027-02-08", places: 5, taken: 1, beingPaid: 1, left: 3, overBy: 0 });
    expect(r.value.nextAvailable?.start).toBe("2027-02-08");
    expect(r.value.upcoming).toHaveLength(8);
  });

  it("reads places only for the cohorts it shows, ≤100 starts a request, paged with .range()", async () => {
    const f = db();
    await findCohorts(f.client, NOW);
    const placeReads = f.ops.filter((o) => o.table === "cohort_places");
    expect(placeReads.length).toBeGreaterThan(0);
    for (const op of placeReads) {
      expect(op.filters).toContainEqual(["in", "state", ["held", "taken"]]);
      expect(op.filters).toContainEqual(["range", 0, 499]);
      expect((op.filters.find(([f, c]) => f === "in" && c === "cohort_start_date")?.[2] as string[]).length).toBeLessThanOrEqual(100);
    }
  });

  it("next available skips a full next cohort", async () => {
    const full = [row(6, { cohort_start_date: "2027-02-08" }), row(7, { cohort_start_date: "2027-02-08" })];
    const f = db({ cohorts: [{ start_date: "2027-02-01", places: 5 }, { start_date: "2027-02-08", places: 2 }], cohort_places: placesFor(full) });
    const r = await findCohorts(f.client, NOW);
    expect(r.ok && r.value.nextAvailable?.start).toBe("2027-02-15");
  });

  it("before the first start there's no current cohort", async () => {
    const r = await findCohorts(db().client, new Date("2026-11-04T10:00:00Z"));
    expect(r.ok && r.value.current).toBeNull();
    expect(r.ok && r.value.next?.start).toBe("2027-02-01");
  });

  it("any failed read fails the whole answer", async () => {
    for (const table of ["cohort_schedule", "cohorts", "cohort_places"]) {
      const f = db();
      f.readErrors[table] = { message: "down", code: "XX000" };
      expect(await findCohorts(f.client, NOW)).toEqual({ ok: false });
    }
  });

  it("a malformed row fails closed", async () => {
    expect(await findCohorts(db({ cohort_places: [{ id: 1 }] }).client, NOW)).toEqual({ ok: false });
    expect(await findCohorts(db({ cohort_schedule: { first_start_date: "soon" } }).client, NOW)).toEqual({ ok: false });
  });
});

describe("readPlacesLeft — one cohort", () => {
  it("a stored cohort and a schedule-only one", async () => {
    const f = db({ cohorts: [{ start_date: "2027-02-01", places: 7 }] });
    expect(await readPlacesLeft(f.client, "2027-02-01", NOW)).toEqual({ ok: true, value: { start: "2027-02-01", places: 7, taken: 3, beingPaid: 0, left: 4, overBy: 0 } });
    expect(await readPlacesLeft(db({ cohorts: [] }).client, "2027-02-15", NOW)).toEqual({ ok: true, value: { start: "2027-02-15", places: 5, taken: 0, beingPaid: 0, left: 5, overBy: 0 } });
  });
  it("a date that isn't a cohort is null", async () => {
    expect(await readPlacesLeft(db().client, "2027-02-02", NOW)).toEqual({ ok: true, value: null });
    expect(await readPlacesLeft(db().client, "nope", NOW)).toEqual({ ok: true, value: null });
  });
});

describe("readCurrentCohortSummary — plan R13's tagged union", () => {
  it("off: nothing is read", async () => {
    vi.stubEnv("COHORTS_ENABLED", "");
    const f = db();
    expect(await readCurrentCohortSummary(f.client, NOW)).toEqual({ kind: "off" });
    expect(f.ops).toHaveLength(0);
  });
  it("current", async () => {
    expect(await readCurrentCohortSummary(db().client, NOW)).toEqual({
      kind: "current", view: { start: "2027-02-01", places: 5, taken: 3, beingPaid: 0, left: 2, overBy: 0 },
    });
  });
  it("first ahead", async () => {
    expect(await readCurrentCohortSummary(db().client, new Date("2026-11-04T10:00:00Z"))).toEqual({ kind: "first_ahead", first: "2027-02-01" });
  });
  it("not set up", async () => {
    expect(await readCurrentCohortSummary(db({ cohort_schedule: null, cohorts: [] }).client, NOW)).toEqual({ kind: "not_set_up" });
  });
  it("error, never a zero", async () => {
    const f = db();
    f.readErrors.cohort_places = { message: "down", code: "XX000" };
    expect(await readCurrentCohortSummary(f.client, NOW)).toEqual({ kind: "error" });
    const g = db();
    g.client.from = (() => { throw new Error("boom"); }) as never;
    expect(await readCurrentCohortSummary(g.client, NOW)).toEqual({ kind: "error" });
  });
});
