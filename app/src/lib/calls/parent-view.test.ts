/**
 * parent-view.ts (plan B6, B7): what her call page and her hub card show, built server-side as London words so the
 * device's zone can't matter. Pure.
 */
import { describe, expect, it } from "vitest";
import { bookingRow, entryRow } from "./fake-calls-repo.test-util";
import { REFUSAL_FOR, bookedViewOf, callViewOf, heldViewOf, hubCardFor, isAfterNoAnswer, myBookedCall, refusalOf } from "./parent-view";
import type { SlotGrid } from "./slot-grid";
import type { CallsResult } from "./types";

const HER = "b0400000-0000-4000-8000-000000000001";
const NOW = new Date("2027-02-04T10:00:00.000Z");
const TUE_14 = "2027-02-09T14:00:00.000Z";
const ok = <T>(value: T): CallsResult<T> => ({ ok: true, value });
const FAILED = { ok: false, error: "error" } as const;
/** The picker's grid (04b rework W4): every date in the window, every slot with its free flag. */
const SLOTS: SlotGrid = { dates: ["2027-02-09"], slots: [{ startsAt: TUE_14, endsAt: "2027-02-09T14:30:00.000Z", free: true }] };
const NONE: SlotGrid = { dates: [], slots: [] };

describe("myBookedCall", () => {
  it("her booked first call; never a pre-book, a hold or a closed row", () => {
    const first = bookingRow({ parentUserId: HER, startsAt: TUE_14 });
    expect(myBookedCall([bookingRow({ parentUserId: HER, startsAt: TUE_14, purpose: "cohort_prebook" }), first])).toBe(first);
    expect(myBookedCall([bookingRow({ parentUserId: HER, startsAt: TUE_14, status: "held", bookedAt: null })])).toBeNull();
    expect(myBookedCall([bookingRow({ parentUserId: HER, startsAt: TUE_14, status: "done" })])).toBeNull();
    expect(myBookedCall([])).toBeNull();
  });
});

describe("bookedViewOf / heldViewOf", () => {
  it("the booked line in London words; changeable only before the start", () => {
    expect(bookedViewOf({ id: "b-1", startsAt: TUE_14 }, NOW)).toEqual({
      bookingId: "b-1",
      startsAt: TUE_14,
      line: "Your Complimentary matchmaker call is on Tuesday 9 February at 14:00 (London time)",
      changeable: true,
    });
    expect(bookedViewOf({ id: "b-1", startsAt: TUE_14 }, new Date(TUE_14)).changeable).toBe(false);
  });

  it("the held line names the time and when the hold runs out, London clock", () => {
    expect(heldViewOf({ bookingId: "h-1", startsAt: TUE_14, holdExpiresAt: "2027-02-04T10:05:00.000Z" })).toEqual({
      holdId: "h-1",
      startsAt: TUE_14,
      line: "We're holding Tuesday 9 February, 14:00 (London time) for you until 10:05.",
    });
  });

  it("a BST hold expiry reads on the London clock", () => {
    expect(heldViewOf({ bookingId: "h", startsAt: "2027-07-01T13:00:00.000Z", holdExpiresAt: "2027-07-01T09:05:00.000Z" }).line).toBe(
      "We're holding Thursday 1 July, 14:00 (London time) for you until 10:05.",
    );
  });
});

describe("isAfterNoAnswer (brief §0.10)", () => {
  const noAnswer = entryRow({ parentUserId: HER, occurredAt: "2027-02-03T14:05:00.000Z", result: "no_answer" });

  it("her latest attempt went unanswered and she hasn't booked since", () => {
    expect(isAfterNoAnswer([], [noAnswer])).toBe(true);
    expect(isAfterNoAnswer([], [entryRow({ ...noAnswer, result: "voicemail" })])).toBe(true);
  });

  it("not after an answered call, Stop calling, no attempt, or a booking made since", () => {
    expect(isAfterNoAnswer([], [])).toBe(false);
    expect(isAfterNoAnswer([], [entryRow({ ...noAnswer, result: "answered" })])).toBe(false);
    expect(isAfterNoAnswer([], [entryRow({ ...noAnswer, result: null, outcome: "stop_calling" })])).toBe(false);
    const since = bookingRow({ parentUserId: HER, startsAt: TUE_14, status: "cancelled", cancelReason: "parent", bookedAt: "2027-02-03T15:00:00.000Z" });
    expect(isAfterNoAnswer([since], [noAnswer])).toBe(false);
    const before = bookingRow({ parentUserId: HER, startsAt: "2027-02-03T14:00:00.000Z", status: "no_answer", bookedAt: "2027-02-01T10:00:00.000Z" });
    expect(isAfterNoAnswer([before], [noAnswer])).toBe(true);
  });
});

