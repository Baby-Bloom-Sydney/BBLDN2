// @vitest-environment node
/**
 * The invoice PDF rendered for real (plan 06 step 8, §14.6 b2.6; R7 names with accents print exactly; R9 no `any`).
 * The text is read back out of the PDF bytes with `pdf-parse` (already a dependency; its library entry, so the
 * package's own self-test never runs), page by page. At the most lines (28 shifts, 20 expenses) the PDF runs to two
 * pages, with the footer on each and the totals and pay-to box whole on the last (plan 14.3, X7).
 * BB-wave1-041126/06a-build, 2026-11-04; BB-wave1-041126/06b2-build, 2026-11-06;
 * BB-wave1-041126 (three-column parties: where Bill to's email sits on the page), 2026-11-07.
 */
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInvoicePdf } from "./render";
import { CORRECTION_INVOICE, HARTLEY_INVOICE, LTD_VAT_ADDED, MAX_INVOICE, TRIAL_INVOICE, VAT_INCLUDED, WORST_INVOICE } from "./fixtures.test-util";

interface PdfPage {
  getTextContent(): Promise<{ readonly items: readonly { readonly str: string; readonly transform: readonly number[]; readonly width: number }[] }>;
}
type PdfParse = (
  data: Buffer,
  options?: { readonly pagerender?: (page: PdfPage) => Promise<string> },
) => Promise<{ readonly text: string; readonly numpages: number; readonly info: Readonly<Record<string, unknown>> }>;
const pdfParse = createRequire(import.meta.url)("pdf-parse/lib/pdf-parse.js") as PdfParse;

