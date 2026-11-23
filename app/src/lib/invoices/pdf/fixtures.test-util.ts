/**
 * Test-only invoice PDF fixtures (plan 06 §14.5, §14.6 b2.6, §14.9 A15; fixture bank numbers 11-22-33 / 87654321
 * only). Every rate and amount is passed positionally, so no money literal is written into this non-test file (the
 * money-literal spec); the figures come from `totals.ts`, the same calculator the server and the database use.
 *
 * - HARTLEY_INVOICE: the worked example — Sophie Taylor, sole trader, not VAT registered, invoices the Hartley family
 *   for 8–12 Feb 2027: Mon–Fri 6 h, Wed 2 h at a second rate ("evening, agreed rate"), Activities.
 * - LTD_VAT_ADDED / VAT_INCLUDED: the same lines from a limited company with VAT added at 20%, and VAT included.
 * - PARTNERSHIP_INVOICE, CORRECTION_INVOICE (accents, R7), ONE_DAY_INVOICE (a trial day, no kind any more).
 * - 06b-4 rework (BAI 2026-11-12): the period is worked out from the shifts, as the database does — the earliest to
 *   the latest shift date, else the issue date. TWO_WEEK_INVOICE (1–12 Feb), EXPENSES_ONLY_INVOICE (VAT registered,
 *   no shifts), MAX_INVOICE (100 shifts with one-line descriptions over 7 Nov 2026 – 14 Feb 2027, and 40 expenses)
 *   and WORST_INVOICE (the same counts, every field at its longest).
 *
 * BB-wave1-041126/06a-build, 2026-11-04; BB-wave1-041126/06b2-build, 2026-11-06; BB-wave1-041126/06b4-server, 2026-11-12.
 */
import { londonDateOf } from "@/lib/timezone";
import { invoiceTotals, lineAmountPence, type VatSetting } from "../totals";
import type { BusinessType, ExpenseType } from "../types";
import type { InvoicePdfData, InvoicePdfExpense, InvoicePdfIssuer, InvoicePdfShift } from "./InvoicePdf";

/** One shift row; the rate is a parameter, so no money literal sits in this file. */
export const shiftOf = (date: string, hours: number, rate: number, description: string | null = null): InvoicePdfShift => ({
  date,
  description,
  hours,
  ratePence: rate,
  amountPence: lineAmountPence(hours, rate),
});

export const expenseOf = (expenseType: ExpenseType, amount: number, description: string | null = null): InvoicePdfExpense => ({
  expenseType,
  description,
  amountPence: amount,
});

const issuerOf = (name: string, businessType: BusinessType, extra: Partial<InvoicePdfIssuer> = {}): InvoicePdfIssuer => ({
  name,
  businessType,
  tradingName: name,
  address: "1 Upper Street\nLondon N1 0AA",
  companyName: null,
  companyNumber: null,
  registeredOffice: null,
  partnershipName: null,
  vatNumber: null,
  ...extra,
});

const ISSUED_AT = "2027-02-15T09:30:00Z";

/** The period as the database works it out: the earliest to the latest shift date, else the issue date in London. */
function periodOf(shifts: readonly InvoicePdfShift[]): { readonly periodStart: string; readonly periodEnd: string } {
  const dates = shifts.map((s) => s.date).sort();
  const issued = londonDateOf(new Date(ISSUED_AT));
  return { periodStart: dates[0] ?? issued, periodEnd: dates.at(-1) ?? issued };
}

/** An invoice's PDF data with its period and totals worked out (`totals.ts`). */
export function invoiceOf(parts: {
  readonly number: string;
  readonly issuer: InvoicePdfIssuer;
  readonly billTo: InvoicePdfData["billTo"];
  readonly shifts: readonly InvoicePdfShift[];
  readonly expenses: readonly InvoicePdfExpense[];
  readonly vat: VatSetting;
  readonly replacesNumber?: string | null;
  readonly accountName?: string;
}): InvoicePdfData {
  const lines = [
    ...parts.shifts.map((s) => ({ kind: "shift" as const, hours: s.hours, ratePence: s.ratePence })),
    ...parts.expenses.map((e) => ({ kind: "expense" as const, amountPence: e.amountPence })),
  ];
  const t = invoiceTotals(lines, parts.vat);
  return {
    number: parts.number,
    issuedAt: ISSUED_AT,
    ...periodOf(parts.shifts),
    issuer: parts.issuer,
    billTo: parts.billTo,
    shifts: parts.shifts,
    expenses: parts.expenses,
    totals: {
      hours: t.hours,
      shiftsPence: t.shiftsPence,
      expensesPence: t.expensesPence,
      vat: { mode: parts.vat.mode, rateBp: parts.vat.rateBp, pence: t.vatPence },
      totalPence: t.totalPence,
    },
    payTo: { accountName: parts.accountName ?? parts.issuer.name, sortCode: "112233", accountNumber: "87654321" },
    replacesNumber: parts.replacesNumber ?? null,
  };
}