describe("callViewOf", () => {
  it("the picker's days are the whole grid: every date, every slot, free or not (04b rework W4)", () => {
    const grid: SlotGrid = {
      dates: ["2027-02-09", "2027-02-10"],
      slots: [{ startsAt: TUE_14, endsAt: "2027-02-09T14:30:00.000Z", free: false }],
    };
    const view = callViewOf({ bookings: ok([]), entries: ok([]), grid: ok(grid), now: NOW });
    expect(view.kind === "pick" && view.days.map((d) => [d.legend, d.slots.map((x) => x.free)])).toEqual([
      ["Tuesday 9 February", [false]],
      ["Wednesday 10 February", []],
    ]);
  });

  it("booked → her booking, and the free days for Change time", () => {
    const view = callViewOf({ bookings: ok([bookingRow({ id: "b-1", parentUserId: HER, startsAt: TUE_14 })]), entries: ok([]), grid: ok(SLOTS), now: NOW });
    expect(view.kind).toBe("booked");
    expect(view.kind === "booked" && [view.booking.bookingId, view.days?.[0].legend]).toEqual(["b-1", "Tuesday 9 February"]);
  });

  it("booked with the slots unreadable → still booked, no days", () => {
    const view = callViewOf({ bookings: ok([bookingRow({ parentUserId: HER, startsAt: TUE_14 })]), entries: ok([]), grid: FAILED, now: NOW });
    expect(view.kind === "booked" && view.days).toBeNull();
  });

  it("not booked → the days, grouped, with the after-no-answer flag", () => {
    const entries = ok([entryRow({ parentUserId: HER, occurredAt: "2027-02-03T14:05:00.000Z", result: "no_answer" })]);
    const view = callViewOf({ bookings: ok([]), entries, grid: ok(SLOTS), now: NOW });
    expect(view).toEqual({ kind: "pick", afterNoAnswer: true, days: [expect.objectContaining({ legend: "Tuesday 9 February" })] });
    expect(callViewOf({ bookings: ok([]), entries: ok([]), grid: ok(NONE), now: NOW })).toEqual({ kind: "pick", afterNoAnswer: false, days: [] });
  });

  it("the bookings or the slots unreadable (without a known booking) → load_failed", () => {
    expect(callViewOf({ bookings: FAILED, entries: ok([]), grid: ok(SLOTS), now: NOW })).toEqual({ kind: "load_failed" });
    expect(callViewOf({ bookings: ok([]), entries: ok([]), grid: FAILED, now: NOW })).toEqual({ kind: "load_failed" });
  });

  it("the attempts unreadable → she can still pick; just no after-no-answer line (review F6)", () => {
    expect(callViewOf({ bookings: ok([]), entries: FAILED, grid: ok(SLOTS), now: NOW })).toEqual({
      kind: "pick",
      afterNoAnswer: false,
      days: [expect.objectContaining({ legend: "Tuesday 9 February" })],
    });
  });
});

describe("refusalOf", () => {
  it("passes the parent-facing codes through and folds the rest", () => {
    for (const code of ["taken", "too_soon", "hold_expired", "not_yours", "rate_limited", "invalid", "call_booking_disabled"] as const) {
      expect(refusalOf(code)).toBe(code);
    }
    expect(refusalOf("overlap")).toBe("taken");
    expect(refusalOf("not_found")).toBe("not_yours");
    expect(refusalOf("booked_call_exists")).toBe("error");
    expect(refusalOf("error")).toBe("error");
  });

  it("is one exhaustive table over every CallError (review F3: a new code won't compile until it is mapped)", () => {
    expect(Object.keys(REFUSAL_FOR).sort()).toEqual([
      "booked_call_exists",
      "call_booking_disabled",
      "error",
      "hold_expired",
      "invalid",
      "not_found",
      "not_yours",
      "overlap",
      "rate_limited",
      "taken",
      "too_soon",
    ]);
    expect(Object.isFrozen(REFUSAL_FOR)).toBe(true);
  });
});

describe("hubCardFor (plan B7; brief §0.5)", () => {
  const SWITCH_ON = "2027-02-01T09:00:00.000Z";
  const inScope = { userId: HER, signupSource: "advanced_match", signedUpAt: "2027-02-03T10:00:00.000Z" };
  const base = { bookings: [], entries: [], parent: inScope, enabledSince: SWITCH_ON, now: NOW };

  it("booked → her short London time, changeable before the start", () => {
    expect(hubCardFor({ ...base, bookings: [bookingRow({ parentUserId: HER, startsAt: TUE_14 })] })).toEqual({
      kind: "booked",
      line: "Your Complimentary matchmaker call: Tue 9 Feb, 14:00 (London time)",
      changeable: true,
    });
    expect(hubCardFor({ ...base, now: new Date(TUE_14), bookings: [bookingRow({ parentUserId: HER, startsAt: TUE_14 })] })).toMatchObject({ changeable: false });
  });

  it("not booked, in scope → 'Pick a time for your Complimentary matchmaker call' (a NULL source counts)", () => {
    expect(hubCardFor(base)).toEqual({ kind: "not_booked", line: "Pick a time for your Complimentary matchmaker call" });
    expect(hubCardFor({ ...base, parent: { ...inScope, signupSource: null } })).toMatchObject({ kind: "not_booked" });
    expect(hubCardFor({ ...base, entries: [entryRow({ parentUserId: HER, occurredAt: "2027-02-03T12:00:00.000Z", result: "no_answer" })] })).toMatchObject({
      kind: "not_booked",
    });
  });

  it("hidden after Answered or Stop calling", () => {
    expect(hubCardFor({ ...base, entries: [entryRow({ parentUserId: HER, occurredAt: "2027-02-03T12:00:00.000Z", result: "answered", outcome: "call_back_later" })] })).toBeNull();
    expect(hubCardFor({ ...base, entries: [entryRow({ parentUserId: HER, occurredAt: "2027-02-03T12:00:00.000Z", result: null, outcome: "stop_calling" })] })).toBeNull();
  });

  it("hidden outside the scope: an invite sign-up, before switch-on, switch-on not pressed, no parents row", () => {
    expect(hubCardFor({ ...base, parent: { ...inScope, signupSource: "nanny_invite" } })).toBeNull();
    expect(hubCardFor({ ...base, parent: { ...inScope, signupSource: "parent_invite" } })).toBeNull();
    expect(hubCardFor({ ...base, parent: { ...inScope, signedUpAt: "2027-01-31T09:00:00.000Z" } })).toBeNull();
    expect(hubCardFor({ ...base, enabledSince: null })).toBeNull();
    expect(hubCardFor({ ...base, parent: null })).toBeNull();
  });
});
