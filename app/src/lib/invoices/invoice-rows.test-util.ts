/**
 * Test-only rows for the 06b-4 action and review specs: her invoices as the database returns them (the list's
 * columns, which also carry everything the cap count and the delivery reads ask for), her issuer, her bank row, a
 * resolved target and a created invoice. Fixture numbers only (11-22-33 / 87654321). Amounts are passed positionally
 * (the money-literal rule scans this file: only `.test.` files are exempt), as `pdf/fixtures.test-util.ts` does.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */

export const NANNY_ID = "b0600000-0000-4000-8000-000000000101";
export const NANNY_USER = "b0600000-0000-4000-8000-000000000001";
export const PARENT_USER = "b0600000-0000-4000-8000-000000000011";
export const OTHER_PARENT = "b0600000-0000-4000-8000-000000000012";
export const PLACEMENT = "b0600000-0000-4000-8000-000000000411";
export const CONNECTION = "b0600000-0000-4000-8000-000000000511";
export const INVOICE = "b0600000-0000-4000-8000-000000009001";
export const NOW = new Date("2027-02-15T10:00:00Z");
export const NUMBER = "BB-SophieTaylor-270215-0001";
export const FAMILY_EMAIL = "admin+b06-11@babybloomnannies.co.uk";
export const NANNY_EMAIL = "admin+b06-1@babybloomnannies.co.uk";
/** The worked example's agreed rate and evening rate (pence an hour), and the Activities expense (pence). */
export const RATE = 1800;
export const EVENING_RATE = 2200;
export const ACTIVITIES = 1250;

export const ISSUER = {
  business_type: "sole_trader", name: "Sophie Taylor", trading_name: "Sophie Taylor", trading_name_source: "name",
  address: "1 Upper Street\nLondon\nN1 0AA", company_name: null, company_number: null, registered_office: null,
  partnership_name: null, vat_mode: "none", vat_rate_bp: null, vat_number: null,
  business_updated_at: "2027-02-01T09:00:00.111111+00:00",
};

/** Answers the masked read and the full read alike (zod drops the columns a read didn't ask for). */
export const BANK_ROW = {
  account_name: "Sophie Taylor", sort_code: "112233", account_number: "87654321", sort_code_last2: "33",
  account_last4: "4321", updated_at: "2027-02-01T09:00:00.222222+00:00",
};

export const TARGET = {
  kind: "regular_week" as const,
  targetId: PLACEMENT,
  parentUserId: PARENT_USER,
  familyName: "Olivia Hartley",
  familyEmailHint: "admin+b06-11@…",
  area: "Islington",
  prefill: { shifts: [], ratePence: RATE, rateSource: "placement" as const },
};

export const TRIAL_TARGET = {
  ...TARGET,
  kind: "trial_shift" as const,
  targetId: CONNECTION,
  prefill: { shifts: [{ date: "2027-02-03", hours: null, ratePence: RATE, description: null }], ratePence: RATE, rateSource: "position" as const },
};

export const shift = (date: string, hours: number, ratePence: number, description: string | null = null) =>
  ({ kind: "shift", date, hours, ratePence, description });
export const expense = (expenseType: string, amountPence: number, description: string | null = null) =>
  ({ kind: "expense", expenseType, amountPence, description });

/** The worked example (plan 14.4 harness 5): w/c 8 Feb 2027, Mon–Fri 6 h, a Wed evening 2 h at a higher rate, Activities. */
export const LINES = [
  shift("2027-02-08", 6, RATE), shift("2027-02-09", 6, RATE), shift("2027-02-10", 6, RATE), shift("2027-02-11", 6, RATE),
  shift("2027-02-12", 6, RATE), shift("2027-02-10", 2, EVENING_RATE, "evening, agreed rate"), expense("activities", ACTIVITIES),
];

export const DRAFT_IN = { kind: "regular_week", targetId: PLACEMENT, periodStart: "2027-02-08", lines: LINES, replacesInvoiceId: null };

