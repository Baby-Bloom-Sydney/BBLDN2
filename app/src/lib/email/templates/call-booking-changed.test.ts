/**
 * call_booking_changed (brief §0.3 "Change time", §0.11; plan B1): the new London time, the old one, the caller
 * line only when set; escaped name; nothing says free.
 */
import { describe, expect, it } from "vitest";
import { buildCallBookingChangedEmail } from "./call-booking-changed";

const base = {
  firstName: "Jane",
  startsAt: "2027-02-09T14:00:00.000Z",
  fromStartsAt: "2027-02-08T10:30:00.000Z",
  callerNumber: "+447700900123",
};

describe("buildCallBookingChangedEmail", () => {
  it("subject names the call and the new day and time", () => {
    expect(buildCallBookingChangedEmail(base).subject).toBe("Your Complimentary matchmaker call has moved: Tuesday 9 February, 14:00");
  });

  it("body gives the new time, the old time and the change link", () => {
    const { html } = buildCallBookingChangedEmail(base);
    expect(html).toContain("Your Complimentary matchmaker call is on Tuesday 9 February at 14:00");
    expect(html).toContain("It was Monday 8 February at 10:30.");
    expect(html).toMatch(/href="https?:\/\/[^"]+\/matchmaking\/call"/);
  });

  it("names the caller number only when set; escapes her name; never says free", () => {
    expect(buildCallBookingChangedEmail(base).html).toContain("We'll call you from +44 (0) 7700 900 123.");
    expect(buildCallBookingChangedEmail({ ...base, callerNumber: null }).html).not.toContain("call you from");
    expect(buildCallBookingChangedEmail({ ...base, firstName: "<i>j</i>" }).html).toContain("&lt;i&gt;j&lt;/i&gt;");
    const { subject, html } = buildCallBookingChangedEmail(base);
    expect(`${subject} ${html}`).not.toMatch(/\bfree\b|\bintro\b|track/i);
  });
});

// 04b rework W14 (BAI 2026-11-05: "It also does not need to state 'london time' anywhere"): parent emails don't say it.
describe("no 'London time' in the parent's email (W14)", () => {
  it("the subject and body never say London", () => {
    const { subject, html } = buildCallBookingChangedEmail(base);
    expect(`${subject} ${html}`).not.toMatch(/London/);
  });
});
