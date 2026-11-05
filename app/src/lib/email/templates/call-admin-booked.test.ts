/**
 * admin_call_booked (brief §0.3; plan B1, §12 R18): says "matchmaker call" (never "Complimentary"); the body holds
 * only the parent's name, the London time and an /admin/calls link — no phone number, no email address.
 */
import { describe, expect, it } from "vitest";
import { buildCallAdminBookedEmail } from "./call-admin-booked";

const base = { parentName: "Jane Smith", startsAt: "2027-02-09T14:00:00.000Z" };

describe("buildCallAdminBookedEmail", () => {
  it("subject: new matchmaker call, name, short London time", () => {
    expect(buildCallAdminBookedEmail(base).subject).toBe("New matchmaker call booked: Jane Smith, Tue 9 Feb, 14:00");
  });

  it("body: name, full London time, the calls link; never Complimentary", () => {
    const { subject, html } = buildCallAdminBookedEmail(base);
    expect(html).toContain("Jane Smith");
    expect(html).toContain("Tuesday 9 February, 14:00 (London time)");
    expect(html).toMatch(/href="https?:\/\/[^"]+\/admin\/calls"/);
    expect(`${subject} ${html}`).toMatch(/matchmaker call/);
    expect(`${subject} ${html}`).not.toMatch(/Complimentary|\bfree\b|\bintro\b/i);
  });

  it("carries no phone number or email address (R18: email_logs stores the full HTML)", () => {
    const { html } = buildCallAdminBookedEmail(base);
    expect(html).not.toMatch(/\+44|07\d{3}|@/);
  });

  it("escapes the name in the body and keeps the subject on one line", () => {
    const email = buildCallAdminBookedEmail({ ...base, parentName: "<b>Jo</b>\r\nBcc: x" });
    expect(email.html).toContain("&lt;b&gt;Jo&lt;/b&gt;");
    expect(email.subject).not.toMatch(/[\r\n]/);
  });
});
