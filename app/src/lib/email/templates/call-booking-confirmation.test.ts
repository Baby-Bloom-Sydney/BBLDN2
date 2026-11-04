/**
 * call_booking_confirmation (brief §0.3, §9.3; plan B1): names the Complimentary matchmaker call, the London day
 * and time, and the number we call from only when it is set. Names are escaped; nothing says the placement is free.
 */
import { describe, expect, it } from "vitest";
import { buildCallBookingConfirmationEmail } from "./call-booking-confirmation";

const TUE_14 = "2027-02-09T14:00:00.000Z";
const base = { firstName: "Jane", startsAt: TUE_14, callerNumber: "+447700900123" };

describe("buildCallBookingConfirmationEmail", () => {
  it("subject names the call, the day and the time (brief §0.3)", () => {
    expect(buildCallBookingConfirmationEmail(base).subject).toBe("Your Complimentary matchmaker call: Tuesday 9 February, 14:00");
  });

  it("body says the London time in full and links to change or cancel", () => {
    const { html } = buildCallBookingConfirmationEmail(base);
    expect(html).toContain("Your Complimentary matchmaker call is on Tuesday 9 February at 14:00");
    expect(html).toMatch(/href="https?:\/\/[^"]+\/matchmaking\/call"/);
  });

  it("names the caller number only when the setting is set", () => {
    expect(buildCallBookingConfirmationEmail(base).html).toContain("We'll call you from +44 (0) 7700 900 123.");
    expect(buildCallBookingConfirmationEmail({ ...base, callerNumber: null }).html).not.toContain("call you from");
  });

  it("escapes her name", () => {
    const { html } = buildCallBookingConfirmationEmail({ ...base, firstName: "<b>x</b>" });
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
    expect(html).not.toContain("<b>x</b>");
  });

  it("never says free, intro or tracking", () => {
    const { subject, html } = buildCallBookingConfirmationEmail(base);
    expect(`${subject} ${html}`).not.toMatch(/\bfree\b|\bintro\b|track/i);
  });
});

// 04b rework W14 (BAI 2026-11-05: "It also does not need to state 'london time' anywhere"): parent emails don't say it.
describe("no 'London time' in the parent's email (W14)", () => {
  it("the subject and body never say London", () => {
    const { subject, html } = buildCallBookingConfirmationEmail(base);
    expect(`${subject} ${html}`).not.toMatch(/London/);
  });
});
