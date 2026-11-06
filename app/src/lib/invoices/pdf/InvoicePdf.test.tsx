/**
 * The invoice PDF's content (plan 06 step 8, §14.8; brief §0a D, §0.5, §7; R8 / brief D7). Walked as the element tree
 * the renderer lays out (the `client-hire-summary.test.tsx` pattern): every string, without rendering.
 * 06b-2: the issuer by business type (sole trader; a limited company's name, number and registered office; a
 * partnership; the VAT number); the shift table (date, description, hours, rate, amount — two shifts on one date at
 * different rates); the expenses (type, description, amount); childcare, expenses, VAT per mode, total; pay to.
 * The look (BAI 2026-11-04, 06b-1): the website header's wordmark heads an opaque white page; the nanny stays the
 * issuer — those tests are kept exactly as 06b-1 wrote them (the last describe).
 * BB-wave1-041126/06a-build, 2026-11-04; 06b-1, 2026-11-04; BB-wave1-041126/06b2-build, 2026-11-06.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Page, Text, View } from "@react-pdf/renderer";
import { isValidElement, type ReactNode } from "react";
import { SITE_NAME } from "@/lib/constants";
import { InvoicePdf } from "./InvoicePdf";
import { formatVatNumber } from "./sections/issuer";
import { vatRateLabel } from "./sections/totals";
import {
  CORRECTION_INVOICE,
  HARTLEY_INVOICE,
  LTD_VAT_ADDED,
  MAX_INVOICE,
  PARTNERSHIP_INVOICE,
  TRIAL_INVOICE,
  VAT_INCLUDED,
} from "./fixtures.test-util";

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
  readonly props: { readonly style?: unknown; readonly children?: ReactNode; readonly wrap?: boolean; readonly fixed?: boolean };
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

/** The strings between two labels (the first one included), e.g. the From block. */
const between = (lines: readonly string[], from: string, to: string): string[] => lines.slice(lines.indexOf(from), lines.indexOf(to));
/** A label and the value printed after it in the totals ("Childcare" → "£584.00"). */
const after = (lines: readonly string[], label: string): string | undefined => lines[lines.indexOf(label) + 1];

describe("InvoicePdf — the worked example (sole trader, no VAT: 14.5)", () => {
  const lines = linesOf(InvoicePdf(HARTLEY_INVOICE));
  const text = lines.join("\n");

  it("is an invoice from the nanny: number, issue date, her name and address", () => {
    expect(text).toContain("INVOICE");
    expect(text).toContain("BB-SophieTaylor-270215-0001");
    expect(lines).toEqual(expect.arrayContaining(["Invoice number", "Issue date", "15 Feb 2027"]));
    expect(between(lines, "From", "Bill to")).toEqual(["From", "Sophie Taylor", "1 Upper Street\nLondon N1 0AA"]);
  });

  it("bills the family by name and email only (brief §11 Q10)", () => {
    expect(between(lines, "Bill to", "Childcare, week of 8–14 Feb 2027")).toEqual(["Bill to", "Olivia Hartley", "admin+b06-11@babybloomnannies.co.uk"]);
  });

  it("prints each shift — date, description, hours, rate, amount — including two shifts on one date at different rates", () => {
    const table = between(lines, "Childcare, week of 8–14 Feb 2027", "Expenses");
    expect(table.slice(0, 6)).toEqual(["Childcare, week of 8–14 Feb 2027", "Date", "Description", "Hours", "Rate", "Amount"]);
    expect(table.slice(6, 11)).toEqual(["Mon 8 Feb", "", "6", "£18.00", "£108.00"]);
    expect(table.filter((l) => l === "Wed 10 Feb")).toHaveLength(2);
    expect(table.slice(-5)).toEqual(["Wed 10 Feb", "evening, agreed rate", "2", "£22.00", "£44.00"]);
  });

  it("prints the expenses: type, description, amount", () => {
    expect(between(lines, "Expenses", "Childcare")).toEqual(["Expenses", "Type", "Description", "Amount", "Activities", "Soft play, Islington", "£12.50"]);
  });

  it("totals: childcare £584.00, expenses £12.50, total £596.50 — and no VAT line", () => {
    expect(after(lines, "Childcare")).toBe("£584.00");
    expect(lines.filter((l) => l === "Expenses")).toHaveLength(2); // the table's heading and the totals row
    expect(lines[lines.lastIndexOf("Expenses") + 1]).toBe("£12.50");
    expect(after(lines, "Total")).toBe("£596.50");
    expect(text).not.toMatch(/VAT/);
  });

  it("carries her full bank details — the one place they appear (brief D12)", () => {
    expect(between(lines, "Pay to", `Generated with ${SITE_NAME}`)).toEqual([
      "Pay to", "Account name", "Sophie Taylor", "Sort code", "11-22-33", "Account number", "87654321",
    ]);
  });

  it("BabyBloom is only the header mark and the footer, never the issuer (R8, brief D7; BAI 2026-11-04)", () => {
    expect(lines.slice(0, 2)).toEqual(["Baby", "Bloom"]);
    expect(lines.filter((l) => l.includes(SITE_NAME))).toEqual([`Generated with ${SITE_NAME}`]);
    expect(text).not.toMatch(/Baby Bloom/);
  });

  it("prints no 'Replaces' line unless it corrects an invoice", () => {
    expect(text).not.toContain("Replaces");
  });
});

