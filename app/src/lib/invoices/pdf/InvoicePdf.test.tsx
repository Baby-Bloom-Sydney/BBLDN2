/**
 * The invoice PDF's content (plan 06 step 8, §3a; brief §0.5, §7, §9.7; R8 / brief D7). Walked as the element tree
 * the renderer lays out (the `client-hire-summary.test.tsx` pattern): every string, without rendering.
 * The look (BAI 2026-11-04): the website header's wordmark heads an opaque white page; the nanny stays the issuer.
 * BB-wave1-041126/06a-build, 2026-11-04; 06b-1, 2026-11-04.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Page, Text } from "@react-pdf/renderer";
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

interface Found {
  readonly type: unknown;
  readonly props: { readonly style?: unknown; readonly children?: ReactNode };
}

/** Every element in document order, depth first. */
function elementsOf(node: ReactNode): Found[] {
  if (Array.isArray(node)) return node.flatMap(elementsOf);
  if (!isValidElement(node)) return [];
  const props = node.props as Found["props"];
  return [{ type: node.type, props }, ...elementsOf(props.children)];
}

/** A react-pdf style prop (object or array of objects) as one object. */
function flat(style: unknown): Record<string, unknown> {
  if (Array.isArray(style)) return Object.assign({}, ...style.map(flat));
  return typeof style === "object" && style !== null ? { ...(style as Record<string, unknown>) } : {};
}

describe("InvoicePdf", () => {
  const lines = linesOf(InvoicePdf(HARTLEY_INVOICE));
  const text = lines.join("\n");

  it("is an invoice from the nanny: number, issue date, her name and address", () => {
    expect(text).toContain("INVOICE");
    expect(text).toContain("BB-SophieTaylor-270215-0001");
    expect(lines).toEqual(expect.arrayContaining(["Invoice number", "Issue date", "15 Feb 2027"]));
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

  it("BabyBloom is only the header mark and the footer, never the issuer (R8, brief D7; BAI 2026-11-04)", () => {
    expect(lines.slice(0, 2)).toEqual(["Baby", "Bloom"]);
    expect(lines.filter((l) => l.includes(SITE_NAME))).toEqual([`Generated with ${SITE_NAME}`]);
    expect(lines.slice(lines.indexOf("From"), lines.indexOf("Bill to"))).toEqual(["From", "Sophie Taylor", "1 Upper Street\nLondon N1 0AA"]);
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

describe("InvoicePdf look (BAI 2026-11-04: our logo, a white background not see through)", () => {
  const elements = elementsOf(InvoicePdf(HARTLEY_INVOICE));
  const texts = elements.filter((e) => e.type === Text);

  it("is an opaque white page", () => {
    const page = elements.find((e) => e.type === Page);
    expect(flat(page?.props.style).backgroundColor).toBe("#FFFFFF");
  });

  it("heads the page with the website header's wordmark: logo.svg's two colours, bold, the header's gap", () => {
    const svg = readFileSync(path.join(process.cwd(), "public/logo.svg"), "utf8");
    const fills = [...svg.matchAll(/<tspan fill="(#[0-9a-fA-F]{6})">(\w+)<\/tspan>/g)].map((m) => [m[2], m[1].toLowerCase()]);
    expect(fills).toEqual([["Baby", "#0f172a"], ["Bloom", "#8b5cf6"]]);

    expect(texts.slice(0, 2).map((e) => e.props.children)).toEqual(["Baby", "Bloom"]);
    for (const [word, fill] of fills) {
      const part = texts.find((e) => e.props.children === word);
      expect(flat(part?.props.style)).toMatchObject({ fontFamily: "Helvetica", fontWeight: "bold", color: fill });
    }
    // LandingHeader.tsx: `gap-1` (4px) between the halves at `text-xl` (20px), so a fifth of the type size.
    const [baby, bloom] = texts.slice(0, 2).map((e) => flat(e.props.style));
    expect(bloom.marginLeft).toBeCloseTo(Number(baby.fontSize) / 5);
  });

  it("a long account name wraps inside the Pay to box (review M1)", () => {
    const accountName = texts.filter((e) => e.props.children === HARTLEY_INVOICE.payTo.accountName).at(-1);
    expect(flat(accountName?.props.style).flex).toBe(1);
  });
});
