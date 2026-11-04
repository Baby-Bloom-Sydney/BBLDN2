/**
 * Who's next (plan A8; brief §8 contract 5; §12 R22): overdue → due now → next booked → not booked, oldest first.
 * Rows expose `lastAttemptAt` and `callBackAt` for 05's 2-hour skip and call-backs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CallsDeps } from "./deps";
import { bookingRow, entryRow, fakeCallsRepo, type FakeCallsState } from "./fake-calls-repo.test-util";
import { CALL_SETTINGS_DEFAULTS } from "./settings";
import { getWhoIsNext } from "./who-next";

const NOW = new Date("2027-02-04T10:00:00.000Z");
const id = (n: number) => `b0400000-0000-4000-8000-${String(n).padStart(12, "0")}`;

function setup(seed: Partial<FakeCallsState>) {
  const fake = fakeCallsRepo({ settings: { ...CALL_SETTINGS_DEFAULTS, enabledSince: "2027-02-01T09:00:00.000Z" }, ...seed });
  const deps: CallsDeps = { repo: fake.repo, now: () => NOW, notify: async () => {}, prebookRequests: async () => new Map() };
  return { fake, deps };
}

beforeEach(() => {
  vi.stubEnv("CALL_BOOKING_ENABLED", "true");
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getWhoIsNext", () => {
  it("orders overdue → due now → next booked → not booked (oldest first, call-backs at their time)", async () => {
    const { deps } = setup({
      bookings: [
        bookingRow({ parentUserId: id(1), startsAt: "2027-02-04T13:00:00.000Z" }), // next booked, later
        bookingRow({ parentUserId: id(2), startsAt: "2027-02-04T09:30:00.000Z" }), // overdue (30 min past, grace 15)
        bookingRow({ parentUserId: id(3), startsAt: "2027-02-04T09:50:00.000Z" }), // due now (10 min past)
        bookingRow({ parentUserId: id(4), startsAt: "2027-02-04T11:00:00.000Z" }), // next booked, sooner
        bookingRow({ parentUserId: id(5), startsAt: "2027-02-04T09:00:00.000Z" }), // overdue, older
        bookingRow({ parentUserId: id(6), startsAt: "2027-02-04T09:45:00.000Z" }), // exactly at the grace → overdue
      ],
      scope: [
        { userId: id(7), signupSource: "direct", signedUpAt: "2027-02-03T10:00:00.000Z" },
        { userId: id(8), signupSource: null, signedUpAt: "2027-02-02T10:00:00.000Z" },
        { userId: id(9), signupSource: "direct", signedUpAt: "2027-02-01T10:00:00.000Z" },
      ],
      entries: [
        entryRow({ parentUserId: id(9), occurredAt: "2027-02-03T12:00:00.000Z", result: "answered", outcome: "call_back_later", callBackAt: "2027-02-04T17:00:00.000Z" }),
        entryRow({ parentUserId: id(8), occurredAt: "2027-02-04T08:30:00.000Z", result: "no_answer" }),
      ],
    });
    const next = await getWhoIsNext(deps);
    expect(next.ok).toBe(true);
    const rows = next.ok ? next.value : [];
    expect(rows.map((r) => [r.group, r.parentUserId])).toEqual([
      ["overdue", id(5)],
      ["overdue", id(2)],
      ["overdue", id(6)],
      ["due_now", id(3)],
      ["next_booked", id(4)],
      ["next_booked", id(1)],
      ["not_booked", id(8)],
      ["not_booked", id(7)],
      ["not_booked", id(9)],
    ]);
    expect(rows.find((r) => r.parentUserId === id(8))).toMatchObject({ lastAttemptAt: "2027-02-04T08:30:00.000Z", callBackAt: null, booking: null });
    expect(rows.find((r) => r.parentUserId === id(9))).toMatchObject({ callBackAt: "2027-02-04T17:00:00.000Z" });
    expect(rows[0].booking).toMatchObject({ startsAt: "2027-02-04T09:00:00.000Z", purpose: "first_call" });
  });

  it("a booked family's last attempt is exposed too", async () => {
    const { deps } = setup({
      bookings: [bookingRow({ parentUserId: id(1), startsAt: "2027-02-04T13:00:00.000Z" })],
      entries: [entryRow({ parentUserId: id(1), occurredAt: "2027-02-04T09:00:00.000Z", result: "no_answer" })],
      contacts: [{ userId: id(1), firstName: "Jane", lastName: "Smith", email: "jane@example.com", mobile: "+447700900123", isTestUser: false }],
    });
    const next = await getWhoIsNext(deps);
    expect(next.ok && next.value[0]).toMatchObject({
      group: "next_booked",
      lastAttemptAt: "2027-02-04T09:00:00.000Z",
      contact: { firstName: "Jane", mobile: "+447700900123" },
    });
  });

  it("a family with a first call and a pre-book booked gets a row for each", async () => {
    const { deps } = setup({
      bookings: [
        bookingRow({ parentUserId: id(1), startsAt: "2027-02-04T13:00:00.000Z" }),
        bookingRow({ parentUserId: id(1), startsAt: "2027-02-08T10:00:00.000Z", purpose: "cohort_prebook" }),
      ],
    });
    const next = await getWhoIsNext(deps);
    expect(next.ok && next.value.map((r) => r.booking?.purpose)).toEqual(["first_call", "cohort_prebook"]);
  });

  it("is call_booking_disabled with the switch off, reading nothing", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    const { fake, deps } = setup({});
    expect(await getWhoIsNext(deps)).toEqual({ ok: false, error: "call_booking_disabled" });
    expect(fake.calls).toEqual([]);
  });

  it.each(["readBookedCalls", "readSettings", "readContacts", "readLogEntriesForParents"] as const)("a failed %s → error", async (method) => {
    const { deps } = setup({ bookings: [bookingRow({ parentUserId: id(1), startsAt: "2027-02-04T13:00:00.000Z" })], failing: [method] });
    expect(await getWhoIsNext(deps)).toEqual({ ok: false, error: "error" });
  });
});
