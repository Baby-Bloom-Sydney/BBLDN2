import { describe, expect, it } from "vitest";
import { bookingDaysLeft, bookingDaysLeftLine, daysLeftLine } from "./booking-days-left";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = Date.parse("2026-11-11T09:00:00.000Z"); // 09:00 in London (GMT)
const iso = (ms: number) => new Date(ms).toISOString();
const row = (over: Partial<{ connectionStage: number | null; expiresAt: string | null; proposedTimes: string[] | null }> = {}) => ({
  connectionStage: 10,
  expiresAt: iso(NOW + 7 * DAY),
  proposedTimes: ["2026-11-18_evening"],
  ...over,
});

describe("bookingDaysLeft — days to book her meet and greet", () => {
  it("counts to the earlier of the expiry and her last time less 12 hours, rounded up", () => {
    // last time 18 Nov 19:45 London; less 12h = 18 Nov 07:45Z; the expiry (18 Nov 09:00Z) is later
    expect(bookingDaysLeft(row(), NOW)).toBe(7);
  });

  it("is capped by the expiry when that comes first", () => {
    expect(bookingDaysLeft(row({ expiresAt: iso(NOW + 2 * DAY + HOUR) }), NOW)).toBe(3);
  });

  it("is capped by her last offered time", () => {
    // 13 Nov evening: 19:45 London less 12h = 13 Nov 07:45Z, 46h45m from now
    expect(bookingDaysLeft(row({ proposedTimes: ["2026-11-12_morning", "2026-11-13_evening", "2026-11-12_midday"] }), NOW)).toBe(2);
  });

  it("reads 1 on the last day, never 0", () => {
    expect(bookingDaysLeft(row({ expiresAt: iso(NOW + HOUR) }), NOW)).toBe(1);
    expect(bookingDaysLeft(row({ expiresAt: iso(NOW + 1) }), NOW)).toBe(1);
    expect(bookingDaysLeft(row({ expiresAt: iso(NOW + DAY + 1) }), NOW)).toBe(2);
  });

  it("gives nothing once the time has passed", () => {
    expect(bookingDaysLeft(row({ expiresAt: iso(NOW) }), NOW)).toBeNull();
    expect(bookingDaysLeft(row({ proposedTimes: ["2026-11-11_evening"] }), NOW)).toBeNull();
  });

  it("is never more than 7", () => {
    expect(bookingDaysLeft(row({ expiresAt: iso(NOW + 20 * DAY), proposedTimes: ["2026-12-30_evening"] }), NOW)).toBe(7);
  });

  it("only counts a nanny who has accepted (stage 10)", () => {
    for (const stage of [0, 1, 9, 11, 20, null]) expect(bookingDaysLeft(row({ connectionStage: stage }), NOW)).toBeNull();
  });

  it("uses the expiry alone when no time is offered, and ignores a malformed slot", () => {
    expect(bookingDaysLeft(row({ proposedTimes: null, expiresAt: iso(NOW + 3 * DAY) }), NOW)).toBe(3);
    expect(bookingDaysLeft(row({ proposedTimes: ["nonsense", "2026-11-13_teatime"], expiresAt: iso(NOW + 3 * DAY) }), NOW)).toBe(3);
    expect(bookingDaysLeft(row({ expiresAt: null }), NOW)).toBeNull();
  });

  it("reads her times on the London clock across the October change", () => {
    const now = Date.parse("2026-10-24T07:00:00.000Z");
    // 25 Oct 19:45 London is 19:45Z (GMT from that morning); less 12h = 07:45Z, 24h45m from now → 2 (read as BST it
    // would be 06:45Z, 23h45m → 1)
    expect(bookingDaysLeft(row({ expiresAt: iso(now + 7 * DAY), proposedTimes: ["2026-10-25_evening"] }), now)).toBe(2);
  });
});

describe("the family's line", () => {
  it("says days, with 1 day singular", () => {
    expect(daysLeftLine("Sarah", 3)).toBe("3 days left to book your meet and greet with Sarah");
    expect(daysLeftLine("Sarah", 1)).toBe("1 day left to book your meet and greet with Sarah");
  });

  it("is built from the row, or nothing", () => {
    expect(bookingDaysLeftLine(row(), "Sarah", NOW)).toBe("7 days left to book your meet and greet with Sarah");
    expect(bookingDaysLeftLine(row({ connectionStage: 0 }), "Sarah", NOW)).toBeNull();
  });
});
