/**
 * repo.ts — bounded reads (04a review M1 + security M3). `.in()` id lists go ≤ 100 per request; every list read
 * pages with `.range()`; a page that comes back at PostgREST's 1,000-row cap (or longer than asked) fails the read
 * closed instead of silently truncating it; the recent-log limit is clamped to 200.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, type FakeAdmin, type Op } from "@/lib/payments/fake-admin.test-util";
import { createCallsRepo } from "./repo";

const uuidOf = (n: number) => `b0400000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scopeRow = (n: number) => ({ user_id: uuidOf(n), signup_source: "direct", created_at: "2027-02-02T10:00:00+00:00" });
const contactRow = (n: number) => ({
  user_id: uuidOf(n),
  first_name: "P",
  last_name: String(n),
  email: `p${n}@example.com`,
  mobile_number: null,
  is_test_user: false,
});

/** Make `reads[table]` answer per page, from the last op's `.range(from, to)`. */
function paged(f: FakeAdmin, table: string, rowsFor: (from: number, to: number, op: Op) => unknown[]) {
  Object.defineProperty(f.reads, table, {
    get: () => {
      const op = [...f.ops].reverse().find((o) => o.table === table);
      const range = op?.filters.find(([kind]) => kind === "range");
      return op && range ? rowsFor(Number(range[1]), Number(range[2]), op) : [];
    },
  });
}

let errorLog: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  errorLog = vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("paging with .range()", () => {
  it("reads page after page until a short page (500 + 3 → 503 rows, two requests)", async () => {
    const f = fakeAdmin();
    paged(f, "parents", (from) => (from === 0 ? Array.from({ length: 500 }, (_, i) => scopeRow(i)) : [scopeRow(900), scopeRow(901), scopeRow(902)]));
    const read = await createCallsRepo({ client: f.client }).readScopeParents("2027-02-01T09:00:00.000Z");
    expect(read.ok && read.value).toHaveLength(503);
    expect(f.ops.map((o) => o.filters.find(([k]) => k === "range"))).toEqual([
      ["range", 0, 499],
      ["range", 500, 999],
    ]);
  });

  it("a page at the 1,000-row cap fails the read closed (it may have been cut short)", async () => {
    const f = fakeAdmin();
    paged(f, "parents", () => Array.from({ length: 1000 }, (_, i) => scopeRow(i)));
    expect(await createCallsRepo({ client: f.client }).readScopeParents("2027-02-01T09:00:00.000Z")).toEqual({ ok: false, error: "error" });
    expect(errorLog).toHaveBeenCalled();
  });

  it("a read that never ends fails closed after its page budget", async () => {
    const f = fakeAdmin();
    paged(f, "call_bookings", () => []);
    paged(f, "call_blocks", () => Array.from({ length: 500 }, (_, i) => ({ id: `b${i}`, starts_at: "2027-02-05T09:00:00Z", ends_at: "2027-02-05T10:00:00Z", reason: "x" })));
    const read = await createCallsRepo({ client: f.client }).readBlocks({ startsAt: "2027-02-01T00:00:00.000Z", endsAt: "2027-03-01T00:00:00.000Z" });
    expect(read).toEqual({ ok: false, error: "error" });
    expect(f.ops.length).toBeLessThanOrEqual(40);
  });

  it("pages are ordered on a unique column, so no row is skipped or repeated between pages", async () => {
    const f = fakeAdmin({ call_bookings: [] });
    await createCallsRepo({ client: f.client }).readBookedCalls();
    expect(f.ops[0].filters).toEqual(expect.arrayContaining([["order", "id", { ascending: true }]]));
  });
});

describe("id lists go at most 100 to a request", () => {
  it("250 contacts → three requests of ≤ 100 ids, all 250 read", async () => {
    const f = fakeAdmin();
    paged(f, "user_profiles", (_from, _to, op) => {
      const ids = (op.filters.find(([k]) => k === "in")?.[2] ?? []) as string[];
      return ids.map((id) => contactRow(Number(id.slice(-12))));
    });
    const ids = Array.from({ length: 250 }, (_, i) => uuidOf(i));
    const read = await createCallsRepo({ client: f.client }).readContacts(ids);
    const sizes = f.ops.map((o) => ((o.filters.find(([k]) => k === "in")?.[2] ?? []) as string[]).length);
    expect(sizes).toEqual([100, 100, 50]);
    expect(read.ok && read.value.map((c) => c.userId).sort()).toEqual([...ids].sort());
  });

  it("bookings from several chunks come back newest first, as one list", async () => {
    const f = fakeAdmin();
    paged(f, "call_bookings", (_from, _to, op) => {
      const ids = (op.filters.find(([k]) => k === "in")?.[2] ?? []) as string[];
      return ids.slice(0, 1).map((parent, i) => ({
        id: `c-${parent}`,
        parent_user_id: parent,
        position_id: null,
        starts_at: "2027-02-09T14:00:00+00:00",
        ends_at: "2027-02-09T14:30:00+00:00",
        status: "booked",
        purpose: "first_call",
        booked_by_kind: "parent",
        hold_expires_at: null,
        booked_at: "2027-02-04T10:00:00+00:00",
        moved_at: null,
        moved_from_starts_at: null,
        cancelled_at: null,
        cancel_reason: null,
        closed_at: null,
        created_at: ids[0] === uuidOf(0) ? "2027-02-01T10:00:00+00:00" : `2027-02-0${2 + i}T10:00:00+00:00`,
      }));
    });
    const read = await createCallsRepo({ client: f.client }).readBookingsForParents(Array.from({ length: 150 }, (_, i) => uuidOf(i)));
    expect(read.ok && read.value.map((b) => b.createdAt)).toEqual(["2027-02-02T10:00:00.000Z", "2027-02-01T10:00:00.000Z"]);
  });
});

describe("readRecentLogEntries", () => {
  it.each([
    [5000, 200],
    [50, 50],
    [0, 1],
    [Number.NaN, 1],
  ])("limit %s → %s", async (asked, sent) => {
    const f = fakeAdmin({ call_log_entries: [] });
    await createCallsRepo({ client: f.client }).readRecentLogEntries(asked);
    expect(f.ops[0].filters).toEqual(expect.arrayContaining([["limit", sent, undefined]]));
  });
});
