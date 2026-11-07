/**
 * The invoice PDF's content (plan 06 step 8, §14.8; brief §0a D, §0.5, §7; R8 / brief D7). Walked as the element tree
 * the renderer lays out (the `client-hire-summary.test.tsx` pattern): every string, without rendering.
 * 06b-2: the issuer by business type (sole trader; a limited company's name, number and registered office; a
 * partnership; the VAT number); the shift table (date, description, hours, rate, amount — two shifts on one date at
 * different rates); the expenses (type, description, amount); childcare, expenses, VAT per mode, total; pay to.
 * The look (BAI 2026-11-04, 06b-1): the website header's wordmark heads an opaque white page; the nanny stays the
 * issuer — those tests are kept exactly as 06b-1 wrote them (the last describe).
 * The parties block (BAI 2026-11-07): From | Business | Bill to, all three formatted alike; Business is one name (her
 * trading name, else the company's or partnership's), the company number and the VAT number; a limited company's
 * registered office is the one address under her name.
 * BB-wave1-041126/06a-build, 2026-11-04; 06b-1, 2026-11-04; BB-wave1-041126/06b2-build, 2026-11-06;
 * BB-wave1-041126 (three-column parties), 2026-11-07.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { Page, Text, View } from "@react-pdf/renderer";
import { isValidElement, type ReactNode } from "react";
import { SITE_NAME } from "@/lib/constants";
import { InvoicePdf } from "./InvoicePdf";
import { emailText, formatVatNumber } from "./sections/issuer";
import { wholeUnlessLong } from "./theme";
import { vatRateLabel } from "./sections/totals";
import {
  CORRECTION_INVOICE,
  expenseOf,
  HARTLEY_INVOICE,
  LTD_VAT_ADDED,
  MAX_INVOICE,
  PARTNERSHIP_INVOICE,
  shiftOf,
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
    expect(table.slice(-5)).toEqual(["Fri 12 Feb", "", "6", "£18.00", "£108.00"]);
  });

  it("prints the shifts in date order: the Wed 2 h line, entered after Fri, follows the Wed 6 h row (coordinator, 06b-2)", () => {
    expect(HARTLEY_INVOICE.shifts.map((s) => s.date)).toEqual(["2027-02-08", "2027-02-09", "2027-02-10", "2027-02-11", "2027-02-12", "2027-02-10"]);
    const rows = between(lines, "Childcare, week of 8–14 Feb 2027", "Expenses").slice(6);
    expect(rows.filter((l) => /^\w{3} \d+ Feb$/.test(l))).toEqual(["Mon 8 Feb", "Tue 9 Feb", "Wed 10 Feb", "Wed 10 Feb", "Thu 11 Feb", "Fri 12 Feb"]);
    const wed = rows.indexOf("Wed 10 Feb");
    expect(rows.slice(wed, wed + 10)).toEqual(["Wed 10 Feb", "", "6", "£18.00", "£108.00", "Wed 10 Feb", "evening, agreed rate", "2", "£22.00", "£44.00"]);
  });

  it("keeps her order for shifts on one date, and for the expenses (a stable sort by date only)", () => {
    const data = {
      ...HARTLEY_INVOICE,
      shifts: [shiftOf("2027-02-09", 2, 2200, "evening"), shiftOf("2027-02-08", 6, 1800), shiftOf("2027-02-09", 6, 1800, "day")],
      expenses: [expenseOf("travel", 640, "Bus"), expenseOf("food", 900, "Lunch"), expenseOf("activities", 1250, "Soft play")],
    };
    const shown = linesOf(InvoicePdf(data));
    const rows = between(shown, "Childcare, week of 8–14 Feb 2027", "Expenses").slice(6);
    expect(rows.filter((l) => /^\w{3} \d+ Feb$|^(evening|day)$/.test(l))).toEqual(["Mon 8 Feb", "Tue 9 Feb", "evening", "Tue 9 Feb", "day"]);
    expect(between(shown, "Expenses", "Childcare").slice(4)).toEqual(["Travel", "Bus", "£6.40", "Food", "Lunch", "£9.00", "Activities", "Soft play", "£12.50"]);
    expect(data.shifts.map((s) => s.description)).toEqual(["evening", null, "day"]);
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
  it("a limited company: From is her name and the registered office, never a second address (BAI 2026-11-07)", () => {
    const lines = linesOf(InvoicePdf(LTD_VAT_ADDED));
    expect(between(lines, "From", "Business")).toEqual(["From", "Sophie Taylor", "20 Market Road\nLondon N7 9PW"]);
    expect(lines.join("\n")).not.toContain("1 Upper Street");
    expect(lines.join("\n")).not.toContain("Registered office");
  });

  it("a limited company with a trading name: Business is the trading name (not the company name too), the company number and the VAT number", () => {
    const lines = linesOf(InvoicePdf(LTD_VAT_ADDED));
    expect(between(lines, "Business", "Bill to")).toEqual(["Business", "Taylor Childcare", "Company no. 12345678", "VAT no. GB 123 4567 89"]);
    expect(lines).not.toContain("Taylor Childcare Ltd");
  });

  it("a limited company with no trading name entered (it is her own name): Business is the company name, number and VAT number", () => {
    const data = { ...LTD_VAT_ADDED, issuer: { ...LTD_VAT_ADDED.issuer, tradingName: "Sophie Taylor" } };
    expect(between(linesOf(InvoicePdf(data)), "Business", "Bill to")).toEqual([
      "Business", "Taylor Childcare Ltd", "Company no. 12345678", "VAT no. GB 123 4567 89",
    ]);
  });

  it("a limited company with no registered office yet (none, or blank) prints the business address", () => {
    for (const registeredOffice of [null, ""]) {
      const data = { ...LTD_VAT_ADDED, issuer: { ...LTD_VAT_ADDED.issuer, registeredOffice } };
      expect(between(linesOf(InvoicePdf(data)), "From", "Business")).toEqual(["From", "Sophie Taylor", "1 Upper Street\nLondon N1 0AA"]);
    }
  });

  it("a limited company trading under its company name prints that name once", () => {
    const data = { ...LTD_VAT_ADDED, issuer: { ...LTD_VAT_ADDED.issuer, tradingName: "Taylor Childcare Ltd" } };
    expect(between(linesOf(InvoicePdf(data)), "Business", "Bill to")).toEqual([
      "Business", "Taylor Childcare Ltd", "Company no. 12345678", "VAT no. GB 123 4567 89",
    ]);
  });

  it("a partnership: her name and address; under Business its trading name, or with none entered the partnership's name", () => {
    const lines = linesOf(InvoicePdf(PARTNERSHIP_INVOICE));
    expect(between(lines, "From", "Business")).toEqual(["From", "Sophie Taylor", "1 Upper Street\nLondon N1 0AA"]);
    expect(between(lines, "Business", "Bill to")).toEqual(["Business", "Taylor & Shah"]);
    const untraded = { ...PARTNERSHIP_INVOICE, issuer: { ...PARTNERSHIP_INVOICE.issuer, tradingName: "Sophie Taylor" } };
    expect(between(linesOf(InvoicePdf(untraded)), "Business", "Bill to")).toEqual(["Business", "Taylor & Shah Childcare"]);
  });

  it("Business never runs past three lines (BAI 2026-11-07: \"maximum 3\")", () => {
    for (const data of [HARTLEY_INVOICE, LTD_VAT_ADDED, VAT_INCLUDED, PARTNERSHIP_INVOICE, CORRECTION_INVOICE, MAX_INVOICE]) {
      const lines = linesOf(InvoicePdf(data));
      const business = lines.includes("Business") ? between(lines, "Business", "Bill to").slice(1) : [];
      expect(business.length).toBeLessThanOrEqual(3);
    }
  });

  it("a sole trader registered for VAT (a 12-digit number) shows it under Business; a partnership with no expenses has no expenses table or row", () => {
    const included = linesOf(InvoicePdf(VAT_INCLUDED));
    expect(between(included, "From", "Business")).toEqual(["From", "Sophie Taylor", "1 Upper Street\nLondon N1 0AA"]);
    expect(between(included, "Business", "Bill to")).toEqual(["Business", "VAT no. GB 123 4567 89 012"]);
    const partnership = linesOf(InvoicePdf(PARTNERSHIP_INVOICE));
    expect(partnership).not.toContain("Expenses");
    expect(partnership).toEqual(expect.arrayContaining(["Mon 8 Feb", "8.75", "£18.00", "£157.50"]));
  });

  it("a sole trader with no business details has no Business column text, and its trading name equal to her name prints once", () => {
    const lines = linesOf(InvoicePdf(HARTLEY_INVOICE));
    expect(lines).not.toContain("Business");
    expect(lines.filter((l) => l === "Sophie Taylor")).toHaveLength(2); // From, and the Pay to account name
  });

  it("Bill to prints an email of up to 36 characters on one line, and breaks a longer one before its @, never with a hyphen", () => {
    const billTo = (email: string) => {
      const lines = linesOf(InvoicePdf({ ...HARTLEY_INVOICE, billTo: { name: "Olivia Hartley", email } }));
      return lines[lines.indexOf("Bill to") + 2];
    };
    expect(billTo("olivia.hartley.featherston@gmail.com")).toBe("olivia.hartley.featherston@gmail.com");
    expect(billTo("olivia.hartley-featherstonehaugh.family@protonmail.com")).toBe("olivia.hartley-featherstonehaugh.family\n@protonmail.com");
  });

  it("an email with no @, or with @ first, prints whole whatever its length", () => {
    const long = "o".repeat(40);
    expect([emailText(long), emailText(`@${long}`), emailText("a@b.co")]).toEqual([long, `@${long}`, "a@b.co"]);
  });

  it("three columns, always: From, Business (kept empty when there is nothing to show, so Bill to never moves), Bill to the widest", () => {
    for (const data of [HARTLEY_INVOICE, LTD_VAT_ADDED]) {
      const block = elementsOf(InvoicePdf(data)).find((e) => e.type === View && linesOf(e.props.children)[0] === "From" && linesOf(e.props.children).includes("Bill to"));
      const columns = (Array.isArray(block?.props.children) ? block.props.children : []).filter(isValidElement) as unknown as Found[];
      expect(columns).toHaveLength(3);
      const [from, business, billTo] = columns.map((c) => flat(c.props.style));
      expect(from.flex).toBe(business.flex);
      expect(Number(billTo.flex)).toBeGreaterThan(Number(from.flex));
      expect(billTo.paddingRight ?? 0).toBe(0);
    }
  });

  it("formats Business as the other two columns: its name as her name, its other lines as her address (BAI 2026-11-07)", () => {
    const textOf = (e: Found) => linesOf(e.props.children).join("");
    const styleIn = (data: typeof LTD_VAT_ADDED) => {
      const elements = elementsOf(InvoicePdf(data));
      return (line: string) => {
        const found = elements.find((e) => e.type === Text && textOf(e) === line);
        expect(found, line).toBeDefined();
        return flat(found?.props.style);
      };
    };
    const ltd = styleIn(LTD_VAT_ADDED);
    expect(ltd("Taylor Childcare")).toEqual(ltd("Sophie Taylor"));
    expect(ltd("Olivia Hartley")).toEqual(ltd("Sophie Taylor"));
    for (const line of ["Company no. 12345678", "VAT no. GB 123 4567 89"]) expect(ltd(line)).toEqual(ltd("20 Market Road\nLondon N7 9PW"));
    // with no business name, the VAT number is a line, not a name
    const vatOnly = styleIn(VAT_INCLUDED);
    expect(vatOnly("VAT no. GB 123 4567 89 012")).toEqual(vatOnly("1 Upper Street\nLondon N1 0AA"));
  });

  it("formats VAT numbers in their printed groups, and rates as a percent", () => {
    expect(formatVatNumber("GB123456789")).toBe("GB 123 4567 89");
    expect(formatVatNumber("GB123456789012")).toBe("GB 123 4567 89 012");
    expect(formatVatNumber("XX1")).toBe("XX1");
    expect([vatRateLabel(2000), vatRateLabel(1750), vatRateLabel(500), vatRateLabel(1), vatRateLabel(1234)]).toEqual(["20%", "17.5%", "5%", "0.01%", "12.34%"]);
  });
});

describe("InvoicePdf — corrections, Trial Shifts and the most lines", () => {
  it("a correction prints its own number, 'Replaces <number>', and her trading name under Business, accents exact (R7)", () => {
    const correction = linesOf(InvoicePdf(CORRECTION_INVOICE));
    expect(correction).toContain("BB-LucjaWisniewska-270215-0003");
    expect(correction).toContain("Replaces BB-LucjaWisniewska-270212-0001");
    expect(between(correction, "From", "Bill to")).toEqual(["From", "Łucja Wiśniewska", "22 Mare Street\nLondon E8 1HY", "Business", "Zoë Ó Briain Childcare"]);
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
    const views = elements.filter((e) => e.type === View);
    const has = (e: Found, label: string) => linesOf(e.props.children).includes(label);
    // each box on its own, and the block that holds both (review React M4: not just the outer block)
    expect(views.filter((e) => has(e, "Pay to") && !has(e, "Total")).every((e) => e.props.wrap === false || !e.props.style)).toBe(true);
    expect(views.find((e) => has(e, "Pay to") && !has(e, "Total") && has(e, "Account name"))?.props.wrap).toBe(false);
    expect(views.find((e) => has(e, "Total") && !has(e, "Pay to") && has(e, "Childcare"))?.props.wrap).toBe(false);
    expect(views.find((e) => has(e, "Total") && has(e, "Pay to"))?.props.wrap).toBe(false);
    expect(views.find((e) => has(e, `Generated with ${SITE_NAME}`))?.props.fixed).toBe(true);
    expect(views.filter((e) => e.props.fixed)).toHaveLength(2); // the violet band and the footer
  });

  it("numbers the pages of a longer invoice, 'Page X of Y' in the footer of each, and a one-page invoice not at all (BAI 2026-11-07)", () => {
    type PageLabel = (p: { pageNumber: number; totalPages: number }) => string;
    const renderOf = (e: Found) => (e.props as { render?: PageLabel }).render;
    const elements = elementsOf(InvoicePdf(MAX_INVOICE));
    const numbered = elements.filter((e) => e.type === Text && typeof renderOf(e) === "function");
    expect(numbered).toHaveLength(1);
    const label = renderOf(numbered[0]) as PageLabel;
    expect([label({ pageNumber: 1, totalPages: 2 }), label({ pageNumber: 2, totalPages: 2 }), label({ pageNumber: 1, totalPages: 1 })]).toEqual([
      "Page 1 of 2", "Page 2 of 2", "",
    ]);
    const footer = elements.find((e) => e.type === View && e.props.fixed && linesOf(e.props.children).includes(`Generated with ${SITE_NAME}`));
    expect(footer && elementsOf(footer.props.children).some((e) => renderOf(e) === label)).toBe(true);
  });

  it("never splits a row, and never leaves a table's title and head without its first row (review React M2, M4)", () => {
    const elements = elementsOf(InvoicePdf(MAX_INVOICE));
    const rows = elements.filter((e) => e.type === View && flat(e.props.style).borderBottom !== undefined && flat(e.props.style).flexDirection === "row");
    expect(rows).toHaveLength(48);
    expect(rows.every((r) => r.props.wrap === false)).toBe(true);
    for (const [title, firstCell] of [["Childcare, week of 8–14 Feb 2027", "Mon 8 Feb"], ["Expenses", "Food"]]) {
      const opening = elements.find((e) => e.type === View && e.props.wrap === false && linesOf(e.props.children)[0] === title);
      expect(opening && linesOf(opening.props.children)).toEqual(expect.arrayContaining([title, "Description", "Amount", firstCell]));
    }
  });

  it("prints only ASCII (and £) in the built-in Helvetica Bold; everything typed is in the Unicode font (R7)", () => {
    for (const data of [HARTLEY_INVOICE, CORRECTION_INVOICE, LTD_VAT_ADDED]) {
      const helvetica = elementsOf(InvoicePdf(data)).filter((e) => e.type === Text && flat(e.props.style).fontFamily === "Helvetica");
      expect(helvetica.length).toBeGreaterThan(0);
      for (const e of helvetica) expect(linesOf(e.props.children).join("")).toMatch(/^[\x20-\x7E£]*$/);
    }
  });

  it("keeps a name's words whole, but lets a word too long for any column break rather than run out of its box (review React M3)", () => {
    const syllables = (word: string) => [word.slice(0, 7), word.slice(7)];
    expect(wholeUnlessLong("Featherstonehaugh", syllables)).toEqual(["Featherstonehaugh"]);
    expect(wholeUnlessLong("Featherstonehaugh-Wolfeschlegelsteinhausen", syllables)).toEqual(["Feather", "stonehaugh-Wolfeschlegelsteinhausen"]);
    const elements = elementsOf(InvoicePdf(HARTLEY_INVOICE));
    const value = elements.find((e) => e.type === Text && e.props.children === "Sophie Taylor" && flat(e.props.style).flex === 1);
    expect((value?.props as { hyphenationCallback?: unknown }).hyphenationCallback).toBe(wholeUnlessLong);
  });

  it("gives the pay-to values room: the labels' column is narrow, the value takes the rest (review React M3)", () => {
    const elements = elementsOf(InvoicePdf(HARTLEY_INVOICE));
    const label = elements.find((e) => e.type === Text && e.props.children === "Account number");
    expect(Number(flat(label?.props.style).width)).toBeLessThanOrEqual(90);
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
