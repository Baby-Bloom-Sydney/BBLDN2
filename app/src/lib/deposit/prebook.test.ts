/**
 * Pre-booking (plan 03 §3 "Pre-book", row A5, D9; brief 03 §3 parent 5). One open pre-booking per family, recorded
 * only with her deposit proof; 04's booking id stored on HER open one; 02's count per cohort (null = couldn't be
 * read, never a stand-in 0); and 04's pending requests — open, no booking, no call logged after it was made — whose
 * failed read throws (04's `to-call.ts` turns a throw into its error path).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, writesTo, type FakeAdmin, type Op } from "@/lib/payments/fake-admin.test-util";
import { proveDepositCode, type DepositParentProof } from "./proof";
import { attachPrebookingCall, countOpenPrebookings, readPendingPrebookRequests, recordPrebooking } from "./prebook";

const CODE = "Ab0_-".repeat(8) + "xyz";
const LINK = "d0300000-0000-4000-8000-000000000001";
const PARENT = "b0300000-0000-4000-8000-000000000001";
const OTHER = "b0300000-0000-4000-8000-000000000002";
const PREBOOKING = "e0300000-0000-4000-8000-000000000001";
const BOOKING = "f0400000-0000-4000-8000-000000000001";
const SECRET = "Sarah Jones sarah@example.test";

const row = (over: Record<string, unknown> = {}) => ({
  id: PREBOOKING,
  parent_user_id: PARENT,
  cohort_start_date: "2027-02-08",
  call_booking_id: null,
  created_at: "2027-02-03T10:00:00.123456+00:00",
  ...over,
});

async function proofFor(parent = PARENT): Promise<DepositParentProof> {
  const links = fakeAdmin({
    deposit_links: { id: LINK, parent_user_id: parent, state: "open", target: "current", goodwill_cohort_start_date: null, last_opened_at: null },
  });
  const proved = await proveDepositCode(links.client, CODE);
  if (!proved.ok) throw new Error("expected a proof");
  return proved.proof;
}

let fake: FakeAdmin;
let log: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  fake = fakeAdmin();
  fake.writeResults.deposit_prebookings = row();
  log = vi.spyOn(console, "error").mockImplementation(() => {});
});

const logged = () => JSON.stringify(log.mock.calls);

describe("recordPrebooking — refused before any read", () => {
  it.each([
    ["no proof", null],
    ["a look-alike", { kind: "deposit_parent_proof", parentUserId: PARENT, linkId: LINK }],
  ])("%s → invalid with zero database calls", async (_label, proof) => {
    expect(await recordPrebooking(fake.client, proof as unknown as DepositParentProof, "2027-02-08")).toEqual({ ok: false, status: "invalid" });
    expect(fake.ops).toHaveLength(0);
  });

  it.each([["a date that doesn't exist", "2027-02-30"], ["not a date", "soon"], ["a number", 20270208]])(
    "a cohort date that isn't one (%s) → invalid with zero database calls",
    async (_label, start) => {
      expect(await recordPrebooking(fake.client, await proofFor(), start as unknown as string)).toEqual({ ok: false, status: "invalid" });
      expect(fake.ops).toHaveLength(0);
    },
  );
});

describe("recordPrebooking — one open pre-booking per family", () => {
  it("a new one: inserts her row, writes one deposit.prebooked row for her, returns it frozen", async () => {
    const r = await recordPrebooking(fake.client, await proofFor(), "2027-02-08");
    expect(r).toEqual({
      ok: true,
      created: true,
      prebooking: { id: PREBOOKING, parentUserId: PARENT, cohortStartDate: "2027-02-08", callBookingId: null, createdAt: "2027-02-03T10:00:00.123Z" },
    });
    expect(Object.isFrozen(r)).toBe(true);
    if (r.ok) expect(Object.isFrozen(r.prebooking)).toBe(true);
    expect(writesTo(fake, "deposit_prebookings")).toEqual([
      expect.objectContaining({ kind: "insert", payload: { parent_user_id: PARENT, cohort_start_date: "2027-02-08" } }),
    ]);
    expect(writesTo(fake, "activity_logs").map((o) => o.payload)).toEqual([
      { user_id: PARENT, action_type: "deposit.prebooked", action_details: { prebooking_id: PREBOOKING, cohort_start_date: "2027-02-08" } },
    ]);
  });

  it("no next cohort set up: the pre-booking has no date, and so does its history row", async () => {
    fake.writeResults.deposit_prebookings = row({ cohort_start_date: null });
    const r = await recordPrebooking(fake.client, await proofFor(), null);
    expect(r).toMatchObject({ ok: true, created: true, prebooking: { cohortStartDate: null } });
    expect(writesTo(fake, "deposit_prebookings")[0].payload).toEqual({ parent_user_id: PARENT, cohort_start_date: null });
    expect(writesTo(fake, "activity_logs")[0].payload).toMatchObject({ action_details: { prebooking_id: PREBOOKING, cohort_start_date: null } });
  });

  it("she already has one open (23505): re-reads it — no second row, no second history row", async () => {
    fake.writeErrors.deposit_prebookings = { message: `duplicate for ${SECRET}`, code: "23505" };
    fake.reads.deposit_prebookings = row({ cohort_start_date: "2027-02-01" });
    const r = await recordPrebooking(fake.client, await proofFor(), "2027-02-08");
    expect(r).toMatchObject({ ok: true, created: false, prebooking: { id: PREBOOKING, cohortStartDate: "2027-02-01" } });
    expect(writesTo(fake, "deposit_prebookings")).toHaveLength(1);
    expect(writesTo(fake, "activity_logs")).toHaveLength(0);
    const reread = fake.ops.find((o) => o.table === "deposit_prebookings" && o.kind === "select");
    expect(reread?.filters).toEqual([
      ["eq", "parent_user_id", PARENT],
      ["eq", "state", "open"],
    ]);
    expect(log).not.toHaveBeenCalled();
  });

  it.each([
    ["the re-read finds none (it closed in between)", () => (fake.reads.deposit_prebookings = null)],
    ["the re-read fails", () => (fake.readErrors.deposit_prebookings = { message: SECRET, code: "XX000" })],
  ])("23505 but %s → error, logged by code only", async (_label, arrange) => {
    fake.writeErrors.deposit_prebookings = { message: SECRET, code: "23505" };
    arrange();
    expect(await recordPrebooking(fake.client, await proofFor(), "2027-02-08")).toEqual({ ok: false, status: "error" });
    expect(log).toHaveBeenCalled();
    expect(logged()).not.toContain("Sarah");
  });

  it("another insert error → error, logged by its code only (never the message)", async () => {
    fake.writeErrors.deposit_prebookings = { message: SECRET, code: "XX000" };
    expect(await recordPrebooking(fake.client, await proofFor(), "2027-02-08")).toEqual({ ok: false, status: "error" });
    expect(log).toHaveBeenCalledWith("[cohorts] deposit.prebook.insert failed", { code: "XX000" });
    expect(logged()).not.toContain("Sarah");
    expect(writesTo(fake, "activity_logs")).toHaveLength(0);
  });

  it.each([
    ["an id that isn't a uuid", { id: "x" }],
    ["another family's row", { parent_user_id: OTHER }],
    ["a date that isn't one", { cohort_start_date: "2027-02-30" }],
    ["a time that isn't one", { created_at: "later" }],
  ])("an unexpected row back (%s) → error, no history row", async (_label, over) => {
    fake.writeResults.deposit_prebookings = row(over);
    expect(await recordPrebooking(fake.client, await proofFor(), "2027-02-08")).toEqual({ ok: false, status: "error" });
    expect(log).toHaveBeenCalledWith("[cohorts] deposit.prebook.insert failed", { code: "unexpected_row" });
    expect(writesTo(fake, "activity_logs")).toHaveLength(0);
  });

  it("a failed history row is reported, not thrown: the pre-booking stands", async () => {
    fake.writeErrors.activity_logs = { message: SECRET, code: "23514" };
    expect(await recordPrebooking(fake.client, await proofFor(), "2027-02-08")).toMatchObject({ ok: true, created: true });
    expect(log).toHaveBeenCalledWith("[cohorts] deposit.prebooked activity failed", { code: "23514" });
    expect(logged()).not.toContain("Sarah");
  });

  it("a throw → error, logged by the error's name", async () => {
    const proof = await proofFor();
    fake.client.from = (() => {
      throw new TypeError(SECRET);
    }) as never;
    expect(await recordPrebooking(fake.client, proof, "2027-02-08")).toEqual({ ok: false, status: "error" });
    expect(log).toHaveBeenCalledWith("[cohorts] deposit.prebook failed", { code: "TypeError" });
  });
});

describe("attachPrebookingCall — 04's booking id on HER open pre-booking only", () => {
  it("stores the booking id, filtered to her and to an open pre-booking", async () => {
    fake.writeResults.deposit_prebookings = [{ id: PREBOOKING }];
    const r = await attachPrebookingCall(fake.client, await proofFor(), { prebookingId: PREBOOKING, callBookingId: BOOKING });
    expect(r).toEqual({ ok: true });
    expect(writesTo(fake, "deposit_prebookings")).toEqual([
      expect.objectContaining({
        kind: "update",
        payload: { call_booking_id: BOOKING },
        filters: [
          ["eq", "id", PREBOOKING],
          ["eq", "parent_user_id", PARENT],
          ["eq", "state", "open"],
        ],
      }),
    ]);
  });

  it("another family's (or a converted) pre-booking matches nothing → not_found", async () => {
    fake.writeResults.deposit_prebookings = [];
    expect(await attachPrebookingCall(fake.client, await proofFor(OTHER), { prebookingId: PREBOOKING, callBookingId: BOOKING })).toEqual({
      ok: false,
      status: "not_found",
    });
    expect(writesTo(fake, "deposit_prebookings")[0].filters).toContainEqual(["eq", "parent_user_id", OTHER]);
  });

  it.each([
    ["no proof", null, { prebookingId: PREBOOKING, callBookingId: BOOKING }],
    ["a look-alike", { kind: "deposit_parent_proof", parentUserId: PARENT, linkId: LINK }, { prebookingId: PREBOOKING, callBookingId: BOOKING }],
  ])("%s → invalid with zero database calls", async (_label, proof, ids) => {
    expect(await attachPrebookingCall(fake.client, proof as unknown as DepositParentProof, ids)).toEqual({ ok: false, status: "invalid" });
    expect(fake.ops).toHaveLength(0);
  });

  it.each([
    ["a pre-booking id that isn't a uuid", { prebookingId: "1", callBookingId: BOOKING }],
    ["a booking id that isn't a uuid", { prebookingId: PREBOOKING, callBookingId: "" }],
    ["no ids", null],
  ])("%s → invalid with zero database calls", async (_label, ids) => {
    const proof = await proofFor();
    expect(await attachPrebookingCall(fake.client, proof, ids as never)).toEqual({ ok: false, status: "invalid" });
    expect(fake.ops).toHaveLength(0);
  });

  it("a write error → error, logged by code", async () => {
    fake.writeErrors.deposit_prebookings = { message: SECRET, code: "XX000" };
    expect(await attachPrebookingCall(fake.client, await proofFor(), { prebookingId: PREBOOKING, callBookingId: BOOKING })).toEqual({
      ok: false,
      status: "error",
    });
    expect(log).toHaveBeenCalledWith("[cohorts] deposit.prebook.attach failed", { code: "XX000" });
  });

  it("an unexpected reply or a throw → error", async () => {
    const proof = await proofFor();
    fake.writeResults.deposit_prebookings = null;
    expect(await attachPrebookingCall(fake.client, proof, { prebookingId: PREBOOKING, callBookingId: BOOKING })).toEqual({ ok: false, status: "error" });
    fake.client.from = (() => {
      throw new TypeError(SECRET);
    }) as never;
    expect(await attachPrebookingCall(fake.client, proof, { prebookingId: PREBOOKING, callBookingId: BOOKING })).toEqual({ ok: false, status: "error" });
  });
});

describe("countOpenPrebookings — 02's 'N pre-booked calls' for one cohort", () => {
  it("counts the open pre-bookings for that cohort with one head count", async () => {
    fake.counts.deposit_prebookings = 3;
    expect(await countOpenPrebookings(fake.client, "2027-02-08")).toBe(3);
    expect(fake.ops).toEqual([
      expect.objectContaining({ table: "deposit_prebookings", kind: "select", filters: [["eq", "cohort_start_date", "2027-02-08"], ["eq", "state", "open"]] }),
    ]);
  });

  it("none → 0 (a real count of none)", async () => {
    fake.counts.deposit_prebookings = 0;
    expect(await countOpenPrebookings(fake.client, "2027-02-08")).toBe(0);
  });

  it.each([
    ["a read error", () => (fake.readErrors.deposit_prebookings = { message: SECRET, code: "XX000" })],
    ["no count in the reply", () => undefined],
    ["a negative count", () => (fake.counts.deposit_prebookings = -1)],
  ])("%s → null (couldn't be read), never a stand-in 0", async (_label, arrange) => {
    arrange();
    expect(await countOpenPrebookings(fake.client, "2027-02-08")).toBeNull();
    expect(log).toHaveBeenCalled();
    expect(logged()).not.toContain("Sarah");
  });

  it("a throw → null", async () => {
    fake.client.from = (() => {
      throw new TypeError(SECRET);
    }) as never;
    expect(await countOpenPrebookings(fake.client, "2027-02-08")).toBeNull();
  });

  it("a cohort date that isn't one → null with no read", async () => {
    expect(await countOpenPrebookings(fake.client, "2027-02-30")).toBeNull();
    expect(fake.ops).toHaveLength(0);
  });
});

describe("readPendingPrebookRequests — 04's pending requests (D9)", () => {
  const P = (n: number) => `b0300000-0000-4000-8000-0000000001${String(n).padStart(2, "0")}`;
  const inIds = (op: Op) => (op.filters.find(([f, c]) => f === "in" && c === "parent_user_id")?.[2] ?? []) as string[];

  /** The fixtures: open pre-bookings with no booking (the query's own filters leave the rest out). */
  const PREBOOKINGS = [
    row({ id: "e0300000-0000-4000-8000-000000000101", parent_user_id: P(1), cohort_start_date: "2027-02-08", created_at: "2027-02-03T10:00:00+00:00" }),
    row({ id: "e0300000-0000-4000-8000-000000000102", parent_user_id: P(2), cohort_start_date: "2027-02-08", created_at: "2027-02-03T10:00:00+00:00" }),
    row({ id: "e0300000-0000-4000-8000-000000000103", parent_user_id: P(3), cohort_start_date: "2027-02-08", created_at: "2027-02-03T10:00:00+00:00" }),
    row({ id: "e0300000-0000-4000-8000-000000000104", parent_user_id: P(4), cohort_start_date: null, created_at: "2027-06-30T23:30:00+00:00" }),
    row({ id: "e0300000-0000-4000-8000-000000000105", parent_user_id: P(5), cohort_start_date: null, created_at: "2027-01-31T23:30:00+00:00" }),
  ];
  const ENTRIES = [
    { parent_user_id: P(2), occurred_at: "2027-02-03T11:00:00+00:00" },
    { parent_user_id: P(3), occurred_at: "2027-02-03T09:59:59+00:00" },
    { parent_user_id: P(3), occurred_at: "2027-02-03T10:00:00+00:00" },
  ];

  beforeEach(() => {
    fake.reads.deposit_prebookings = (op: Op) => PREBOOKINGS.filter((p) => inIds(op).includes(p.parent_user_id as string));
    fake.reads.call_log_entries = (op: Op) => ENTRIES.filter((e) => inIds(op).includes(e.parent_user_id));
  });

  it("no families → an empty map with no read", async () => {
    expect((await readPendingPrebookRequests(fake.client, [])).size).toBe(0);
    expect(fake.ops).toHaveLength(0);
  });

  it("pending = open, no booking, and no call logged after it was made; a NULL cohort → the London day it was made", async () => {
    const asked = [P(1), P(2), P(3), P(4), P(5), P(6)];
    const map = await readPendingPrebookRequests(fake.client, asked);
    expect([...map.entries()]).toEqual([
      [P(1), { londonDate: "2027-02-08" }],
      [P(3), { londonDate: "2027-02-08" }],
      [P(4), { londonDate: "2027-07-01" }],
      [P(5), { londonDate: "2027-01-31" }],
    ]);
    expect(Object.isFrozen(map.get(P(1)))).toBe(true);
    const [prebookings, entries] = fake.ops;
    expect(prebookings).toMatchObject({ table: "deposit_prebookings", kind: "select" });
    expect(prebookings.filters).toEqual(
      expect.arrayContaining([["in", "parent_user_id", asked], ["eq", "state", "open"], ["is", "call_booking_id", null], ["range", 0, 499]]),
    );
    expect(entries).toMatchObject({ table: "call_log_entries", kind: "select" });
    expect(entries.filters).toEqual(
      expect.arrayContaining([["in", "parent_user_id", [P(1), P(2), P(3), P(4), P(5)]], ["gt", "occurred_at", "2027-01-31T23:30:00.000Z"]]),
    );
    expect(fake.ops).toHaveLength(2);
  });

  it("no family has a pre-booking → no call-log read", async () => {
    const map = await readPendingPrebookRequests(fake.client, [P(7), P(8)]);
    expect(map.size).toBe(0);
    expect(fake.ops.map((o) => o.table)).toEqual(["deposit_prebookings"]);
  });

  it("at most 100 ids to a request", async () => {
    const many = Array.from({ length: 250 }, (_, i) => `b0300000-0000-4000-8000-${String(i).padStart(12, "0")}`);
    await readPendingPrebookRequests(fake.client, many);
    const chunks = fake.ops.filter((o) => o.table === "deposit_prebookings").map((o) => inIds(o).length);
    expect(chunks).toEqual([100, 100, 50]);
  });

  it.each([
    ["the pre-bookings read fails", () => (fake.readErrors.deposit_prebookings = { message: SECRET, code: "XX000" })],
    ["the call-log read fails", () => (fake.readErrors.call_log_entries = { message: SECRET, code: "XX000" })],
    ["a pre-booking row doesn't fit", () => (fake.reads.deposit_prebookings = [row({ parent_user_id: P(1), created_at: "never" })])],
    ["a call-log row doesn't fit", () => (fake.reads.call_log_entries = [{ parent_user_id: P(1), occurred_at: null }])],
  ])("%s → the promise rejects (04's error path), with nothing about a family in the error", async (_label, arrange) => {
    arrange();
    const read = readPendingPrebookRequests(fake.client, [P(1), P(2)]);
    await expect(read).rejects.toThrow("[deposit] pending pre-book requests could not be read");
    await read.catch((e: unknown) => {
      expect(String(e)).not.toContain(P(1));
      expect(String(e)).not.toContain("Sarah");
    });
  });
});