describe("InvoicePdf — VAT per mode (14.5, 14.8)", () => {
  it("VAT added at 20% (a limited company): childcare £584.00, VAT at 20% £116.80, expenses £12.50, total £713.30", () => {
    const lines = linesOf(InvoicePdf(LTD_VAT_ADDED));
    const totals = lines.slice(lines.lastIndexOf("Childcare"), lines.indexOf("Pay to"));
    expect(totals).toEqual(["Childcare", "£584.00", "VAT at 20%", "£116.80", "Expenses", "£12.50", "Total", "£713.30"]);
  });

  it("VAT included at 20%: childcare (including VAT) £584.00, of which VAT at 20% £97.33; total £596.50", () => {
    const lines = linesOf(InvoicePdf(VAT_INCLUDED));
    const totals = lines.slice(lines.indexOf("Childcare (including VAT)"), lines.indexOf("Pay to"));
    expect(totals).toEqual(["Childcare (including VAT)", "£584.00", "of which VAT at 20%", "£97.33", "Expenses", "£12.50", "Total", "£596.50"]);
  });
});

describe("InvoicePdf — the issuer by business type (§0a D, 14.8)", () => {
  it("a limited company: trading name, her name, address, company name, number, registered office, VAT number", () => {
    const lines = linesOf(InvoicePdf(LTD_VAT_ADDED));
    expect(between(lines, "From", "Bill to")).toEqual([
      "From", "Taylor Childcare", "Sophie Taylor", "1 Upper Street\nLondon N1 0AA", "Taylor Childcare Ltd", "Company no. 12345678",
      "Registered office: 20 Market Road\nLondon N7 9PW", "VAT no. GB 123 4567 89",
    ]);
  });

  it("a partnership: its trading name, her name, address and the partnership's name", () => {
    const lines = linesOf(InvoicePdf(PARTNERSHIP_INVOICE));
    expect(between(lines, "From", "Bill to")).toEqual(["From", "Taylor & Shah", "Sophie Taylor", "1 Upper Street\nLondon N1 0AA", "Taylor & Shah Childcare"]);
  });

  it("a sole trader registered for VAT (a 12-digit number), with no expenses: no expenses table or row", () => {
    const included = linesOf(InvoicePdf(VAT_INCLUDED));
    expect(between(included, "From", "Bill to")).toContain("VAT no. GB 123 4567 89 012");
    const partnership = linesOf(InvoicePdf(PARTNERSHIP_INVOICE));
    expect(partnership).not.toContain("Expenses");
    expect(partnership).toEqual(expect.arrayContaining(["Mon 8 Feb", "8.75", "£18.00", "£157.50"]));
  });

  it("formats VAT numbers in their printed groups, and rates as a percent", () => {
    expect(formatVatNumber("GB123456789")).toBe("GB 123 4567 89");
    expect(formatVatNumber("GB123456789012")).toBe("GB 123 4567 89 012");
    expect(formatVatNumber("XX1")).toBe("XX1");
    expect([vatRateLabel(2000), vatRateLabel(1750), vatRateLabel(500), vatRateLabel(1), vatRateLabel(1234)]).toEqual(["20%", "17.5%", "5%", "0.01%", "12.34%"]);
  });
});

describe("InvoicePdf — corrections, Trial Shifts and the most lines", () => {
  it("a correction prints its own number, 'Replaces <number>' and her trading name above her name, accents exact (R7)", () => {
    const correction = linesOf(InvoicePdf(CORRECTION_INVOICE));
    expect(correction).toContain("BB-LucjaWisniewska-270215-0003");
    expect(correction).toContain("Replaces BB-LucjaWisniewska-270212-0001");
    expect(between(correction, "From", "Bill to")).toEqual(["From", "Zoë Ó Briain Childcare", "Łucja Wiśniewska", "22 Mare Street\nLondon E8 1HY"]);
    expect(correction).toEqual(expect.arrayContaining(["Kateřina Dvořák", "Café, then Łazienki-style park walk", "£252.00"]));
  });

  it("a Trial Shift is one dated table (plan §3a), with its expense", () => {
    const trial = linesOf(InvoicePdf(TRIAL_INVOICE));
    expect(trial).toContain("Trial Shift, Wed 3 Feb 2027");
    expect(trial.join("\n")).not.toContain("week of");
    expect(trial).toEqual(expect.arrayContaining(["Wed 3 Feb", "4", "£72.00", "Travel", "Bus to the trial", "£6.40"]));
    expect(after(trial, "Total")).toBe("£78.40");
  });

  it("at the most lines prints all 28 shifts and 20 expenses", () => {
    const lines = linesOf(InvoicePdf(MAX_INVOICE));
    expect(lines.filter((l) => / care$/.test(l))).toHaveLength(28);
    expect(lines.filter((l) => /^Receipt \d+$/.test(l))).toHaveLength(20);
  });

  it("keeps the totals and the pay-to box whole across a page break, and the band and footer on every page", () => {
    const elements = elementsOf(InvoicePdf(MAX_INVOICE));
    const holding = (label: string) => elements.find((e) => e.type === View && linesOf(e.props.children).includes(label));
    expect(holding("Pay to")?.props.wrap).toBe(false);
    expect(holding("Total")?.props.wrap).toBe(false);
    expect(holding(`Generated with ${SITE_NAME}`)?.props.fixed).toBe(true);
    expect(elements.filter((e) => e.type === View && e.props.fixed)).toHaveLength(2); // the violet band and the footer
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
