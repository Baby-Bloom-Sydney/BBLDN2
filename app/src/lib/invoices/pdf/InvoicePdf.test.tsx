/**
 * The invoice PDF's content (plan 06 step 8, §3a; brief §0.5, §7, §9.7; R8 / brief D7). Walked as the element tree
 * the renderer lays out (the `client-hire-summary.test.tsx` pattern): every string, without rendering.
 * BB-wave1-041126/06a-build, 2026-11-04.
 */
import { describe, expect, it } from "vitest";
import { Text } from "@react-pdf/renderer";
import { isValidElement, type ReactNode } from "react";
import { SITE_NAME } from "@/lib/constants";
import { InvoicePdf } from "./InvoicePdf";
import { CORRECTION_INVOICE, HARTLEY_INVOICE, TRIAL_INVOICE } from "./fixtures.test-util";

/** One string per Text element (its children joined), in document order. */
function linesOf(node: ReactNode): string[] {
  if (node === null || node === undefined || typeof node === "boolean") return [];
  if (typeof node === "string" || typeof node === "number") return [String(node)];
  if (Array.isArray(node)) return node.flatMap(linesOf);
  if (!isValidElement(node)) return [];
  const children = (node.props as { children?: ReactNode }).children;
  const nested = linesOf(children);
  return node.type === Text ? [nested.join("")] : nested;
}

describe("InvoicePdf", () => {
  const lines = linesOf(InvoicePdf(HARTLEY_INVOICE));
  const text = lines.join("\n");

  it("is an invoice from the nanny: number, issue date, her name and address", () => {
    expect(text).toContain("INVOICE");
    expect(text).toContain("BB-SophieTaylor-270215-0001");
    expect(text).toContain("Issued 15 Feb 2027");
    expect(text).toContain("Sophie Taylor");
    expect(text).toContain("1 Upper Street\nLondon N1 0AA");
  });

  it("bills the family by name and email only (brief §11 Q10)", () => {
    expect(text).toContain("Olivia Hartley");
    expect(text).toContain("admin+b06-11@babybloomnannies.co.uk");
  });

  it("prints the week, hours × rate and the total (brief §0.5)", () => {
    expect(text).toContain("Childcare, week of 8–14 Feb 2027");
    expect(lines).toEqual(expect.arrayContaining(["30", "£18.00", "£540.00"]));
    expect(lines.filter((l) => l === "£540.00")).toHaveLength(2);
  });

  it("carries her full bank details — the one place they appear (brief D12)", () => {
    expect(text).toContain("Sophie Taylor");
    expect(text).toContain("11-22-33");
    expect(text).toContain("87654321");
  });

  it("says 'Generated with BabyBloom' and never presents BabyBloom as the issuer (R8, brief D7)", () => {
    expect(lines).toContain(`Generated with ${SITE_NAME}`);
    expect(lines.filter((l) => l.includes(SITE_NAME))).toEqual([`Generated with ${SITE_NAME}`]);
    expect(text).not.toMatch(/Baby Bloom/);
  });

  it("prints no 'Replaces' line unless it corrects an invoice", () => {
    expect(text).not.toContain("Replaces");
  });

  it("a correction prints its own number, 'Replaces <number>' and her trading name above her name", () => {
    const correction = linesOf(InvoicePdf(CORRECTION_INVOICE));
    expect(correction).toContain("BB-LucjaWisniewska-270215-0003");
    expect(correction).toContain("Replaces BB-LucjaWisniewska-270212-0001");
    expect(correction).toContain("Zoë Ó Briain Childcare");
    expect(correction).toContain("Łucja Wiśniewska");
    expect(correction.indexOf("Zoë Ó Briain Childcare")).toBeLessThan(correction.indexOf("Łucja Wiśniewska"));
    expect(correction).toEqual(expect.arrayContaining(["28", "£504.00", "Kateřina Dvořák"]));
  });

  it("a Trial Shift is one dated line (plan §3a)", () => {
    const trial = linesOf(InvoicePdf(TRIAL_INVOICE)).join("\n");
    expect(trial).toContain("Trial Shift, Wed 3 Feb 2027");
    expect(trial).toContain("£72.00");
    expect(trial).not.toContain("week of");
  });
});
