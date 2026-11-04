// @vitest-environment node
/**
 * The invoice PDF rendered for real (plan 06 step 8; R7 names with accents print exactly; R9 no `any`).
 * The text is read back out of the PDF bytes with `pdf-parse` (already a dependency; its library entry, so the
 * package's own self-test never runs).
 * BB-wave1-041126/06a-build, 2026-11-04.
 */
import { createRequire } from "node:module";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { renderInvoicePdf } from "./render";
import { CORRECTION_INVOICE, HARTLEY_INVOICE, TRIAL_INVOICE } from "./fixtures.test-util";

type PdfParse = (data: Buffer) => Promise<{ readonly text: string; readonly numpages: number }>;
const pdfParse = createRequire(import.meta.url)("pdf-parse/lib/pdf-parse.js") as PdfParse;

beforeEach(() => vi.stubEnv("NANNY_INVOICES_ENABLED", "true"));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

async function rendered(data: typeof HARTLEY_INVOICE): Promise<{ bytes: Buffer; text: string; pages: number }> {
  const r = await renderInvoicePdf(data);
  if (!r.ok) throw new Error(r.error);
  const parsed = await pdfParse(r.value);
  return { bytes: r.value, text: parsed.text, pages: parsed.numpages };
}

describe("renderInvoicePdf", () => {
  it("renders one A4 page of PDF with the invoice's figures", async () => {
    const { bytes, text, pages } = await rendered(HARTLEY_INVOICE);
    expect(bytes.subarray(0, 5).toString()).toBe("%PDF-");
    expect(pages).toBe(1);
    for (const s of ["INVOICE", "BB-SophieTaylor-270215-0001", "15 Feb 2027", "Olivia Hartley", "Childcare, week of 8–14 Feb 2027", "£540.00", "11-22-33", "87654321", "Generated with BabyBloom"]) {
      expect(text).toContain(s);
    }
  }, 30_000);

  it("uses the built-in bold face (wordmark, title, total), with no font file (BAI 2026-11-04)", async () => {
    const { bytes } = await rendered(HARTLEY_INVOICE);
    expect(bytes.toString("latin1")).toContain("/BaseFont /Helvetica-Bold");
  }, 30_000);

  it("prints names with accents exactly, in the Unicode font (R7)", async () => {
    const { text } = await rendered(CORRECTION_INVOICE);
    for (const name of ["Łucja Wiśniewska", "Zoë Ó Briain Childcare", "Kateřina Dvořák", "BB-LucjaWisniewska-270215-0003", "Replaces BB-LucjaWisniewska-270212-0001", "£504.00"]) {
      expect(text).toContain(name);
    }
  }, 30_000);

  it("renders a Trial Shift", async () => {
    const { text } = await rendered(TRIAL_INVOICE);
    expect(text).toContain("Trial Shift, Wed 3 Feb 2027");
    expect(text).toContain("£72.00");
  }, 30_000);

  it("refuses with the switch off, before rendering", async () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "");
    expect(await renderInvoicePdf(HARTLEY_INVOICE)).toEqual({ ok: false, error: "invoices_disabled" });
  });

  it("a render that throws is an error, logged by name only (never the invoice's text)", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const broken = { ...HARTLEY_INVOICE, line: { ...HARTLEY_INVOICE.line, periodStart: "2027-02-31" } };
    expect(await renderInvoicePdf(broken)).toEqual({ ok: false, error: "error" });
    expect(log).toHaveBeenCalledWith("[invoices] renderInvoicePdf failed", { code: "RangeError" });
  });
});
