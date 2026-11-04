/**
 * call_reminder (brief §0.7; plan B1): sent 24 hours before; the London day and time, the caller line only when
 * set, a link to change or cancel; escaped name; nothing says free.
 */
import { describe, expect, it } from "vitest";
import { buildCallReminderEmail } from "./call-reminder";

const base = { firstName: "Jane", startsAt: "2027-02-09T14:00:00.000Z", callerNumber: "+447700900123" };

describe("buildCallReminderEmail", () => {
  it("subject names the call, the day and the time", () => {
    expect(buildCallReminderEmail(base).subject).toBe("Reminder: your Complimentary matchmaker call, Tuesday 9 February, 14:00");
  });

  it("body gives the London time and the change link", () => {
    const { html } = buildCallReminderEmail(base);
    expect(html).toContain("Your Complimentary matchmaker call is on Tuesday 9 February at 14:00 (London time)");
    expect(html).toMatch(/href="https?:\/\/[^"]+\/matchmaking\/call"/);
  });

  it("names the caller number only when set; escapes her name; never says free", () => {
    expect(buildCallReminderEmail(base).html).toContain("We'll call you from +44 (0) 7700 900 123.");
    expect(buildCallReminderEmail({ ...base, callerNumber: null }).html).not.toContain("call you from");
    expect(buildCallReminderEmail({ ...base, firstName: "<i>j</i>" }).html).toContain("&lt;i&gt;j&lt;/i&gt;");
    const { subject, html } = buildCallReminderEmail(base);
    expect(`${subject} ${html}`).not.toMatch(/\bfree\b|\bintro\b|track/i);
  });
});