/** The fixture rates (positional, as the money-literal spec asks): her own and the evening's agreed rate. */
export const exampleShifts = (rate: number, eveningRate: number): readonly InvoicePdfShift[] => [
  shiftOf("2027-02-08", 6, rate),
  shiftOf("2027-02-09", 6, rate),
  shiftOf("2027-02-10", 6, rate),
  shiftOf("2027-02-11", 6, rate),
  shiftOf("2027-02-12", 6, rate),
  shiftOf("2027-02-10", 2, eveningRate, "evening, agreed rate"),
];
const EXAMPLE_SHIFTS = exampleShifts(1800, 2200);
const EXAMPLE_EXPENSES = [expenseOf("activities", 1250, "Soft play, Islington")];
const NO_VAT: VatSetting = { mode: "none", rateBp: null };
const HARTLEY = { name: "Olivia Hartley", email: "admin+b06-11@babybloomnannies.co.uk" };

export const HARTLEY_INVOICE: InvoicePdfData = invoiceOf({
  number: "BB-SophieTaylor-270215-0001",
  issuer: issuerOf("Sophie Taylor", "sole_trader"),
  billTo: HARTLEY,
  shifts: EXAMPLE_SHIFTS,
  expenses: EXAMPLE_EXPENSES,
  vat: NO_VAT,
});

export const LTD_VAT_ADDED: InvoicePdfData = invoiceOf({
  number: "BB-SophieTaylor-270215-0002",
  issuer: issuerOf("Sophie Taylor", "limited_company", {
    tradingName: "Taylor Childcare",
    companyName: "Taylor Childcare Ltd",
    companyNumber: "12345678",
    registeredOffice: "20 Market Road\nLondon N7 9PW",
    vatNumber: "GB123456789",
  }),
  billTo: HARTLEY,
  shifts: EXAMPLE_SHIFTS,
  expenses: EXAMPLE_EXPENSES,
  vat: { mode: "added", rateBp: 2000 },
});

export const VAT_INCLUDED: InvoicePdfData = invoiceOf({
  number: "BB-SophieTaylor-270215-0003",
  issuer: issuerOf("Sophie Taylor", "sole_trader", { vatNumber: "GB123456789012" }),
  billTo: HARTLEY,
  shifts: EXAMPLE_SHIFTS,
  expenses: EXAMPLE_EXPENSES,
  vat: { mode: "included", rateBp: 2000 },
});

export const PARTNERSHIP_INVOICE: InvoicePdfData = invoiceOf({
  number: "BB-SophieTaylor-270215-0004",
  issuer: issuerOf("Sophie Taylor", "partnership", { tradingName: "Taylor & Shah", partnershipName: "Taylor & Shah Childcare" }),
  billTo: HARTLEY,
  shifts: [shiftOf("2027-02-08", 8.75, 1800)],
  expenses: [],
  vat: NO_VAT,
});

/** The correction (brief §0.8), from a nanny trading under a name with accents (plan R7). */
export const CORRECTION_INVOICE: InvoicePdfData = invoiceOf({
  number: "BB-LucjaWisniewska-270215-0003",
  issuer: issuerOf("Łucja Wiśniewska", "sole_trader", { tradingName: "Zoë Ó Briain Childcare", address: "22 Mare Street\nLondon E8 1HY" }),
  billTo: { name: "Kateřina Dvořák", email: "admin+b06-14@babybloomnannies.co.uk" },
  shifts: [shiftOf("2027-02-08", 7, 1800, "Café, then Łazienki-style park walk"), shiftOf("2027-02-09", 7, 1800)],
  expenses: [],
  vat: NO_VAT,
  replacesNumber: "BB-LucjaWisniewska-270212-0001",
});

/** One day's work (a trial day, say "trial" in the description if she wants): the period is that date. */
export const ONE_DAY_INVOICE: InvoicePdfData = invoiceOf({
  number: "BB-SophieTaylor-270215-0005",
  issuer: issuerOf("Sophie Taylor", "sole_trader"),
  billTo: { name: "Yusuf Ahmed", email: "admin+b06-12@babybloomnannies.co.uk" },
  shifts: [shiftOf("2027-02-03", 4, 1800)],
  expenses: [expenseOf("travel", 640, "Bus to the trial")],
  vat: NO_VAT,
});

const BLOCKS = ["morning", "midday", "afternoon", "evening"];
const EXPENSE_CYCLE: readonly ExpenseType[] = ["food", "activities", "travel", "supplies", "other"];
/** The `i`th London date from 7 Nov 2026: 100 of them run to 14 Feb 2027. */
const dayFrom7Nov = (i: number): string => new Date(Date.UTC(2026, 10, 7 + i)).toISOString().slice(0, 10);
const LTD_ISSUER = issuerOf("Sophie Taylor", "limited_company", {
  tradingName: "Taylor Childcare",
  companyName: "Taylor Childcare Ltd",
  companyNumber: "12345678",
  registeredOffice: "20 Market Road\nLondon N7 9PW",
  vatNumber: "GB123456789",
});

