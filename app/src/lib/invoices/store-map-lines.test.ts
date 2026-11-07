/**
 * The store's line, issuer and list shapes (plan 06 §14.4, b2.4): zod schemas that parse what amendment 21 returns
 * for an invoice's lines, her effective issuer, a business save and her own invoice list, and the `p_lines` the
 * store sends. Pure. A row or reply that doesn't fit is never guessed: the parse fails and the caller fails the read.
 * Fixture rates positionally (a test file, so the money-literal spec is satisfied either way).
 *
 * BB-wave1-041126/06b2-build, 2026-11-06.
 */
import { describe, expect, it } from "vitest";
import {
  businessSavedReply,
  issuerReply,
  lineRow,
  linesArg,
  myInvoiceRow,
  singleRate,
  type StoredLine,
} from "./store-map-lines";

const SHIFT_ROW = { line_no: 1, kind: "shift", shift_date: "2027-02-08", hours: 6, rate_pence: 1800, expense_type: null, description: null, amount_pence: 10_800 };
const EXPENSE_ROW = { line_no: 7, kind: "expense", shift_date: null, hours: null, rate_pence: null, expense_type: "activities", description: "Soft play", amount_pence: 1250 };

describe("lineRow", () => {
  it("parses a shift and an expense into their shapes (hours from numeric text too)", () => {
    expect(lineRow.parse({ ...SHIFT_ROW, hours: "6.00", description: "evening, agreed rate" })).toEqual({
      lineNo: 1, kind: "shift", date: "2027-02-08", hours: 6, ratePence: 1800, description: "evening, agreed rate", amountPence: 10_800,
    });
    expect(lineRow.parse(EXPENSE_ROW)).toEqual({ lineNo: 7, kind: "expense", expenseType: "activities", description: "Soft play", amountPence: 1250 });
  });

  it.each([
    ["a shift with no date", { ...SHIFT_ROW, shift_date: null }],
    ["a shift with no rate", { ...SHIFT_ROW, rate_pence: null }],
    ["a shift on a date that doesn't exist", { ...SHIFT_ROW, shift_date: "2027-02-30" }],
    ["an expense with no type", { ...EXPENSE_ROW, expense_type: null }],
    ["an unknown expense type", { ...EXPENSE_ROW, expense_type: "toys" }],
    ["an unknown kind", { ...SHIFT_ROW, kind: "bonus" }],
    ["an amount that isn't whole pence", { ...SHIFT_ROW, amount_pence: 10.5 }],
    ["line 0", { ...SHIFT_ROW, line_no: 0 }],
  ])("refuses %s", (_label, row) => {
    expect(lineRow.safeParse(row).success).toBe(false);
  });
});

describe("singleRate (07's FamilyInvoice.ratePence, 14.7)", () => {
  it("is the one rate when every shift has it, null when they differ; expenses don't count", () => {
    expect(singleRate([{ kind: "shift", rate_pence: 1800 }, { kind: "shift", rate_pence: 1800 }, { kind: "expense", rate_pence: null }])).toBe(1800);
    expect(singleRate([{ kind: "shift", rate_pence: 1800 }, { kind: "shift", rate_pence: 2200 }])).toBeNull();
    expect(singleRate([{ kind: "expense", rate_pence: null }])).toBeNull();
    expect(singleRate([])).toBeNull();
  });
});

describe("linesArg (the p_lines the store sends; keys = the line table's columns)", () => {
  it("maps each line in order; a blank description is left out", () => {
    const lines: readonly StoredLine[] = [
      { lineNo: 1, kind: "shift", date: "2027-02-10", hours: 2, ratePence: 2200, description: "evening, agreed rate", amountPence: 4400 },
      { lineNo: 2, kind: "shift", date: "2027-02-08", hours: 8.75, ratePence: 1800, description: null, amountPence: 15_750 },
      { lineNo: 3, kind: "expense", expenseType: "food", description: null, amountPence: 999 },
    ];
    expect(linesArg(lines)).toEqual([
      { kind: "shift", shift_date: "2027-02-10", hours: 2, rate_pence: 2200, description: "evening, agreed rate" },
      { kind: "shift", shift_date: "2027-02-08", hours: 8.75, rate_pence: 1800 },
      { kind: "expense", expense_type: "food", amount_pence: 999 },
    ]);
  });

  it("takes draft lines too (no line number or amount: the database works them out)", () => {
    expect(linesArg([{ kind: "shift", date: "2027-02-08", hours: 6, ratePence: 1800, description: null }])).toEqual([
      { kind: "shift", shift_date: "2027-02-08", hours: 6, rate_pence: 1800 },
    ]);
  });
});

