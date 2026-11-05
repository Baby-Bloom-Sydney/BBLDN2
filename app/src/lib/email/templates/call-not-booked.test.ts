/**
 * call_not_booked (brief §0.4; plan B1, §12 R2): "Pick a time … — we'll call you either way", a link back to
 * /matchmaking/call (04b rework W1); caller line only when set; escaped name; nothing says free.
 */
import { describe, expect, it } from "vitest";
import { buildCallNotBookedEmail } from "./call-not-booked";

const base = { firstName: "Jane", callerNumber: "+447700900123" };

describe("buildCallNotBookedEmail", () => {
  it("subject is the brief's line", () => {
    expect(buildCallNotBookedEmail(base).subject).toBe("Pick a time for your Complimentary matchmaker call — we'll call you either way");
  });

  it("body links back to the call page", () => {
    const { html } = buildCallNotBookedEmail(base);
    expect(html).toContain("Complimentary matchmaker call");
    expect(html).toMatch(/href="https?:\/\/[^"]+\/matchmaking\/call"/);
  });

  it("names the caller number only when set; escapes her name; never says free", () => {
    expect(buildCallNotBookedEmail(base).html).toContain("We'll call you from +44 (0) 7700 900 123.");
    expect(buildCallNotBookedEmail({ ...base, callerNumber: null }).html).not.toContain("call you from");
    expect(buildCallNotBookedEmail({ ...base, firstName: "<i>j</i>" }).html).toContain("&lt;i&gt;j&lt;/i&gt;");
    const { subject, html } = buildCallNotBookedEmail(base);
    expect(`${subject} ${html}`).not.toMatch(/\bfree\b|\bintro\b|track/i);
  });
});

// 04b rework W14 (BAI 2026-11-05: "It also does not need to state 'london time' anywhere"): parent emails don't say it.
describe("no 'London time' in the parent's email (W14)", () => {
  it("the subject and body never say London", () => {
    const { subject, html } = buildCallNotBookedEmail(base);
    expect(`${subject} ${html}`).not.toMatch(/London/);
  });
});
