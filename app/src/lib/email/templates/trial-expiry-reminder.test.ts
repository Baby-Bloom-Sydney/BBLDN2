/**
 * Trial-expiry T-5 reminder (S17) — 4g copy (cards 9a/9b, 2c).
 *
 * The "£100 of every payment supports your nanny" line is gone with nothing in its place; the email never says
 * "free" and carries no amount; the date stays British. Who receives it (self-serve trial rows only) is pinned in
 * `api/cron/trial-reminders/route.test.ts`.
 */
import { describe, expect, it } from "vitest";
import { buildTrialExpiryReminderEmail } from "./trial-expiry-reminder";

const params = {
  firstName: "Amy",
  childFirstName: "Lily",
  trialEndsAt: "2026-11-14T12:00:00.000Z",
  appUrl: "https://example.test",
  childId: "00000000-0000-0000-0000-000000000abc",
};

describe("buildTrialExpiryReminderEmail", () => {
  it("has no '£100 supports your nanny' line and no amount at all", () => {
    const { html, subject } = buildTrialExpiryReminderEmail(params);
    expect(html).not.toMatch(/supports your nanny/i);
    expect(`${subject}${html}`).not.toMatch(/£/);
  });

  it("never says 'free' or 'track'", () => {
    const { html, subject } = buildTrialExpiryReminderEmail(params);
    const text = `${subject} ${html}`.toLowerCase();
    expect(text).not.toMatch(/\bfree\b/);
    expect(text).not.toMatch(/\btrack(ing|ed|s)?\b/);
  });

  it("keeps the British date, the names and the subscribe link", () => {
    const { html } = buildTrialExpiryReminderEmail(params);
    expect(html).toContain("14 November 2026");
    expect(html).toContain("Amy, your trial ends in 5 days");
    expect(html).toContain("Lily's development");
    expect(html).toContain(
      "https://example.test/parent/subscribe?childId=00000000-0000-0000-0000-000000000abc",
    );
  });

  it("escapes the names", () => {
    const { html } = buildTrialExpiryReminderEmail({
      ...params,
      firstName: "<b>x</b>",
    });
    expect(html).toContain("&lt;b&gt;x&lt;/b&gt;");
  });
});
