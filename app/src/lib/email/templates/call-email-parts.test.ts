/**
 * The shared parts of the call emails (plan B1): HTML escaping, one-line subjects, the caller line (only when the
 * setting is set), the email types, and the shell (brand header; the client footer on parent emails only).
 */
import { describe, expect, it } from "vitest";
import {
  ADMIN_CALLS_URL,
  CALL_EMAIL_TYPES,
  CALL_PAGE_URL,
  callEmailShell,
  callerLine,
  escapeHtml,
  escapeText,
  oneLine,
} from "./call-email-parts";

describe("escapeHtml / oneLine", () => {
  it("escapes the five HTML characters", () => {
    expect(escapeHtml(`<b>"Jo" & 'Al'</b>`)).toBe("&lt;b&gt;&quot;Jo&quot; &amp; &#39;Al&#39;&lt;/b&gt;");
  });

  it("escapes text for a text node (& < >), leaving quotes readable", () => {
    expect(escapeText(`<b>We'll "see" & go</b>`)).toBe(`&lt;b&gt;We'll "see" &amp; go&lt;/b&gt;`);
  });

  it("collapses line breaks and runs of space, so a name can't add a header line to a subject", () => {
    expect(oneLine("Jane\r\nBcc: x@example.com  Smith ")).toBe("Jane Bcc: x@example.com Smith");
  });
});

describe("callerLine", () => {
  it("names the number we call from, formatted, when the setting is set", () => {
    expect(callerLine("+447700900123")).toBe("We'll call you from +44 (0) 7700 900 123.");
    expect(callerLine("+442079460000")).toBe("We'll call you from +442079460000.");
  });

  it("is left out while the setting is empty", () => {
    expect(callerLine(null)).toBeNull();
    expect(callerLine("")).toBeNull();
  });
});

describe("the email types and links", () => {
  it("are the seven brief §5 types", () => {
    expect(Object.values(CALL_EMAIL_TYPES).sort()).toEqual([
      "admin_call_booked",
      "admin_call_reminder",
      "call_booking_cancelled",
      "call_booking_changed",
      "call_booking_confirmation",
      "call_not_booked",
      "call_reminder",
    ]);
  });

  it("link to the call page and the admin calls page on the site", () => {
    expect(CALL_PAGE_URL).toMatch(/^https?:\/\/[^/]+\/matchmaking\/call$/);
    expect(ADMIN_CALLS_URL).toMatch(/^https?:\/\/[^/]+\/admin\/calls$/);
  });
});

describe("callEmailShell", () => {
  const body = { heading: "Heading", paragraphs: ["One.", "Two."], button: { label: "Go", href: "https://example.test/a?b=1&c=2" } };

  it("a parent email has the brand header, the paragraphs, an escaped button link and the client footer", () => {
    const html = callEmailShell({ ...body, audience: "parent" });
    expect(html).toContain("<!DOCTYPE html>");
    expect(html).toContain("Heading");
    expect(html).toContain("<p");
    expect(html).toContain("One.");
    expect(html).toContain('href="https://example.test/a?b=1&amp;c=2"');
    expect(html).toContain("/legal/client-terms");
  });

  it("escapes every text it is given — heading, paragraphs and the button label", () => {
    const html = callEmailShell({ heading: "<h>", paragraphs: ["<p>x</p>"], button: { label: "<l>", href: "https://x.test" }, audience: "admin" });
    expect(html).toContain("&lt;h&gt;");
    expect(html).toContain("&lt;p&gt;x&lt;/p&gt;");
    expect(html).toContain("&lt;l&gt;");
  });

  it("an admin email has no legal footer", () => {
    const html = callEmailShell({ ...body, audience: "admin" });
    expect(html).toContain("Heading");
    expect(html).not.toContain("/legal/");
  });

  it("a button is optional", () => {
    expect(callEmailShell({ heading: "H", paragraphs: ["P"], audience: "admin" })).not.toContain("<a ");
  });
});
