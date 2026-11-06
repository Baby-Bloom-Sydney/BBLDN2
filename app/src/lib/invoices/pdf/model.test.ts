/**
 * The PDF's data from what the store returns (plan 06 step 8; §14.6 b2.6): the created invoice's snapshot — number,
 * family, her name, the issuer, the lines and every figure — and her full bank details (the last-4 check is kept).
 * Pure. A created row whose figures don't add up by `totals.ts` is never printed (one set of maths, risk X2).
 *
 * BB-wave1-041126/06a-build, 2026-11-04; BB-wave1-041126/06b2-build, 2026-11-06.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreatedInvoice, StoredPaymentDetails } from "../store-map";
import { invoicePdfData } from "./model";

const shift = (lineNo: number, date: string, hours: number, rate: number, description: string | null = null) =>
  ({ lineNo, kind: "shift" as const, date, hours, ratePence: rate, description, amountPence: hours * rate });

const created: CreatedInvoice = {
  invoiceId: "b0600000-0000-4000-8000-000000009003", seq: 3, number: "BB-SophieTaylor-270215-0003", status: "sending",
  kind: "regular_week", placementId: "b0600000-0000-4000-8000-000000000411", connectionRequestId: null,
  periodStart: "2027-02-08", hours: 32, shiftsPence: 58_400, expensesPence: 1250, vat: { mode: "added", rateBp: 2000, pence: 11_680 },
  totalPence: 71_330, parentUserId: "b0600000-0000-4000-8000-000000000011",
  familyName: "Olivia Hartley", familyEmail: "admin+b06-11@babybloomnannies.co.uk", nannyName: "Sophie Taylor",
  nannyEmail: "admin+b06-1@babybloomnannies.co.uk", accountLast4: "4321", pdfPath: "n/i.pdf",
  replacesInvoiceId: "b0600000-0000-4000-8000-000000009001", replacesNumber: "BB-SophieTaylor-270212-0001", createdAt: "2027-02-15T09:30:00.000Z",
  issuer: {
    businessType: "limited_company", tradingName: "Taylor Childcare", address: "1 Upper Street\nLondon N1 0AA", companyName: "Taylor Childcare Ltd",
    companyNumber: "12345678", registeredOffice: "20 Market Road\nLondon N7 9PW", partnershipName: null, vatNumber: "GB123456789",
  },
  lines: [
    shift(1, "2027-02-08", 6, 1800), shift(2, "2027-02-09", 6, 1800), shift(3, "2027-02-10", 6, 1800), shift(4, "2027-02-11", 6, 1800),
    shift(5, "2027-02-12", 6, 1800), shift(6, "2027-02-10", 2, 2200, "evening, agreed rate"),
    { lineNo: 7, kind: "expense", expenseType: "activities", description: "Soft play", amountPence: 1250 },
  ],
};
const details: StoredPaymentDetails = { accountName: "Sophie Taylor", sortCode: "112233", accountNumber: "87654321", accountLast4: "4321" };

afterEach(() => vi.restoreAllMocks());

describe("invoicePdfData", () => {
  it("takes the issuer, lines and figures from the invoice's snapshot and the bank details from her saved details", () => {
    const r = invoicePdfData(created, details);
    expect(r).toEqual({ ok: true, value: {
      number: "BB-SophieTaylor-270215-0003",
      issuedAt: "2027-02-15T09:30:00.000Z",
      kind: "regular_week",
      periodStart: "2027-02-08",
      issuer: {
        name: "Sophie Taylor", businessType: "limited_company", tradingName: "Taylor Childcare", address: "1 Upper Street\nLondon N1 0AA",
        companyName: "Taylor Childcare Ltd", companyNumber: "12345678", registeredOffice: "20 Market Road\nLondon N7 9PW",
        partnershipName: null, vatNumber: "GB123456789",
      },
      billTo: { name: "Olivia Hartley", email: "admin+b06-11@babybloomnannies.co.uk" },
      shifts: [
        { date: "2027-02-08", description: null, hours: 6, ratePence: 1800, amountPence: 10_800 },
        { date: "2027-02-09", description: null, hours: 6, ratePence: 1800, amountPence: 10_800 },
        { date: "2027-02-10", description: null, hours: 6, ratePence: 1800, amountPence: 10_800 },
        { date: "2027-02-11", description: null, hours: 6, ratePence: 1800, amountPence: 10_800 },
        { date: "2027-02-12", description: null, hours: 6, ratePence: 1800, amountPence: 10_800 },
        { date: "2027-02-10", description: "evening, agreed rate", hours: 2, ratePence: 2200, amountPence: 4400 },
      ],
      expenses: [{ expenseType: "activities", description: "Soft play", amountPence: 1250 }],
      totals: { hours: 32, shiftsPence: 58_400, expensesPence: 1250, vat: { mode: "added", rateBp: 2000, pence: 11_680 }, totalPence: 71_330 },
      payTo: { accountName: "Sophie Taylor", sortCode: "112233", accountNumber: "87654321" },
      replacesNumber: "BB-SophieTaylor-270212-0001",
    } });
  });

  it("prints the lines in her order, whatever order they came in", () => {
    const r = invoicePdfData({ ...created, lines: [...created.lines].reverse() }, details);
    expect(r.ok && r.value.shifts.map((s) => s.date)).toEqual(["2027-02-08", "2027-02-09", "2027-02-10", "2027-02-11", "2027-02-12", "2027-02-10"]);
  });

  it("refuses details for a different account than the invoice names (they changed in between) — a result, not a throw", () => {
    expect(invoicePdfData(created, { ...details, accountNumber: "87650000", accountLast4: "0000" })).toEqual({ ok: false, error: "no_details" });
  });

  it("never prints figures that don't add up by the calculator (one set of maths) — an error, not a PDF", () => {
    expect(invoicePdfData({ ...created, totalPence: 71_331 }, details)).toEqual({ ok: false, error: "error" });
    expect(invoicePdfData({ ...created, vat: { mode: "added", rateBp: 2000, pence: 11_679 } }, details)).toEqual({ ok: false, error: "error" });
    expect(invoicePdfData({ ...created, hours: 33 }, details)).toEqual({ ok: false, error: "error" });
    expect(invoicePdfData({ ...created, lines: created.lines.map((l) => (l.lineNo === 6 ? { ...l, amountPence: 4401 } : l)) }, details))
      .toEqual({ ok: false, error: "error" });
    expect(invoicePdfData({ ...created, vat: { mode: "included", rateBp: null, pence: 0 } }, details)).toEqual({ ok: false, error: "error" });
  });

  it("says why by code only, never the figures (review TS M4, code L2)", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(invoicePdfData({ ...created, totalPence: 71_331 }, details)).toEqual({ ok: false, error: "error" });
    expect(log).toHaveBeenCalledWith("[invoices] invoicePdfData failed", { code: "figures_mismatch" });
    expect(JSON.stringify(log.mock.calls)).not.toMatch(/71331|Taylor|87654321/);
  });
});
