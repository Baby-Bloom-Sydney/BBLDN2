/**
 * Test-only: the shared checks for the three call emails whose "Change or cancel" button takes an optional href
 * (plan 03 row C3, D8 — a pre-booked family's button opens her deposit page). With an href, only the button's href
 * changes: the subject, the label and every other byte are the email without one. The href is escaped in its
 * attribute. Each template's own test pins its no-href email to today's, byte for byte.
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */
import { expect, it } from "vitest";
import { CALL_PAGE_URL, escapeHtml } from "./call-email-parts";
import type { EmailTemplate } from "./types";

export const DEPOSIT_HREF = `https://example.test/deposit/${"Ab0_-".repeat(8)}xyz`;

export function itTakesAButtonHref<P extends object>(build: (params: P & { readonly href?: string }) => EmailTemplate, base: P): void {
  it("an href → the button opens it; the subject, the label and every other byte as without one", () => {
    const today = build(base);
    const callHref = `href="${escapeHtml(CALL_PAGE_URL)}"`;
    expect(today.html.split(callHref)).toHaveLength(2);
    const withHref = build({ ...base, href: DEPOSIT_HREF });
    expect(withHref.subject).toBe(today.subject);
    expect(withHref.html).toBe(today.html.replace(callHref, `href="${DEPOSIT_HREF}"`));
    expect(withHref.html).toContain(">Change or cancel</a>");
  });

  it("the href is escaped in its attribute", () => {
    const { html } = build({ ...base, href: 'https://example.test/x?a=1&b="2"' });
    expect(html).toContain('href="https://example.test/x?a=1&amp;b=&quot;2&quot;"');
  });

  it("the call page given as the href → the same email as none", () => {
    expect(build({ ...base, href: CALL_PAGE_URL })).toEqual(build(base));
  });
}
