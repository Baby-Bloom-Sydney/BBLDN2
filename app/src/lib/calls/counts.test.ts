/**
 * The counts 02 and 04c show (plan A8, §7; brief §0.8, §9.8): `booked` = booked calls starting in the range
 * (overdue included — still to make), `notBooked` = the to-call list. Test users and Stop calling are left out
 * of both. Null while the switch is off.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { londonWeekRange } from "@/lib/timezone";
import { getCallsToMake, getPrebookedCallCount } from "./counts";
import type { CallsDeps } from "./deps";
import { bookingRow, entryRow, fakeCallsRepo, type FakeCallsState } from "./fake-calls-repo.test-util";
import { CALL_SETTINGS_DEFAULTS } from "./settings";
import type { CallBooking, ParentContact, ScopeParent } from "./types";

const NOW = new Date("2027-02-04T10:00:00.000Z"); // Thu 4 Feb 2027; the London week is Mon 1 → Mon 8 Feb
const WEEK = londonWeekRange(NOW);
const id = (n: number) => `b0400000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const scope = (n: number): ScopeParent => ({ userId: id(n), signupSource: "direct", signedUpAt: "2027-02-02T10:00:00.000Z" });
const contact = (n: number, isTestUser = false): ParentContact => ({
  userId: id(n),
  firstName: "P",
  lastName: String(n),
  email: `p${n}@example.com`,
  mobile: null,
  isTestUser,
});

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

/** §9.8: 8 booked this week, 4 not booked, plus 1 test user and 1 Stop calling. */
function nineEightFixture(): Partial<FakeCallsState> {
  const bookedStarts = [
    "2027-02-01T10:00:00.000Z", // Monday, overdue now — still to make
    "2027-02-04T14:00:00.000Z",
    "2027-02-05T09:00:00.000Z",
    "2027-02-05T09:30:00.000Z",
    "2027-02-06T10:00:00.000Z",
    "2027-02-06T11:00:00.000Z",
    "2027-02-07T18:00:00.000Z",
    "2027-02-07T23:30:00.000Z", // Sunday 23:30 London — still this week
  ];
  const booked: CallBooking[] = bookedStarts.map((startsAt, i) => bookingRow({ parentUserId: id(i + 1), startsAt }));
  const outsideTheWeek = [
    bookingRow({ parentUserId: id(20), startsAt: "2027-02-08T00:00:00.000Z" }), // next Monday 00:00 — half-open
    bookingRow({ parentUserId: id(21), startsAt: "2027-02-04T15:00:00.000Z", status: "done", closedAt: "2027-02-04T15:10:00.000Z" }),
  ];
  return {
    bookings: [...booked, ...outsideTheWeek],
    scope: [9, 10, 11, 12, 13, 14].map(scope),
    contacts: [...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 14].map((n) => contact(n)), contact(13, true)],
    entries: [entryRow({ parentUserId: id(14), occurredAt: "2027-02-03T10:00:00.000Z", result: null, outcome: "stop_calling" })],
  };
}

