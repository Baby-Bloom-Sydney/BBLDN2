/**
 * admin_call_reminder (brief §0.7; plan B1, §12 R18): 15 minutes before each call. "matchmaker call", the name,
 * the London time and the /admin/calls link only.
 */
import { describe, expect, it } from "vitest";
import { buildCallAdminReminderEmail } from "./call-admin-reminder";

const base = { parentName: "Jane Smith", startsAt: "2027-02-09T14:00:00.000Z" };

describe("buildCallAdminReminderEmail", () => {
  it("subject: matchmaker call soon, name, short London time", () => {
    expect(buildCallAdminReminderEmail(base).subject).toBe("Matchmaker call soon: Jane Smith, Tue 9 Feb, 14:00");
  });

  it("body: name, full London time, the calls link; no phone or email; never Complimentary", () => {
    const { subject, html } = buildCallAdminReminderEmail(base);
    expect(html).toContain("Jane Smith");
    expect(html).toContain("Tuesday 9 February, 14:00 (London time)");
    expect(html).toMatch(/href="https?:\/\/[^"]+\/admin\/calls"/);
    expect(html).not.toMatch(/\+44|07\d{3}|@/);
    expect(`${subject} ${html}`).not.toMatch(/Complimentary|\bfree\b|\bintro\b/i);
  });

  it("escapes the name; one-line subject", () => {
    const email = buildCallAdminReminderEmail({ ...base, parentName: "<b>Jo</b>\nX" });
    expect(email.html).toContain("&lt;b&gt;Jo&lt;/b&gt;");
    expect(email.subject).not.toMatch(/[\r\n]/);
  });
});