beforeEach(() => vi.stubEnv("NANNY_INVOICES_ENABLED", "true"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function rendered(data: typeof HARTLEY_INVOICE): Promise<{ bytes: Buffer; text: string; pages: readonly string[]; info: Readonly<Record<string, unknown>> }> {
  const r = await renderInvoicePdf(data);
  if (!r.ok) throw new Error(r.error);
  const pages: string[] = [];
  const parsed = await pdfParse(r.value, {
    pagerender: async (page) => {
      const content = await page.getTextContent();
      const text = content.items.map((i) => i.str).join("");
      pages.push(text);
      return text;
    },
  });
  expect(pages).toHaveLength(parsed.numpages);
  return { bytes: r.value, text: pages.join("\n"), pages, info: parsed.info };
}

describe("renderInvoicePdf", () => {
  it("renders the worked example on one A4 page: shifts, the expense, the totals, her bank details", async () => {
    const { bytes, text, pages } = await rendered(HARTLEY_INVOICE);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pages).toHaveLength(1);
    for (const s of ["INVOICE", "BB-SophieTaylor-270215-0001", "15 Feb 2027", "Olivia Hartley", "Childcare, week of 8–14 Feb 2027",
      "Mon 8 Feb", "Fri 12 Feb", "evening, agreed rate", "£22.00", "Soft play, Islington", "£584.00", "£12.50", "£596.50",
      "11-22-33", "87654321", "Generated with BabyBloom"]) {
      expect(text).toContain(s);
    }
    expect(text).not.toContain("VAT");
  }, 30_000);

  it("uses the built-in bold face (wordmark, title, total), with no font file (BAI 2026-11-04)", async () => {
    const { bytes } = await rendered(HARTLEY_INVOICE);
    expect(bytes.toString("latin1")).toContain("/BaseFont /Helvetica-Bold");
  }, 30_000);

  it("a limited company with VAT added: its trading name, number, the registered office as the one address, VAT at 20% and the higher total", async () => {
    const { text } = await rendered(LTD_VAT_ADDED);
    for (const s of ["Taylor Childcare", "Company no. 12345678", "20 Market Road", "VAT no. GB 123 4567 89",
      "VAT at 20%", "£116.80", "£713.30"]) {
      expect(text).toContain(s);
    }
    for (const s of ["Taylor Childcare Ltd", "Registered office", "1 Upper Street"]) expect(text).not.toContain(s); // BAI 2026-11-07
  }, 30_000);

  it("Bill to keeps an email inside the page's content box: 36 characters on one line, a longer one broken before its @ (three columns, 2026-11-07)", async () => {
    const right = 595.28 - 48; // A4 less the page's side padding
    /** Bill to's text (it starts in the page's right half) as printed lines: pieces at one height, joined, with the right edge. */
    const placed = async (email: string) => {
      const r = await renderInvoicePdf({ ...HARTLEY_INVOICE, billTo: { name: "Olivia Hartley", email } });
      if (!r.ok) throw new Error(r.error);
      const lines = new Map<number, { str: string; right: number }>();
      await pdfParse(r.value, {
        pagerender: async (page) => {
          for (const i of (await page.getTextContent()).items) {
            if (i.transform[4] < 595.28 / 2) continue;
            const y = Math.round(i.transform[5]);
            const line = lines.get(y) ?? { str: "", right: 0 };
            lines.set(y, { str: line.str + i.str, right: Math.max(line.right, i.transform[4] + i.width) });
          }
          return "";
        },
      });
      return [...lines.values()];
    };
    const one = (await placed("olivia.hartley.featherston@gmail.com")).filter((l) => l.str.includes("@"));
    expect(one.map((l) => l.str)).toEqual(["olivia.hartley.featherston@gmail.com"]);
    const two = (await placed("olivia.hartley-featherstonehaugh.family@protonmail.com")).filter((l) => /featherstonehaugh|@/.test(l.str));
    expect(two.map((l) => l.str)).toEqual(["olivia.hartley-featherstonehaugh.family", "@protonmail.com"]);
    for (const l of [...one, ...two]) expect(l.right).toBeLessThanOrEqual(right);
  }, 30_000);

  it("VAT included: the childcare including VAT, of which VAT at 20%", async () => {
    const { text } = await rendered(VAT_INCLUDED);
    for (const s of ["Childcare (including VAT)", "of which VAT at 20%", "£97.33", "£596.50", "VAT no. GB 123 4567 89 012"]) {
      expect(text).toContain(s);
    }
  }, 30_000);

  it("prints names with accents exactly, in the Unicode font (R7)", async () => {
    const { text } = await rendered(CORRECTION_INVOICE);
    for (const name of ["Łucja Wiśniewska", "Zoë Ó Briain Childcare", "Kateřina Dvořák", "Café, then Łazienki-style park walk",
      "BB-LucjaWisniewska-270215-0003", "Replaces BB-LucjaWisniewska-270212-0001", "£252.00"]) {
      expect(text).toContain(name);
    }
  }, 30_000);

  it("renders a Trial Shift", async () => {
    const { text } = await rendered(TRIAL_INVOICE);
    expect(text).toContain("Trial Shift, Wed 3 Feb 2027");
    expect(text).toContain("£78.40");
  }, 30_000);

  it("at the most lines (28 shifts + 20 expenses) runs to two pages: the footer on each, totals and pay-to whole", async () => {
    const { pages, text } = await rendered(MAX_INVOICE);
    expect(pages).toHaveLength(2);
    for (const page of pages) expect(page).toContain("Generated with BabyBloom");
    // the closing block (totals and pay-to; its labels print upper-case) is whole on the last page, and only there
    for (const s of [/Total/, /p\s*a\s*y\s*t\s*o/i, /Account name/, /Sort code/, /11-22-33/, /Account number/, /87654321/, /£\d/]) {
      expect(pages[1]).toMatch(s);
    }
    for (const s of [/p\s*a\s*y\s*t\s*o/i, /Account name/, /87654321/, /Total/]) expect(pages[0]).not.toMatch(s);
    expect((text.match(/ care/g) ?? []).length).toBe(28);
    expect((text.match(/Receipt \d+/g) ?? []).length).toBe(20);
  }, 30_000);

  it("a two-page invoice prints 'Page 1 of 2' and 'Page 2 of 2'; a one-page invoice prints no page number (BAI 2026-11-07)", async () => {
    const { pages } = await rendered(MAX_INVOICE);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toContain("Page 1 of 2");
    expect(pages[1]).toContain("Page 2 of 2");
    expect((await rendered(HARTLEY_INVOICE)).text).not.toMatch(/Page \d/);
  }, 30_000);

  it("with every field at its longest (120-character descriptions, the longest business details): long text adds pages, never splits a row or the closing block (review React H1)", async () => {
    const { pages, text } = await rendered(WORST_INVOICE);
    expect(pages.length).toBeGreaterThanOrEqual(2);
    for (const page of pages) expect(page).toContain("Generated with BabyBloom");
    const last = pages[pages.length - 1];
    // the label is letter-spaced, so its text comes out as "PAY   T O"
    for (const s of [/Total/, /p\s*a\s*y\s*t\s*o/i, /Account number/, /87654321/]) expect(last).toMatch(s);
    for (const page of pages.slice(0, -1)) for (const s of [/p\s*a\s*y\s*t\s*o/i, /Account number/, /Total/]) expect(page).not.toMatch(s);
    expect((text.match(/end of shift \d+/g) ?? []).length).toBe(28);
    expect((text.match(/end of receipt \d+/g) ?? []).length).toBe(20);
  }, 30_000);

  it("names the document: title, author, subject and language (review React M5)", async () => {
    const { info, bytes } = await rendered(CORRECTION_INVOICE);
    expect(info.Title).toBe("Invoice BB-LucjaWisniewska-270215-0003");
    expect(info.Author).toBe("Zoë Ó Briain Childcare");
    expect(info.Subject).toBe("Childcare, week of 8–14 Feb 2027");
    expect(bytes.toString("latin1")).toMatch(/\/Lang \(en-GB\)/);
  }, 30_000);

  it("refuses with the switch off, before rendering", async () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "");
    expect(await renderInvoicePdf(HARTLEY_INVOICE)).toEqual({ ok: false, error: "invoices_disabled" });
  });

  it("a render that throws is an error, logged by name only (never the invoice's text)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { ...HARTLEY_INVOICE, shifts: [{ ...HARTLEY_INVOICE.shifts[0], date: "2027-02-31" }] };
    expect(await renderInvoicePdf(broken)).toEqual({ ok: false, error: "error" });
    expect(log).toHaveBeenCalledWith("[invoices] renderInvoicePdf failed", { code: "RangeError" });
  });
});