describe("getCallsToMake (02's contract)", () => {
  it("§9.8 → {booked: 8, notBooked: 4}", async () => {
    const { deps } = setup(nineEightFixture());
    expect(await getCallsToMake(WEEK, deps)).toEqual({ booked: 8, notBooked: 4 });
  });

  it("counts families, not bookings: a first call and a pre-book in the same week are one family (review L)", async () => {
    const { deps } = setup({
      bookings: [
        bookingRow({ parentUserId: id(1), startsAt: "2027-02-04T14:00:00.000Z" }),
        bookingRow({ parentUserId: id(1), startsAt: "2027-02-06T10:00:00.000Z", purpose: "cohort_prebook" }),
      ],
      contacts: [contact(1)],
    });
    expect(await getCallsToMake(WEEK, deps)).toEqual({ booked: 1, notBooked: 0 });
  });

  it("a booked family taken out since her booking (Deposit taken recorded later) isn't counted — the rule who's next uses", async () => {
    const { deps } = setup({
      bookings: [bookingRow({ parentUserId: id(1), startsAt: "2027-02-06T10:00:00.000Z", bookedAt: "2027-02-02T10:00:00.000Z" })],
      entries: [entryRow({ parentUserId: id(1), occurredAt: "2027-02-03T10:00:00.000Z", result: "answered", outcome: "deposit_taken" })],
      contacts: [contact(1)],
    });
    expect(await getCallsToMake(WEEK, deps)).toEqual({ booked: 0, notBooked: 0 });
  });

  it("leaves a test user's booked call out", async () => {
    const { deps } = setup({ bookings: [bookingRow({ parentUserId: id(1), startsAt: "2027-02-05T09:00:00.000Z" })], contacts: [contact(1, true)] });
    expect(await getCallsToMake(WEEK, deps)).toEqual({ booked: 0, notBooked: 0 });
  });

  it("before Start call booking, nobody is not-booked (booked calls still count)", async () => {
    const { deps } = setup({
      settings: CALL_SETTINGS_DEFAULTS,
      scope: [scope(9)],
      bookings: [bookingRow({ parentUserId: id(1), startsAt: "2027-02-05T09:00:00.000Z" })],
      contacts: [contact(1)],
    });
    expect(await getCallsToMake(WEEK, deps)).toEqual({ booked: 1, notBooked: 0 });
  });

  it("is null with the switch off, reading nothing", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    const { fake, deps } = setup(nineEightFixture());
    expect(await getCallsToMake(WEEK, deps)).toBeNull();
    expect(fake.calls).toEqual([]);
  });

  it("is null when the numbers can't be read (logged)", async () => {
    const { deps } = setup({ ...nineEightFixture(), failing: ["readBookingsStartingIn"] });
    expect(await getCallsToMake(WEEK, deps)).toBeNull();
  });

  it("is null for a range that isn't one", async () => {
    const { fake, deps } = setup({});
    expect(await getCallsToMake({ fromUtc: "monday", toUtc: WEEK.toUtc }, deps)).toBeNull();
    expect(await getCallsToMake({ fromUtc: WEEK.toUtc, toUtc: WEEK.fromUtc }, deps)).toBeNull();
    expect(fake.calls).toEqual([]);
  });
});

describe("getPrebookedCallCount (04's own tag; 02's pre-booked line is 03's to wire)", () => {
  const prebook = (n: number, startsAt: string, over: Partial<CallBooking> = {}) =>
    bookingRow({ parentUserId: id(n), startsAt, purpose: "cohort_prebook", ...over });

  it("2 pre-books on Mon 8 Feb → 2 (booked or done; that London date; cohort pre-book only)", async () => {
    const { deps } = setup({
      bookings: [
        prebook(1, "2027-02-08T09:00:00.000Z"),
        prebook(2, "2027-02-08T18:30:00.000Z", { status: "done", closedAt: "2027-02-08T18:40:00.000Z" }),
        prebook(3, "2027-02-08T10:00:00.000Z", { status: "cancelled", cancelReason: "parent" }),
        prebook(4, "2027-02-09T00:00:00.000Z"),
        prebook(5, "2027-02-07T23:59:00.000Z"),
        bookingRow({ parentUserId: id(6), startsAt: "2027-02-08T11:00:00.000Z" }),
      ],
      contacts: [1, 2, 3, 4, 5, 6].map((n) => contact(n)),
    });
    expect(await getPrebookedCallCount("2027-02-08", deps)).toBe(2);
  });

  it("uses the London day in summer (BST): 23:30Z on 7 Jul is 8 Jul", async () => {
    const { deps } = setup({ bookings: [prebook(1, "2027-07-07T23:30:00.000Z")], contacts: [contact(1)] });
    expect(await getPrebookedCallCount("2027-07-08", deps)).toBe(1);
    expect(await getPrebookedCallCount("2027-07-07", deps)).toBe(0);
  });

  it("leaves test users out", async () => {
    const { deps } = setup({ bookings: [prebook(1, "2027-02-08T09:00:00.000Z")], contacts: [contact(1, true)] });
    expect(await getPrebookedCallCount("2027-02-08", deps)).toBe(0);
  });

  it("is null with the switch off, for a bad date, or when it can't be read", async () => {
    const off = setup({});
    vi.stubEnv("CALL_BOOKING_ENABLED", "false");
    expect(await getPrebookedCallCount("2027-02-08", off.deps)).toBeNull();
    expect(off.fake.calls).toEqual([]);
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    expect(await getPrebookedCallCount("8 February", setup({}).deps)).toBeNull();
    expect(await getPrebookedCallCount("2027-02-08", setup({ failing: ["readBookingsStartingIn"] }).deps)).toBeNull();
  });
});
