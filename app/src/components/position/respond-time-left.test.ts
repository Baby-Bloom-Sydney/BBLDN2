import { describe, expect, it } from "vitest";
import { respondTimeLeft } from "./respond-time-left";

const NOW = Date.parse("2026-11-11T09:00:00.000Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const at = (ms: number) => new Date(NOW + ms).toISOString();
const text = (ms: number) => respondTimeLeft(at(ms), NOW).text;

describe("respondTimeLeft — the nanny's countdown to reply", () => {
  it("shows whole days, rounded up, from 24 hours up", () => {
    expect(text(7 * DAY)).toBe("7 days to respond");
    expect(text(7 * DAY - MIN)).toBe("7 days to respond");
    expect(text(DAY + 1)).toBe("2 days to respond");
    expect(text(2 * DAY)).toBe("2 days to respond");
    expect(text(DAY)).toBe("1 day to respond");
  });

  it("never shows hours or minutes beside days", () => {
    for (const ms of [7 * DAY - MIN, 3 * DAY + 5 * HOUR, DAY + 30 * MIN]) expect(text(ms)).toMatch(/^\d+ days? to respond$/);
  });

  it("shows whole hours, rounded up and never 0, in the last day", () => {
    expect(text(DAY - MIN)).toBe("24h to respond");
    expect(text(23 * HOUR)).toBe("23h to respond");
    expect(text(5 * HOUR + 30 * MIN)).toBe("6h to respond");
    expect(text(HOUR)).toBe("1h to respond");
    expect(text(MIN)).toBe("1h to respond");
    expect(text(1)).toBe("1h to respond");
  });

  it("is urgent under 6 hours", () => {
    expect(respondTimeLeft(at(6 * HOUR), NOW).urgent).toBe(false);
    expect(respondTimeLeft(at(6 * HOUR - MIN), NOW).urgent).toBe(true);
    expect(respondTimeLeft(at(2 * DAY), NOW).urgent).toBe(false);
  });

  it("reads Expired at or past the time", () => {
    expect(respondTimeLeft(at(0), NOW)).toEqual({ text: "Expired", urgent: true, expired: true });
    expect(respondTimeLeft(at(-HOUR), NOW)).toEqual({ text: "Expired", urgent: true, expired: true });
  });
});
