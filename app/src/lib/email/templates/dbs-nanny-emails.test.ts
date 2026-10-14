/**
 * Unit 3g (BB-LDN-3g-141026) — the five DBS nanny email builders (brief change 1).
 * Copy deck §6.4 (VER-004-DBS), §6.5 (VER-010), §6.6 (re-check ×2), P-3 (re-check line), P-4 (rejected, proposed words).
 * The old-ladder words are spelled in pieces so this file never carries an Australian literal (LEDGER/2-0 §8(3)).
 */
import { describe, it, expect } from "vitest";
import {
  buildDbsManualReviewEmail,
  buildDbsBarredEmail,
  buildDbsRejectedEmail,
  buildDbsRecheckNewInfoEmail,
  buildDbsRecheckNoMatchEmail,
} from "./dbs-nanny-emails";
import { DBS_LINKS } from "@/lib/constants";

const APP = "https://app.example.test";
const base = { firstName: "Sophie", appUrl: APP };
const P3 = "Families you're already working with aren't affected.";

const builders = [
  ["VER-004-DBS", () => buildDbsManualReviewEmail(base)],
  ["VER-010", () => buildDbsBarredEmail(base)],
  ["DBS rejected (P-4)", () => buildDbsRejectedEmail({ ...base, reason: "Your DBS certificate image is unclear or unreadable" })],
  ["re-check NEW_INFO", () => buildDbsRecheckNewInfoEmail(base)],
  ["re-check NO_MATCH", () => buildDbsRecheckNoMatchEmail(base)],
] as const;

const OLD_WORDS = ["WW" + "CC", "O" + "CG", "Service " + "N" + "SW", "N" + "SW", "expired"];

describe("dbs-nanny-emails — VER-004-DBS (deck §6.4)", () => {
  it("returns the deck subject and the 24–48 hours paragraph", () => {
    const m = buildDbsManualReviewEmail(base);
    expect(m.subject).toBe("We're reviewing your DBS certificate");
    expect(m.html).toContain("We've received your certificate");
    expect(m.html).toContain("Hi Sophie, your DBS certificate has been sent to our team for a manual review.");
    expect(m.html).toContain(
      "We'll review everything and get back to you within 24–48 hours. No further action is needed from you right now.",
    );
    expect(m.html).toContain("You can check the status of your verification at any time from your dashboard.");
    expect(m.html).toContain(`${APP}/nanny/verification`);
    expect(m.html).toContain("View Status");
  });
});

describe("dbs-nanny-emails — VER-010 barred (deck §6.5, P-14)", () => {
  it("returns the deck subject and H1 and no regulator name", () => {
    const m = buildDbsBarredEmail(base);
    expect(m.subject).toBe("Important: Your Baby Bloom account has been restricted");
    expect(m.html).toContain("Your account has been restricted");
    expect(m.html).toContain("Hi Sophie, following a review of your DBS certificate, we've suspended your Baby Bloom account.");
    expect(m.html).toContain("Your profile is no longer visible to families.");
    expect(m.html).toContain("If you have questions, reply to this email and our team will get back to you.");
    expect(m.html).not.toMatch(/Office of the Children.s Guardian/);
  });

  it("never says hired positions or families stay (P-14: a bar drops every connection)", () => {
    const m = buildDbsBarredEmail(base);
    expect(m.html).not.toContain(P3);
    expect(m.html).not.toMatch(/aren.t affected|already working with/i);
  });
});

describe("dbs-nanny-emails — DBS rejected (P-4, proposed words; addendum: 22 = Edit & Resubmit only)", () => {
  it("returns the reason and a /nanny/verification CTA", () => {
    const m = buildDbsRejectedEmail({ ...base, reason: "Your DBS certificate image is unclear or unreadable" });
    expect(m.subject).toBe("Action needed: your DBS certificate wasn't approved");
    expect(m.html).toContain("We couldn't approve your DBS certificate");
    expect(m.html).toContain(
      "Hi Sophie, our team reviewed your DBS certificate and couldn't approve it. The reason: Your DBS certificate image is unclear or unreadable.",
    );
    expect(m.html).toContain(
      "To be approved, upload page 1 of your enhanced DBS certificate again — a clear, unedited photo or the PDF.",
    );
    expect(m.html).toContain(`href="${APP}/nanny/verification"`);
    expect(m.html).toContain("Fix it now");
  });

  it("offers no manual review (status 22 is Edit & Resubmit only)", () => {
    const m = buildDbsRejectedEmail({ ...base, reason: "r" });
    expect(m.html).not.toMatch(/manual review/i);
  });

  it("escapes the admin's reason and does not double the full stop", () => {
    const m = buildDbsRejectedEmail({ ...base, reason: "Surname <b>differs</b>." });
    expect(m.html).toContain("The reason: Surname &lt;b&gt;differs&lt;/b&gt;.");
    expect(m.html).not.toContain("differs&lt;/b&gt;..");
    expect(m.html).not.toContain("<b>differs</b>");
  });
});

