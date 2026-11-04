/**
 * call_booking_cancelled (brief §3 parent 4, §0.11; plan B1): the cancelled London time, "we'll still call you",
 * a link to pick a new time; caller line only when set; escaped name; nothing says free.
 */
import { describe, expect, it } from "vitest";
import { buildCallBookingCancelledEmail } from "./call-booking-cancelled";

const base = { firstName: "Jane", startsAt: "2027-02-09T14:00:00.000Z", callerNumber: "+447700900123" };

describe("buildCallBookingCancelledEmail", () => {
  it("subject names the call and the cancelled time", () => {
    expect(buildCallBookingCancelledEmail(base).subject).toBe("Your Complimentary matchmaker call on Tuesday 9 February, 14:00 is cancelled");
  });

  it("body says which time is cancelled, that we'll still call, and links to pick again", () => {
    const { html } = buildCallBookingCancelledEmail(base);
    expect(html).toContain("Your Complimentary matchmaker call on Tuesday 9 February at 14:00 (London time) is cancelled.");
    expect(html).toContain("still call you");
    expect(html).toMatch(/href="https?:\/\/[^"]+\/parent\/call"/);
  });

  it("names the caller number only when set; escapes her name; never says free", () => {
    expect(buildCallBookingCancelledEmail(base).html).toContain("We'll call you from +44 (0) 7700 900 123.");
    expect(buildCallBookingCancelledEmail({ ...base, callerNumber: null }).html).not.toContain("call you from");
    expect(buildCallBookingCancelledEmail({ ...base, firstName: "<i>j</i>" }).html).toContain("&lt;i&gt;j&lt;/i&gt;");
    const { subject, html } = buildCallBookingCancelledEmail(base);
    expect(`${subject} ${html}`).not.toMatch(/\bfree\b|\bintro\b|track/i);
  });
});
