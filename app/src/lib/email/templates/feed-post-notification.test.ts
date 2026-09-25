import { describe, it, expect } from "vitest";
import { buildFeedPostNotificationEmail } from "./feed-post-notification";
import { SITE_NAME } from "@/lib/constants";

const PARAMS = {
  nannyFirstName: "Sarah",
  childFirstName: "Olivia",
  childId: "11111111-2222-3333-4444-555555555555",
  appUrl: "https://app.example.com",
};

describe("buildFeedPostNotificationEmail — subject", () => {
  it("uses the primary form when both names are supplied", () => {
    const { subject } = buildFeedPostNotificationEmail(PARAMS);
    expect(subject).toBe("Sarah posted to Olivia's feed");
  });

  it("falls back to child-anchored wording when nanny name is null", () => {
    const { subject } = buildFeedPostNotificationEmail({
      ...PARAMS,
      nannyFirstName: null,
    });
    expect(subject).toBe("New post on Olivia's feed");
  });

  it("falls back to nanny-anchored wording when child name is null", () => {
    const { subject } = buildFeedPostNotificationEmail({
      ...PARAMS,
      childFirstName: null,
    });
    expect(subject).toBe("Sarah posted a new update");
  });

  it("falls back to fully-neutral wording when both names are null", () => {
    const { subject } = buildFeedPostNotificationEmail({
      ...PARAMS,
      nannyFirstName: null,
      childFirstName: null,
    });
    expect(subject).toBe("New post on your child's feed");
  });
});

describe("buildFeedPostNotificationEmail — HTML body sentence", () => {
  it("includes the primary one-sentence message with both names", () => {
    const { html } = buildFeedPostNotificationEmail(PARAMS);
    expect(html).toContain("Sarah has just posted to Olivia");
    expect(html.toLowerCase()).toContain("check it out");
  });

  it("falls back to neutral body when nanny name is null", () => {
    const { html } = buildFeedPostNotificationEmail({
      ...PARAMS,
      nannyFirstName: null,
    });
    expect(html).toContain("a new post on Olivia");
    expect(html).not.toContain("Sarah");
  });

  it("falls back to neutral body when child name is null", () => {
    const { html } = buildFeedPostNotificationEmail({
      ...PARAMS,
      childFirstName: null,
    });
    expect(html).toContain("Sarah has just posted a new update");
    expect(html).not.toContain("Olivia");
  });

  it("falls back to fully-neutral body when both names are null", () => {
    const { html } = buildFeedPostNotificationEmail({
      ...PARAMS,
      nannyFirstName: null,
      childFirstName: null,
    });
    expect(html).toContain("a new post on your child");
    expect(html).not.toContain("Sarah");
    expect(html).not.toContain("Olivia");
  });
});

describe("buildFeedPostNotificationEmail — link", () => {
  it("composes the feed URL from appUrl + childId", () => {
    const { html } = buildFeedPostNotificationEmail(PARAMS);
    expect(html).toContain(
      "https://app.example.com/parent/development/11111111-2222-3333-4444-555555555555",
    );
  });

  it("URL-encodes the childId defensively (defence-in-depth, even though child_client.id is a UUID)", () => {
    const { html } = buildFeedPostNotificationEmail({
      ...PARAMS,
      childId: "weird id?with&chars",
    });
    expect(html).toContain("/parent/development/weird%20id%3Fwith%26chars");
    expect(html).not.toContain("/parent/development/weird id?with&chars");
  });

  it("CTA text references the child by first name when available", () => {
    const { html } = buildFeedPostNotificationEmail(PARAMS);
    expect(html).toContain("Open Olivia");
  });

  it("CTA text falls back to 'Open the feed' when child name is null", () => {
    const { html } = buildFeedPostNotificationEmail({
      ...PARAMS,
      childFirstName: null,
    });
    expect(html).toContain("Open the feed");
  });
});

describe("buildFeedPostNotificationEmail — escaping (defence against XSS via user-supplied names)", () => {
  it("escapes nanny name with dangerous characters", () => {
    const { html } = buildFeedPostNotificationEmail({
      ...PARAMS,
      nannyFirstName: "<script>alert('x')</script>",
    });
    expect(html).not.toContain("<script>alert('x')</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("escapes child name with dangerous characters", () => {
    const { html } = buildFeedPostNotificationEmail({
      ...PARAMS,
      childFirstName: "<img onerror=evil>",
    });
    expect(html).not.toContain("<img onerror=evil>");
    expect(html).toContain("&lt;img");
  });

  it("escapes ampersands in names", () => {
    const { html } = buildFeedPostNotificationEmail({
      ...PARAMS,
      nannyFirstName: "A&B",
    });
    expect(html).toContain("A&amp;B");
  });
});

describe("buildFeedPostNotificationEmail — plain-text fallback", () => {
  it("contains the same one-sentence message as the HTML", () => {
    const { text } = buildFeedPostNotificationEmail(PARAMS);
    expect(text).toContain(
      "Sarah has just posted to Olivia's feed on Baby Bloom",
    );
    expect(text).toContain("check it out");
  });

  it("contains the feed URL on its own line", () => {
    const { text } = buildFeedPostNotificationEmail(PARAMS);
    expect(text).toContain(
      "\nhttps://app.example.com/parent/development/11111111-2222-3333-4444-555555555555",
    );
  });

  it("uses the same NULL fallback variant as the HTML body (both null)", () => {
    const { text } = buildFeedPostNotificationEmail({
      ...PARAMS,
      nannyFirstName: null,
      childFirstName: null,
    });
    expect(text).toContain("There's a new post on your child's feed");
  });

  it("uses unescaped characters in plain-text (no HTML entities)", () => {
    const { text } = buildFeedPostNotificationEmail(PARAMS);
    expect(text).not.toContain("&apos;");
    expect(text).not.toContain("&mdash;");
    expect(text).toContain("Olivia's");
  });
});

describe("buildFeedPostNotificationEmail — branding + footer", () => {
  it("renders the BabyBloom wordmark with the spec-exact two-color split", () => {
    const { html } = buildFeedPostNotificationEmail(PARAMS);
    // Pin the exact structure per spec §4.2 — "Baby" in slate-900, "Bloom" in
    // violet-500 — so a future CSS refactor can't silently desync the mark.
    expect(html).toContain(
      '<span style="color:#0f172a;">Baby</span><span style="color:#8b5cf6;">Bloom</span>',
    );
  });

  it("includes the privacy + terms links (transactional email footer)", () => {
    const { html } = buildFeedPostNotificationEmail(PARAMS);
    expect(html).toContain("/legal/privacy-policy");
    expect(html).toContain("/legal/client-terms");
  });

  it("attributes the footer to the configured product name", () => {
    const { html } = buildFeedPostNotificationEmail(PARAMS);
    expect(html).toContain(SITE_NAME);
  });
});

describe("buildFeedPostNotificationEmail — terminology discipline", () => {
  it("does not use surveillance terminology anywhere in subject, html, or text", () => {
    // Memory: feedback_never_use_tracking_terminology — "follow" / "see" /
    // "check" only; never "track" / "tracking" / "surveillance".
    const { subject, html, text } = buildFeedPostNotificationEmail(PARAMS);
    const combined = `${subject}\n${html}\n${text}`.toLowerCase();
    expect(combined).not.toMatch(/\btracking\b/);
    expect(combined).not.toMatch(/\bsurveillance\b/);
    // The bare verb "track" is also banned (per memory)
    expect(combined).not.toMatch(/\btrack\b/);
  });
});