/** Two weeks, Mon–Fri, one at a second rate, and an expense: "1–12 Feb 2027". */
export const TWO_WEEK_INVOICE: InvoicePdfData = invoiceOf({
  number: "BB-SophieTaylor-270215-0007",
  issuer: issuerOf("Sophie Taylor", "sole_trader"),
  billTo: { name: "Olivia Hartley", email: "admin+b06-11@babybloomnannies.co.uk" },
  shifts: [
    ...["2027-02-01", "2027-02-02", "2027-02-03", "2027-02-04", "2027-02-05", "2027-02-08", "2027-02-09", "2027-02-10", "2027-02-11", "2027-02-12"]
      .map((date) => shiftOf(date, 7.5, 1800)),
    shiftOf("2027-02-10", 2, 2200, "evening, agreed rate"),
  ],
  expenses: [expenseOf("travel", 640, "Bus to the park")],
  vat: { mode: "none", rateBp: null },
});

/** Expenses only, from a VAT-registered company: no childcare table and no Childcare or VAT line (reading 6). */
export const EXPENSES_ONLY_INVOICE: InvoicePdfData = invoiceOf({
  number: "BB-SophieTaylor-270215-0008",
  issuer: LTD_ISSUER,
  billTo: { name: "Olivia Hartley", email: "admin+b06-11@babybloomnannies.co.uk" },
  shifts: [],
  expenses: [expenseOf("activities", 1250, "Soft play"), expenseOf("travel", 640, "Bus")],
  vat: { mode: "added", rateBp: 2000 },
});

/** The most lines an invoice can hold (100 shifts with one-line descriptions, 40 expenses; BAI 2026-11-12). */
export const MAX_INVOICE: InvoicePdfData = invoiceOf({
  number: "BB-SophieTaylor-270215-0006",
  issuer: LTD_ISSUER,
  billTo: HARTLEY,
  shifts: Array.from({ length: 100 }, (_, i) => shiftOf(dayFrom7Nov(i), 8, 1800, `${BLOCKS[i % 4]} care`)),
  expenses: Array.from({ length: 40 }, (_, i) => expenseOf(EXPENSE_CYCLE[i % 5], 950 + i, `Receipt ${i + 1}`)),
  vat: { mode: "added", rateBp: 2000 },
});

/** `n` characters of plain words ending in `tail` (a description at the form's longest). */
const longText = (n: number, tail: string): string => `${"Park, library and lunch with ".repeat(10)}`.slice(0, n - tail.length - 1) + ` ${tail}`;

/**
 * Every field at its longest (review React H1): 100 shifts and 40 expenses with 120-character descriptions, a
 * 70-character trading name and account name, a 160-character company name, a 6-line 200-character address and
 * registered office. Long text adds pages; a row and the closing block are never split.
 */
export const WORST_INVOICE: InvoicePdfData = invoiceOf({
  number: "BB-MaximilianaFeatherstonehaughWo-270215-10000",
  issuer: issuerOf("Maximiliana Featherstonehaugh-Wolfeschlegelsteinhausen", "limited_company", {
    tradingName: "Featherstonehaugh Family Childcare and Early Years Learning Services UK",
    companyName: `${"Featherstonehaugh Childcare Holdings and Early Years ".repeat(3)}Ltd`.slice(0, 160),
    companyNumber: "SC123456",
    registeredOffice: "Flat 12, Wolfeschlegelsteinhausen House\n1234 Upper Richmond Road West\nEast Sheen\nRichmond upon Thames\nGreater London\nSW14 8AA, United Kingdom",
    address: "Flat 12, Wolfeschlegelsteinhausen House\n1234 Upper Richmond Road West\nEast Sheen\nRichmond upon Thames\nGreater London\nSW14 8AA, United Kingdom",
    vatNumber: "GB123456789012",
  }),
  billTo: { name: "Olivia Hartley-Featherstonehaugh", email: "admin+b06-11@babybloomnannies.co.uk" },
  shifts: Array.from({ length: 100 }, (_, i) => shiftOf(dayFrom7Nov(i), 8, 1800, longText(120, `end of shift ${i + 1}`))),
  expenses: Array.from({ length: 40 }, (_, i) => expenseOf(EXPENSE_CYCLE[i % 5], 950 + i, longText(120, `end of receipt ${i + 1}`))),
  vat: { mode: "added", rateBp: 2000 },
  accountName: "Maximiliana Featherstonehaugh-Wolfeschlegelsteinhausen Childcare Ltd",
});
