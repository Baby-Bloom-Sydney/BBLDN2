import { describe, expect, it } from "vitest";
import { respondTimeLeft } from "./respond-time-left";

const NOW = Date.parse("2026-11-11T09:00:00.000Z");
const MIN = 60_000;
const HOUR = 60 * MIN;
const at = (ms: number) => new Date(NOW + ms).toISOString();

describe("respondTimeLeft — the nanny's countdown to reply", () => {
  it("shows days and hours from 24 hours up, never 167h", () => {
    expect(respondTimeLeft(at(7 * 24 * HOUR - MIN), NOW)).toEqual({ text: "6d 23h to respond", urgent: false, expired: false });
    expect(respondTimeLeft(at(24 * HOUR), NOW)).toEqual({ text: "1d 0h to respond", urgent: false, expired: false });
    expect(respondTimeLeft(at(7 * 24 * HOUR - MIN), NOW).text).not.toContain("167h");
  });

  it("stays as before under 24 hours", () => {
    expect(respondTimeLeft(at(24 * HOUR - MIN), NOW)).toEqual({ text: "23h 59m to respond", urgent: false, expired: false });
    expect(respondTimeLeft(at(5 * HOUR + 30 * MIN), NOW)).toEqual({ text: "5h 30m to respond", urgent: true, expired: false });
    expect(respondTimeLeft(at(59 * MIN), NOW)).toEqual({ text: "59m to respond", urgent: true, expired: false });
  });

  it("reads Expired at or past the time", () => {
    expect(respondTimeLeft(at(0), NOW)).toEqual({ text: "Expired", urgent: true, expired: true });
    expect(respondTimeLeft(at(-HOUR), NOW)).toEqual({ text: "Expired", urgent: true, expired: true });
  });
});
