/**
 * The booking status lattice (plan A5; LDN1 `status-lattice.ts` with fewer statuses):
 * held → booked | cancelled; booked → booked (a move) | cancelled | done | no_answer; the rest are terminal.
 */
import { describe, expect, it } from "vitest";
import { BOOKING_STATUSES, canMoveStatus, everBooked, occupiesSlot } from "./status";

const NOW = new Date("2027-02-04T10:00:00.000Z");

describe("canMoveStatus", () => {
  it.each([
    ["held", "booked", true],
    ["held", "cancelled", true],
    ["held", "done", false],
    ["held", "no_answer", false],
    ["booked", "booked", true],
    ["booked", "cancelled", true],
    ["booked", "done", true],
    ["booked", "no_answer", true],
    ["booked", "held", false],
    ["cancelled", "booked", false],
    ["done", "no_answer", false],
    ["no_answer", "booked", false],
  ] as const)("%s → %s: %s", (from, to, ok) => {
    expect(canMoveStatus(from, to)).toBe(ok);
  });

  it("knows exactly the five statuses amendment 19 allows", () => {
    expect(BOOKING_STATUSES).toEqual(["held", "booked", "cancelled", "done", "no_answer"]);
  });
});

describe("occupiesSlot — what keeps a time from being offered", () => {
  it.each([
    [{ status: "booked", holdExpiresAt: null }, true],
    [{ status: "held", holdExpiresAt: "2027-02-04T10:04:00.000Z" }, true],
    [{ status: "held", holdExpiresAt: "2027-02-04T10:00:00.000Z" }, false],
    [{ status: "held", holdExpiresAt: null }, false],
    [{ status: "cancelled", holdExpiresAt: null }, false],
    [{ status: "done", holdExpiresAt: null }, false],
    [{ status: "no_answer", holdExpiresAt: null }, false],
  ] as const)("%j → %s", (facts, expected) => {
    expect(occupiesSlot(facts, NOW)).toBe(expected);
  });
});

describe("everBooked (plan R2: a real booking, not a hold that never confirmed)", () => {
  it.each([
    [{ bookedAt: "2027-02-04T09:00:00.000Z" }, true],
    [{ bookedAt: null }, false],
  ])("%j → %s", (facts, expected) => {
    expect(everBooked(facts)).toBe(expected);
  });
});