describe("dbs-nanny-emails — re-check failure (deck §6.6, P-3)", () => {
  it("NEW_INFO returns the deck rows", () => {
    const m = buildDbsRecheckNewInfoEmail(base);
    expect(m.subject).toBe("Action needed: you'll need a new DBS certificate");
    expect(m.html).toContain("Your DBS certificate needs updating");
    expect(m.html).toContain(
      "Hi Sophie, we check every nanny's certificate with the DBS Update Service. Today's check shows there's new information since your certificate was issued, so we can't use it any more. It doesn't tell us what the information is.",
    );
    expect(m.html).toContain(
      "Until you upload a new certificate, you won't be matched with new families and you can't accept requests.",
    );
    for (const step of [
      "Apply for a new enhanced DBS.",
      "Join the Update Service when it arrives (within 30 days).",
      "Upload page 1 on your verification page.",
    ]) expect(m.html).toContain(step);
    expect(m.html).toContain("Upload new certificate");
  });

  it("NO_MATCH returns the deck rows", () => {
    const m = buildDbsRecheckNoMatchEmail(base);
    expect(m.subject).toBe("Action needed: we couldn't confirm your DBS certificate");
    expect(m.html).toContain("We couldn't find your certificate on the Update Service");
    expect(m.html).toContain(
      "Hi Sophie, we check every nanny's certificate with the DBS Update Service. Today it didn't find a match for yours. This usually means your Update Service subscription has ended.",
    );
    expect(m.html).toContain(
      "Until this is sorted, you won't be matched with new families and you can't accept requests.",
    );
    for (const step of [
      "Check your Update Service subscription is active (it renews yearly).",
      "If it has ended, you'll need a new enhanced DBS and to join again.",
      "Then upload page 1 on your verification page.",
    ]) expect(m.html).toContain(step);
    expect(m.html).toContain("Check my verification");
  });

  it.each([
    ["NEW_INFO", buildDbsRecheckNewInfoEmail],
    ["NO_MATCH", buildDbsRecheckNoMatchEmail],
  ])("%s says “won't be matched” and never “hidden”", (_name, build) => {
    const m = build(base);
    expect(m.html).toContain("won't be matched");
    expect(m.html).not.toMatch(/hidden/i);
  });

  it.each([
    ["NEW_INFO", buildDbsRecheckNewInfoEmail],
    ["NO_MATCH", buildDbsRecheckNoMatchEmail],
  ])("%s includes the P-3 “already working with aren't affected” line", (_name, build) => {
    const m = build(base);
    expect(m.html).toContain(
      `${P3} Any other requests and introductions you had in progress have been closed.`,
    );
  });

  it.each([
    ["NEW_INFO", buildDbsRecheckNewInfoEmail],
    ["NO_MATCH", buildDbsRecheckNoMatchEmail],
  ])("%s closes with the reply / manual-review line and a /nanny/verification CTA", (_name, build) => {
    const m = build(base);
    expect(m.html).toContain(
      "If you think this is a mistake, reply to this email or request a manual review from your verification page.",
    );
    expect(m.html).toContain(`href="${APP}/nanny/verification"`);
  });

  it("links to DBS_LINKS.getEnhanced when building NEW_INFO", () => {
    const m = buildDbsRecheckNewInfoEmail(base);
    expect(m.html).toContain(`href="${DBS_LINKS.getEnhanced}"`);
    expect(m.html).toContain("Get an enhanced DBS");
    expect(m.html).not.toContain(DBS_LINKS.joinUpdateService + '"');
  });

  it("links to DBS_LINKS.joinUpdateService when building NO_MATCH", () => {
    const m = buildDbsRecheckNoMatchEmail(base);
    expect(m.html).toContain(`href="${DBS_LINKS.joinUpdateService}"`);
    expect(m.html).toContain("Join the Update Service");
    expect(m.html).not.toContain(DBS_LINKS.getEnhanced);
  });
});

describe("dbs-nanny-emails — shared rules", () => {
  it.each(builders)("%s escapes a first name containing <script>", (_name, build) => {
    void build;
    const evil = { firstName: "<script>alert(1)</script>", appUrl: APP };
    const all = [
      buildDbsManualReviewEmail(evil),
      buildDbsBarredEmail(evil),
      buildDbsRejectedEmail({ ...evil, reason: "r" }),
      buildDbsRecheckNewInfoEmail(evil),
      buildDbsRecheckNoMatchEmail(evil),
    ];
    for (const m of all) {
      expect(m.html).not.toContain("<script>");
      expect(m.html).toContain("&lt;script&gt;");
    }
  });

  it.each(builders)("%s contains no old-ladder word", (_name, build) => {
    const { subject, html } = build();
    for (const w of OLD_WORDS) {
      expect(subject, w).not.toContain(w);
      expect(html, w).not.toContain(w);
    }
  });

  it.each(builders)("%s ends with the shared email footer", (_name, build) => {
    const { html } = build();
    expect(html).toContain("/legal/privacy-policy");
    expect(html).toContain("/legal/professional-terms");
  });
});
