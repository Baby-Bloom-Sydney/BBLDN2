/**
 * deposit_link — BAI's "Email deposit link" (plan 03 row B1; brief 03 §0.1, §3 Admin 3). Placeholder copy BAI edits
 * before switch-on (brief Q4). One button to the family's `<SITE_URL>/deposit/<code>`; the brand from `SITE_NAME`;
 * her first name and the LINK_URL escaped; no amount written (the money-literal gate); the shared header and footer.
 */
import { describe, expect, it } from "vitest";
import { SITE_NAME, SITE_URL } from "@/lib/constants";
import { emailFooter, emailHeader } from "@/lib/email/brand";
import { depositLinkEmail } from "./deposit-link";

const CODE = "Ab0_-".repeat(8) + "xyz";
const LINK_URL = `${SITE_URL}/deposit/${CODE}`;
const FOOTER = emailFooter({ terms: "client", termsLabel: "Terms of Service" });
/** A pound sign then a digit, built so this file holds no such pair itself (the money-literal gate). */
const AMOUNT_LITERAL = new RegExp("£\\s*\\d");

const hrefsOf = (html: string): string[] => Array.from(html.matchAll(/href="([^"]*)"/g), (m) => m[1]);
const occurrences = (html: string, needle: string): number => html.split(needle).length - 1;

describe("depositLinkEmail — subject", () => {
  it("names the deposit and the brand, on one line, with no name in it", () => {
    const { subject } = depositLinkEmail({ firstName: "Sarah", url: LINK_URL });
    expect(subject).toContain(SITE_NAME);
    expect(subject.toLowerCase()).toContain("deposit");
    expect(subject).not.toMatch(/[\r\n]/);
    expect(subject).not.toContain("Sarah");
  });

  it("is the same whoever it goes to", () => {
    expect(depositLinkEmail({ firstName: "Sarah", url: LINK_URL }).subject).toBe(depositLinkEmail({ firstName: null, url: LINK_URL }).subject);
  });
});

describe("depositLinkEmail — the one button", () => {
  it("has exactly one link besides the footer's legal links, and it is the given LINK_URL", () => {
    const { html } = depositLinkEmail({ firstName: "Sarah", url: LINK_URL });
    const body = html.replace(FOOTER, "");
    expect(hrefsOf(body)).toEqual([LINK_URL]);
    expect(occurrences(body, "<a ")).toBe(1);
    expect(occurrences(html, LINK_URL)).toBe(1);
    expect(hrefsOf(html).filter((h) => !h.startsWith(`${SITE_URL}/legal/`))).toEqual([LINK_URL]);
  });

  it("a LINK_URL carrying a quote or an angle bracket can't break out of the attribute", () => {
    const hostile = `${SITE_URL}/deposit/x" onmouseover="alert(1)"><script>alert(2)</script>`;
    const { html } = depositLinkEmail({ firstName: "Sarah", url: hostile });
    const body = html.replace(FOOTER, "");
    expect(hrefsOf(body)).toEqual([`${SITE_URL}/deposit/x&quot; onmouseover=&quot;alert(1)&quot;&gt;&lt;script&gt;alert(2)&lt;/script&gt;`]);
    expect(html).not.toContain("<script");
    expect(html).not.toContain('" onmouseover="');
  });

  it("an apostrophe or ampersand in the LINK_URL is escaped too", () => {
    const { html } = depositLinkEmail({ firstName: null, url: `${SITE_URL}/deposit/a'b&c` });
    expect(hrefsOf(html.replace(FOOTER, ""))).toEqual([`${SITE_URL}/deposit/a&#39;b&amp;c`]);
  });
});

describe("depositLinkEmail — the greeting", () => {
  it("greets her by first name", () => {
    expect(depositLinkEmail({ firstName: "Sarah", url: LINK_URL }).html).toContain("Hi Sarah,");
  });

  it("escapes a script tag and quotes in the first name", () => {
    const { html } = depositLinkEmail({ firstName: `<script>alert("x")</script> O'Brien`, url: LINK_URL });
    expect(html).not.toContain("<script");
    expect(html).toContain("Hi &lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt; O&#39;Brien,");
  });

  it.each([
    ["null", null],
    ["empty", ""],
    ["only spaces", "   "],
  ])("a first name that is %s → a plain greeting", (_label, firstName) => {
    const { html } = depositLinkEmail({ firstName, url: LINK_URL });
    expect(html).toContain("Hello,");
    expect(html).not.toContain("Hi ");
  });

  it("trims the first name", () => {
    expect(depositLinkEmail({ firstName: "  Sarah  ", url: LINK_URL }).html).toContain("Hi Sarah,");
  });
});

describe("depositLinkEmail — brand, amount, header and footer", () => {
  it("writes no amount", () => {
    const { subject, html } = depositLinkEmail({ firstName: "Sarah", url: LINK_URL });
    expect(subject).not.toMatch(AMOUNT_LITERAL);
    expect(html).not.toMatch(AMOUNT_LITERAL);
    expect(html).not.toContain("£");
  });

  it("opens with the brand header and closes with the client footer", () => {
    const { html } = depositLinkEmail({ firstName: "Sarah", url: LINK_URL });
    expect(html).toContain(emailHeader());
    expect(html).toContain(FOOTER);
    expect(html.indexOf(emailHeader())).toBeLessThan(html.indexOf(LINK_URL));
    expect(html.indexOf(LINK_URL)).toBeLessThan(html.indexOf(FOOTER));
  });

  it("is a whole HTML document", () => {
    const { html } = depositLinkEmail({ firstName: "Sarah", url: LINK_URL });
    expect(html.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(html.trimEnd().endsWith("</html>")).toBe(true);
  });
});
