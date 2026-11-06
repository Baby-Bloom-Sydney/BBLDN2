// @vitest-environment node
/**
 * The invoice PDF rendered for real (plan 06 step 8, §14.6 b2.6; R7 names with accents print exactly; R9 no `any`).
 * The text is read back out of the PDF bytes with `pdf-parse` (already a dependency; its library entry, so the
 * package's own self-test never runs), page by page. At the most lines (28 shifts, 20 expenses) the PDF runs to two
 * pages, with the footer on each and the totals and pay-to box whole on the last (plan 14.3, X7).
 * BB-wave1-041126/06a-build, 2026-11-04; BB-wave1-041126/06b2-build, 2026-11-06.
 */
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInvoicePdf } from "./render";
import { CORRECTION_INVOICE, HARTLEY_INVOICE, LTD_VAT_ADDED, MAX_INVOICE, TRIAL_INVOICE, VAT_INCLUDED } from "./fixtures.test-util";

interface PdfPage {
  getTextContent(): Promise<{ readonly items: readonly { readonly str: string }[] }>;
}
type PdfParse = (
  data: Buffer,
  options?: { readonly pagerender?: (page: PdfPage) => Promise<string> },
) => Promise<{ readonly text: string; readonly numpages: number }>;
const pdfParse = createRequire(import.meta.url)("pdf-parse/lib/pdf-parse.js") as PdfParse;

beforeEach(() => vi.stubEnv("NANNY_INVOICES_ENABLED", "true"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function rendered(data: typeof HARTLEY_INVOICE): Promise<{ bytes: Buffer; text: string; pages: readonly string[] }> {
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
  return { bytes: r.value, text: pages.join("\n"), pages };
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

  it("a limited company with VAT added: its company lines, VAT at 20% and the higher total", async () => {
    const { text } = await rendered(LTD_VAT_ADDED);
    for (const s of ["Taylor Childcare Ltd", "Company no. 12345678", "Registered office: 20 Market Road", "VAT no. GB 123 4567 89",
      "VAT at 20%", "£116.80", "£713.30"]) {
      expect(text).toContain(s);
    }
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
    for (const s of [/Total/, /pay to/i, /Account name/, /Sort code/, /11-22-33/, /Account number/, /87654321/, /£\d/]) {
      expect(pages[1]).toMatch(s);
    }
    for (const s of [/pay to/i, /Account name/, /87654321/, /Total/]) expect(pages[0]).not.toMatch(s);
    expect((text.match(/ care/g) ?? []).length).toBe(28);
    expect((text.match(/Receipt \d+/g) ?? []).length).toBe(20);
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