describe("issuerReply (nanny_invoice_issuer: who she is on her invoices, with the defaults)", () => {
  const DEFAULTS = {
    business_type: "sole_trader", name: "Sophie Taylor", trading_name: "Sophie Taylor", trading_name_source: "name",
    address: "1 Upper Street\nLondon\nN1 0AA", address_source: "verification", company_name: null, company_number: null,
    registered_office: null, partnership_name: null, vat_mode: "none", vat_rate_bp: null, vat_number: null,
  };

  it("maps the zero-setup default", () => {
    expect(issuerReply.parse(DEFAULTS)).toEqual({
      businessType: "sole_trader", name: "Sophie Taylor", tradingName: "Sophie Taylor", tradingNameSource: "name",
      address: "1 Upper Street\nLondon\nN1 0AA", addressSource: "verification", companyName: null, companyNumber: null,
      registeredOffice: null, partnershipName: null, vat: { mode: "none", rateBp: null, number: null },
    });
  });

  it("maps a limited company with VAT, and no address on file", () => {
    const ltd = issuerReply.parse({
      ...DEFAULTS, business_type: "limited_company", company_name: "Taylor Childcare Ltd", company_number: "12345678",
      registered_office: "1 Upper Street", vat_mode: "added", vat_rate_bp: 2000, vat_number: "GB123456789", address: null, address_source: null,
    });
    expect(ltd).toMatchObject({ businessType: "limited_company", companyNumber: "12345678", address: null, addressSource: null, vat: { mode: "added", rateBp: 2000, number: "GB123456789" } });
  });

  it("carries no bank field, whatever a reply holds", () => {
    const parsed = issuerReply.parse({ ...DEFAULTS, account_number: "87654321", sort_code: "112233" });
    expect(JSON.stringify(parsed)).not.toMatch(/87654321|112233|account|sort/);
  });

  it("refuses a reply that doesn't fit (an unknown type or mode, a missing field)", () => {
    expect(issuerReply.safeParse({ ...DEFAULTS, business_type: "charity" }).success).toBe(false);
    expect(issuerReply.safeParse({ ...DEFAULTS, vat_mode: "reverse" }).success).toBe(false);
    expect(issuerReply.safeParse({ ...DEFAULTS, address_source: "somewhere" }).success).toBe(false);
    expect(issuerReply.safeParse(null).success).toBe(false);
  });
});

describe("businessSavedReply", () => {
  it("is saved with whether anything changed", () => {
    expect(businessSavedReply.parse({ status: "saved", changed: true })).toEqual({ changed: true });
    expect(businessSavedReply.safeParse({ status: "saved" }).success).toBe(false);
  });
});

describe("myInvoiceRow (her own list: no email, bank or PDF field)", () => {
  const ROW = {
    id: "b0600000-0000-4000-8000-000000009001", nanny_id: "b0600000-0000-4000-8000-000000000101", invoice_seq: 1,
    invoice_number: "BB-SophieTaylor-270215-0001", kind: "regular_week", placement_id: "b0600000-0000-4000-8000-000000000411",
    connection_request_id: null, parent_user_id: "b0600000-0000-4000-8000-000000000011", family_name: "Olivia Hartley",
    period_start: "2027-02-08", hours: "32.00", shifts_pence: 58_400, expenses_pence: 1250, vat_mode: "none", vat_pence: 0,
    total_pence: 59_650, status: "sent", replaces_invoice_id: null, family_email_status: "sent", nanny_email_status: "sent",
    cancel_family_email_status: null, cancel_nanny_email_status: null, sent_at: "2027-02-15T10:00:00+00:00", cancelled_at: null,
    cancel_reason: null, created_at: "2027-02-15T09:59:58+00:00",
  };

  it("maps a row", () => {
    expect(myInvoiceRow.parse(ROW)).toEqual({
      invoiceId: ROW.id, nannyId: ROW.nanny_id, seq: 1, number: "BB-SophieTaylor-270215-0001", kind: "regular_week",
      placementId: ROW.placement_id, connectionRequestId: null, parentUserId: ROW.parent_user_id, familyName: "Olivia Hartley",
      periodStart: "2027-02-08", hours: 32, shiftsPence: 58_400, expensesPence: 1250, vatMode: "none", vatPence: 0,
      totalPence: 59_650, status: "sent", replacesInvoiceId: null,
      delivery: { family: "sent", nanny: "sent", cancelFamily: null, cancelNanny: null },
      sentAt: "2027-02-15T10:00:00.000Z", cancelledAt: null, cancelReason: null, createdAt: "2027-02-15T09:59:58.000Z",
    });
  });

  it("refuses a row that doesn't fit", () => {
    expect(myInvoiceRow.safeParse({ ...ROW, status: "lost" }).success).toBe(false);
    expect(myInvoiceRow.safeParse({ ...ROW, invoice_number: "INV-0001" }).success).toBe(false);
    expect(myInvoiceRow.safeParse({ ...ROW, total_pence: "lots" }).success).toBe(false);
  });
});