/** A header's money columns, positionally. */
export const money = (shifts: number, expenses: number, vat: number, total: number) =>
  ({ shifts_pence: shifts, expenses_pence: expenses, vat_pence: vat, total_pence: total });

let seq = 0;
/** One of her invoices as the list reads it; sent to the Hartleys for w/c 8 Feb (30 h at the agreed rate) unless overridden. */
export function invoiceRow(over: Readonly<Record<string, unknown>> = {}): Record<string, unknown> {
  seq += 1;
  return {
    id: `b0600000-0000-4000-8000-0000000080${String(seq % 100).padStart(2, "0")}`,
    nanny_id: NANNY_ID, invoice_seq: seq, invoice_number: `BB-SophieTaylor-270210-${String(seq).padStart(4, "0")}`,
    kind: "regular_week", placement_id: PLACEMENT, connection_request_id: null, parent_user_id: PARENT_USER,
    family_name: "Olivia Hartley", period_start: "2027-02-08", hours: 30, ...money(30 * RATE, 0, 0, 30 * RATE),
    vat_mode: "none", status: "sent", replaces_invoice_id: null,
    family_email_status: "sent", nanny_email_status: "sent", cancel_family_email_status: null, cancel_nanny_email_status: null,
    sent_at: "2027-02-14T10:00:00+00:00", cancelled_at: null, cancel_reason: null, created_at: "2027-02-14T10:00:00+00:00",
    ...over,
  };
}

const lineRow = (n: number, date: string, hours: number, rate: number, description: string | null = null) => ({
  line_no: n, kind: "shift", shift_date: date, hours, rate_pence: rate, expense_type: null, description, amount_pence: hours * rate,
});
const expenseRow = (n: number, type: string, amount: number) => ({
  line_no: n, kind: "expense", shift_date: null, hours: null, rate_pence: null, expense_type: type, description: null, amount_pence: amount,
});

/** `nanny_invoice_create`'s reply for the worked example: 32 h, childcare 584.00, expenses 12.50, no VAT. */
export const CREATED = {
  status: "created", invoice_id: INVOICE, invoice_seq: 1, invoice_number: NUMBER, invoice_status: "sending", kind: "regular_week",
  placement_id: PLACEMENT, connection_request_id: null, period_start: "2027-02-08", hours: 32,
  ...money(30 * RATE + 2 * EVENING_RATE, ACTIVITIES, 0, 30 * RATE + 2 * EVENING_RATE + ACTIVITIES),
  vat_mode: "none", vat_rate_bp: null, parent_user_id: PARENT_USER, family_name: "Olivia Hartley",
  family_email: FAMILY_EMAIL, nanny_name: "Sophie Taylor", nanny_email: NANNY_EMAIL, account_last4: "4321",
  pdf_path: `${NANNY_ID}/${INVOICE}.pdf`, replaces_invoice_id: null, replaces_number: null,
  created_at: "2027-02-15T10:00:00.123456+00:00", business_type: "sole_trader", issuer_trading_name: "Sophie Taylor",
  issuer_address: "1 Upper Street\nLondon\nN1 0AA", company_name: null, company_number: null, registered_office: null,
  partnership_name: null, vat_number: null,
  lines: [
    lineRow(1, "2027-02-08", 6, RATE), lineRow(2, "2027-02-09", 6, RATE), lineRow(3, "2027-02-10", 6, RATE), lineRow(4, "2027-02-11", 6, RATE),
    lineRow(5, "2027-02-12", 6, RATE), lineRow(6, "2027-02-10", 2, EVENING_RATE, "evening, agreed rate"), expenseRow(7, "activities", ACTIVITIES),
  ],
};

/** Anything a log line must never carry: bank digits, emails, names, the address. */
export const SECRETS = /112233|11-22-33|87654321|admin\+b06|Olivia|Hartley|Sophie|Taylor|Upper Street/;
