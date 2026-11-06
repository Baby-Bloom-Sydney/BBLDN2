/**
 * The store (plan 06 step 6; R1; §14.4 b2.4): the only modules that touch amendment 21's four tables.
 * - Switch off → `invoices_disabled` before any client is made; not a proof → `invalid` before any read.
 * - Screens get masks only; the full numbers come back from one named read, for the PDF. Bank details are 3 fields.
 * - Every write goes through amendment 21's functions with the nanny id from the proof, never from the input. An
 *   invoice is sent as `p_lines` with the total her review showed (`p_expected_total_pence`).
 * - Her own list and an invoice's lines (for a correction) are hers only.
 * - Readers' rows: sent (or sent + cancelled) with a PDF only; an admin proof first.
 * - Nothing logged ever carries a bank digit, an email or a name (a spy on console.* checks every test).
 * Fixture numbers only (11-22-33 / 87654321).
 *
 * BB-wave1-041126/06a-build, 2026-11-04; BB-wave1-041126/06b2-build, 2026-11-06.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { getNannyId, requireAdmin, createAdminClient } = vi.hoisted(() => ({
  getNannyId: vi.fn(),
  requireAdmin: vi.fn(),
  createAdminClient: vi.fn(),
}));
vi.mock("@/lib/actions/connection", () => ({ getNannyId }));
vi.mock("@/lib/admin/require-admin", () => ({ requireAdmin }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import { proveAdmin, type AdminProof } from "@/lib/calls/admin-proof";
import { fakeAdmin, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";
import { proveNanny, type NannyProof } from "./nanny-proof";
import {
  countTowardsDailyCap,
  createInvoice,
  finishInvoice,
  readFamilyRows,
  readFullDetailsForInvoicePdf,
  readMaskedDetails,
  readMyInvoiceLines,
  readMyInvoices,
  readPlacementWeekRows,
  saveDetails,
} from "./store";

const NANNY_ID = "b0600000-0000-4000-8000-000000000101";
const OTHER_NANNY = "b0600000-0000-4000-8000-000000000102";
const NANNY_USER = "b0600000-0000-4000-8000-000000000001";
const ADMIN_USER = "b0600000-0000-4000-8000-000000000031";
const PARENT_USER = "b0600000-0000-4000-8000-000000000011";
const PLACEMENT = "b0600000-0000-4000-8000-000000000411";
const INVOICE = "b0600000-0000-4000-8000-000000009001";
const NOW = new Date("2027-02-15T10:00:00Z");

const DETAILS_IN = { accountName: "Sophie Taylor", sortCode: "11-22-33", accountNumber: "87654321" };
const shift = (date: string, hours: number, ratePence: number, description: string | null = null) =>
  ({ kind: "shift", date, hours, ratePence, description });
/** The worked example (plan 14.4 harness 5), w/c 8 Feb 2027. */
const LINES = [
  shift("2027-02-08", 6, 1800), shift("2027-02-09", 6, 1800), shift("2027-02-10", 6, 1800), shift("2027-02-11", 6, 1800),
  shift("2027-02-12", 6, 1800), shift("2027-02-10", 2, 2200, "evening, agreed rate"),
  { kind: "expense", expenseType: "activities", amountPence: 1250, description: null },
];
const P_LINES = [
  { kind: "shift", shift_date: "2027-02-08", hours: 6, rate_pence: 1800 }, { kind: "shift", shift_date: "2027-02-09", hours: 6, rate_pence: 1800 },
  { kind: "shift", shift_date: "2027-02-10", hours: 6, rate_pence: 1800 }, { kind: "shift", shift_date: "2027-02-11", hours: 6, rate_pence: 1800 },
  { kind: "shift", shift_date: "2027-02-12", hours: 6, rate_pence: 1800 },
  { kind: "shift", shift_date: "2027-02-10", hours: 2, rate_pence: 2200, description: "evening, agreed rate" },
  { kind: "expense", expense_type: "activities", amount_pence: 1250 },
];
const EXPECTED = 59_650;
const DRAFT = { invoiceId: INVOICE, kind: "regular_week", targetId: PLACEMENT, periodStart: "2027-02-08", lines: LINES, replacesInvoiceId: null };
const lineRow = (n: number, date: string, hours: number, rate: number, description: string | null = null) => ({
  line_no: n, kind: "shift", shift_date: date, hours, rate_pence: rate, expense_type: null, description, amount_pence: hours * rate,
});
const CREATED = {
  status: "created", invoice_id: INVOICE, invoice_seq: 1, invoice_number: "BB-SophieTaylor-270215-0001", invoice_status: "sending", kind: "regular_week",
  placement_id: PLACEMENT, connection_request_id: null, period_start: "2027-02-08", hours: 32, shifts_pence: 58_400, expenses_pence: 1250,
  vat_mode: "none", vat_rate_bp: null, vat_pence: 0, total_pence: 59_650, parent_user_id: PARENT_USER, family_name: "Olivia Hartley",
  family_email: "admin+b06-11@babybloomnannies.co.uk", nanny_name: "Sophie Taylor", nanny_email: "admin+b06-1@babybloomnannies.co.uk",
  account_last4: "4321", pdf_path: `${NANNY_ID}/${INVOICE}.pdf`, replaces_invoice_id: null, replaces_number: null,
  created_at: "2027-02-15T10:00:00.123456+00:00", business_type: "sole_trader", issuer_trading_name: "Sophie Taylor",
  issuer_address: "1 Upper Street\nLondon\nN1 0AA", company_name: null, company_number: null, registered_office: null,
  partnership_name: null, vat_number: null,
  lines: [
    lineRow(1, "2027-02-08", 6, 1800), lineRow(2, "2027-02-09", 6, 1800), lineRow(3, "2027-02-10", 6, 1800), lineRow(4, "2027-02-11", 6, 1800),
    lineRow(5, "2027-02-12", 6, 1800), lineRow(6, "2027-02-10", 2, 2200, "evening, agreed rate"),
    { line_no: 7, kind: "expense", shift_date: null, hours: null, rate_pence: null, expense_type: "activities", description: null, amount_pence: 1250 },
  ],
};

let f: FakeAdmin;
let nanny: NannyProof;
let admin: AdminProof;
let selects: Array<[string, string]>;
const consoleSpies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeEach(async () => {
  vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
  f = fakeAdmin();
  selects = [];
  const from = f.client.from.bind(f.client);
  Object.assign(f.client, {
    from: (table: string) => {
      const builder = from(table);
      return { ...builder, select: (columns: string) => (selects.push([table, columns]), builder.select(columns)) };
    },
  });
  createAdminClient.mockReset().mockReturnValue(f.client);
  getNannyId.mockResolvedValue({ nannyId: NANNY_ID, userId: NANNY_USER });
  requireAdmin.mockResolvedValue({ userId: ADMIN_USER, error: null });
  const n = await proveNanny();
  const a = await proveAdmin();
  if (!n || !a) throw new Error("fixture proofs");
  nanny = n;
  admin = a;
  consoleSpies.splice(0);
  for (const level of ["error", "warn", "log", "info"] as const) {
    consoleSpies.push(vi.spyOn(console, level).mockImplementation(() => {}));
  }
});

afterEach(() => {
  const logged = JSON.stringify(consoleSpies.flatMap((s) => s.mock.calls));
  expect(logged).not.toMatch(/87654321|112233|11-22-33|@babybloomnannies|Hartley|Taylor|Upper Street|evening/);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const opsOn = (table: string) => f.ops.filter((o) => o.table === table);
const filtersOf = (table: string) => opsOn(table).flatMap((o) => o.filters);
const columnsOn = (table: string) => selects.filter(([t]) => t === table).map(([, c]) => c).join(",");

describe("with the switch off", () => {
  it("every operation refuses before a client is made", async () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "");
    const results = await Promise.all([
      readMaskedDetails(nanny),
      readFullDetailsForInvoicePdf(nanny),
      saveDetails(nanny, DETAILS_IN),
      createInvoice(nanny, DRAFT, "4321", EXPECTED, NOW),
      finishInvoice(nanny, INVOICE, { kind: "failed" }),
      countTowardsDailyCap(nanny, NOW),
      readMyInvoices(nanny),
      readMyInvoiceLines(nanny, INVOICE),
      readPlacementWeekRows(admin, PLACEMENT, "2027-02-08"),
      readFamilyRows(admin, PARENT_USER),
    ]);
    for (const r of results) expect(r).toEqual({ ok: false, error: "invoices_disabled" });
    expect(createAdminClient).not.toHaveBeenCalled();
    expect(f.ops).toEqual([]);
    expect(f.rpcCalls).toEqual([]);
  });
});

describe("without a real proof", () => {
  it("refuses as invalid before any read — a look-alike or another kind of proof is not hers", async () => {
    const lookAlike = { kind: "nanny_proof", nannyId: OTHER_NANNY, userId: NANNY_USER } as unknown as NannyProof;
    const results = await Promise.all([
      readMaskedDetails(lookAlike),
      readFullDetailsForInvoicePdf(lookAlike),
      saveDetails(lookAlike, DETAILS_IN),
      createInvoice(lookAlike, DRAFT, "4321", EXPECTED, NOW),
      finishInvoice(lookAlike, INVOICE, { kind: "failed" }),
      countTowardsDailyCap(lookAlike, NOW),
      readMyInvoices(lookAlike),
      readMyInvoiceLines(lookAlike, INVOICE),
      readPlacementWeekRows(nanny as unknown as AdminProof, PLACEMENT, "2027-02-08"),
      readFamilyRows({ kind: "admin_proof", userId: ADMIN_USER } as unknown as AdminProof, PARENT_USER),
    ]);
    for (const r of results) expect(r).toEqual({ ok: false, error: "invalid" });
    expect(f.ops).toEqual([]);
    expect(f.rpcCalls).toEqual([]);
  });
});

describe("when the service client can't be made or a read throws", () => {
  it("answers error, logged by name only", async () => {
    createAdminClient.mockImplementation(() => { throw new Error("Missing Supabase admin credentials"); });
    for (const r of await Promise.all([readMaskedDetails(nanny), saveDetails(nanny, DETAILS_IN), createInvoice(nanny, DRAFT, "4321", EXPECTED, NOW),
      finishInvoice(nanny, INVOICE, { kind: "failed" }), countTowardsDailyCap(nanny, NOW), readFamilyRows(admin, PARENT_USER),
      readMyInvoices(nanny), readMyInvoiceLines(nanny, INVOICE)])) {
      expect(r).toEqual({ ok: false, error: "error" });
    }
    expect(console.error).toHaveBeenCalledWith("[invoices] createAdminClient failed", { code: "Error" });
    createAdminClient.mockReturnValue(f.client);
    f.reads.nanny_payment_details = () => { throw new TypeError("network"); };
    f.reads.nanny_invoices = () => { throw new TypeError("network"); };
    expect(await readMaskedDetails(nanny)).toEqual({ ok: false, error: "error" });
    expect(await countTowardsDailyCap(nanny, NOW)).toEqual({ ok: false, error: "error" });
    expect(await readMyInvoices(nanny)).toEqual({ ok: false, error: "error" });
  });
});

describe("readMaskedDetails", () => {
  it("reads her row by the proof's nanny id, selecting the masks only (bank fields only: 14.4)", async () => {
    f.reads.nanny_payment_details = { account_name: "Sophie Taylor", sort_code_last2: "33", account_last4: "4321", updated_at: "2027-02-01T09:00:00+00:00" };
    expect(await readMaskedDetails(nanny)).toEqual({
      ok: true,
      value: { accountName: "Sophie Taylor", sortCodeLast2: "33", accountLast4: "4321", updatedAt: "2027-02-01T09:00:00.000Z" },
    });
    expect(filtersOf("nanny_payment_details")).toEqual([["eq", "nanny_id", NANNY_ID]]);
    expect(columnsOn("nanny_payment_details")).not.toMatch(/\bsort_code\b|\baccount_number\b|trading_name|invoice_address/);
  });

  it("no row → null; a failed read or a malformed row → error (never a guess)", async () => {
    f.reads.nanny_payment_details = null;
    expect(await readMaskedDetails(nanny)).toEqual({ ok: true, value: null });
    f.reads.nanny_payment_details = { account_name: "Sophie Taylor", sort_code_last2: "112233", account_last4: "87654321" };
    expect(await readMaskedDetails(nanny)).toEqual({ ok: false, error: "error" });
    f.readErrors.nanny_payment_details = { message: "Failing row contains (112233, 87654321)", code: "XX000" };
    expect(await readMaskedDetails(nanny)).toEqual({ ok: false, error: "error" });
  });
});

describe("readFullDetailsForInvoicePdf", () => {
  it("is the one read that returns the full numbers — hers only", async () => {
    f.reads.nanny_payment_details = { account_name: "Sophie Taylor", sort_code: "112233", account_number: "87654321", account_last4: "4321" };
    expect(await readFullDetailsForInvoicePdf(nanny)).toEqual({
      ok: true,
      value: { accountName: "Sophie Taylor", sortCode: "112233", accountNumber: "87654321", accountLast4: "4321" },
    });
    expect(filtersOf("nanny_payment_details")).toEqual([["eq", "nanny_id", NANNY_ID]]);
    expect(columnsOn("nanny_payment_details")).toBe("account_name, sort_code, account_number, account_last4");
    f.reads.nanny_payment_details = null;
    expect(await readFullDetailsForInvoicePdf(nanny)).toEqual({ ok: true, value: null });
    f.reads.nanny_payment_details = { account_name: "x", sort_code: "1122", account_number: "8765", account_last4: "4321" };
    expect(await readFullDetailsForInvoicePdf(nanny)).toEqual({ ok: false, error: "error" });
  });
});

describe("saveDetails (3 fields: 14.4)", () => {
  it("saves the parsed details for the proof's nanny and replies with masks only", async () => {
    f.rpcResults.nanny_payment_details_save = {
      data: { status: "saved", first_save: true, changed: true, sort_code_last2: "33", account_last4: "4321" },
      error: null,
    };
    const r = await saveDetails(nanny, { ...DETAILS_IN, nannyId: OTHER_NANNY, tradingName: "ignored", invoiceAddress: "ignored" });
    expect(r).toEqual({ ok: true, value: { firstSave: true, changed: true, masks: { sortCodeLast2: "33", accountLast4: "4321" } } });
    expect(f.rpcCalls).toEqual([{
      fn: "nanny_payment_details_save",
      args: { p_nanny: NANNY_ID, p_account_name: "Sophie Taylor", p_sort_code: "112233", p_account_number: "87654321" },
    }]);
    expect(JSON.stringify(r)).not.toMatch(/87654321|112233/);
  });

  it("refuses bad input without calling the database", async () => {
    expect(await saveDetails(nanny, { ...DETAILS_IN, sortCode: "11223" })).toEqual({ ok: false, error: "invalid" });
    expect(await saveDetails(nanny, { ...DETAILS_IN, accountName: "Baby Bloom" })).toEqual({ ok: false, error: "invalid" });
    expect(await saveDetails(nanny, "not an object")).toEqual({ ok: false, error: "invalid" });
    expect(f.rpcCalls).toEqual([]);
  });

  it("maps the database's refusal, a failure and a reply it doesn't recognise", async () => {
    f.rpcResults.nanny_payment_details_save = { data: { status: "invalid" }, error: null };
    expect(await saveDetails(nanny, DETAILS_IN)).toEqual({ ok: false, error: "invalid" });
    f.rpcResults.nanny_payment_details_save = { data: { status: "nanny_inactive" }, error: null };
    expect(await saveDetails(nanny, DETAILS_IN)).toEqual({ ok: false, error: "nanny_inactive" });
    f.rpcResults.nanny_payment_details_save = { data: null, error: { message: "Failing row contains (112233, 87654321)", code: "23514" } };
    expect(await saveDetails(nanny, DETAILS_IN)).toEqual({ ok: false, error: "error" });
    expect(console.error).toHaveBeenLastCalledWith("[invoices] nanny_payment_details_save failed", { code: "23514" });
    f.rpcResults.nanny_payment_details_save = { data: { status: "saved", first_save: "yes" }, error: null };
    expect(await saveDetails(nanny, DETAILS_IN)).toEqual({ ok: false, error: "error" });
  });
});

describe("createInvoice (p_lines and the reviewed total: 14.4)", () => {
  it("creates through the database with the proof's nanny id, her lines in order and the total she reviewed", async () => {
    f.rpcResults.nanny_invoice_create = { data: CREATED, error: null };
    const r = await createInvoice(nanny, { ...DRAFT, nannyId: OTHER_NANNY, parentUserId: OTHER_NANNY }, "4321", EXPECTED, NOW);
    expect(f.rpcCalls).toEqual([{
      fn: "nanny_invoice_create",
      args: {
        p_id: INVOICE, p_nanny: NANNY_ID, p_kind: "regular_week", p_target: PLACEMENT, p_period_start: "2027-02-08",
        p_lines: P_LINES, p_expected_total_pence: EXPECTED, p_replaces: null, p_account_last4: "4321", p_daily_cap: 10, p_stale_minutes: 10,
      },
    }]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value).toMatchObject({
      invoiceId: INVOICE, seq: 1, number: "BB-SophieTaylor-270215-0001", status: "sending", kind: "regular_week", placementId: PLACEMENT,
      periodStart: "2027-02-08", hours: 32, shiftsPence: 58_400, expensesPence: 1250, vat: { mode: "none", rateBp: null, pence: 0 },
      totalPence: 59_650, familyName: "Olivia Hartley", nannyName: "Sophie Taylor", accountLast4: "4321", createdAt: "2027-02-15T10:00:00.123Z",
      issuer: {
        businessType: "sole_trader", tradingName: "Sophie Taylor", address: "1 Upper Street\nLondon\nN1 0AA", companyName: null,
        companyNumber: null, registeredOffice: null, partnershipName: null, vatNumber: null,
      },
    });
    expect(r.value.lines.map((l) => [l.lineNo, l.kind, l.amountPence])).toEqual([
      [1, "shift", 10_800], [2, "shift", 10_800], [3, "shift", 10_800], [4, "shift", 10_800], [5, "shift", 10_800], [6, "shift", 4400], [7, "expense", 1250],
    ]);
    expect(r.value.lines[5]).toEqual({ lineNo: 6, kind: "shift", date: "2027-02-10", hours: 2, ratePence: 2200, description: "evening, agreed rate", amountPence: 4400 });
  });

  it("prints the replaced invoice's number for a correction; numeric text in the reply is read as numbers", async () => {
    f.rpcResults.nanny_invoice_create = {
      data: { ...CREATED, invoice_seq: 3, invoice_number: "BB-SophieTaylor-270215-0003", replaces_invoice_id: "b0600000-0000-4000-8000-000000009000",
        replaces_number: "BB-SophieTaylor-270212-0001", hours: "32.00" },
      error: null,
    };
    const r = await createInvoice(nanny, { ...DRAFT, replacesInvoiceId: "b0600000-0000-4000-8000-000000009000" }, "4321", EXPECTED, NOW);
    expect(r.ok && [r.value.number, r.value.replacesNumber, r.value.hours]).toEqual(["BB-SophieTaylor-270215-0003", "BB-SophieTaylor-270212-0001", 32]);
  });

  it.each(["future", "not_hers", "no_trial", "wrong_date", "no_details", "no_address", "bad_lines", "changed", "bad_replaces",
    "already_replaced", "no_contact", "nanny_inactive", "cap", "busy", "invalid", "in_progress", "already_done", "already_failed"] as const)(
    "passes the database's %s refusal through",
    async (status) => {
      f.rpcResults.nanny_invoice_create = { data: { status }, error: null };
      expect(await createInvoice(nanny, DRAFT, "4321", EXPECTED, NOW)).toEqual({ ok: false, error: status });
    },
  );

  it("refuses before the database: a future period → future; a bad line → bad_lines; a bad header, last-4 or total → invalid", async () => {
    expect(await createInvoice(nanny, { ...DRAFT, periodStart: "2027-02-22", lines: [shift("2027-02-22", 6, 1800)] }, "4321", EXPECTED, NOW))
      .toEqual({ ok: false, error: "future" });
    expect(await createInvoice(nanny, { ...DRAFT, lines: [shift("2027-02-08", 0.1, 1800)] }, "4321", EXPECTED, NOW)).toEqual({ ok: false, error: "bad_lines" });
    expect(await createInvoice(nanny, { ...DRAFT, lines: [shift("2027-02-15", 6, 1800)] }, "4321", EXPECTED, NOW)).toEqual({ ok: false, error: "bad_lines" });
    expect(await createInvoice(nanny, { ...DRAFT, lines: [] }, "4321", EXPECTED, NOW)).toEqual({ ok: false, error: "bad_lines" });
    expect(await createInvoice(nanny, { ...DRAFT, kind: "meet_and_greet" }, "4321", EXPECTED, NOW)).toEqual({ ok: false, error: "invalid" });
    expect(await createInvoice(nanny, DRAFT, "87654321", EXPECTED, NOW)).toEqual({ ok: false, error: "invalid" });
    for (const total of [0, -1, 596.5, Number.NaN, 2 ** 31]) {
      expect(await createInvoice(nanny, DRAFT, "4321", total, NOW)).toEqual({ ok: false, error: "invalid" });
    }
    expect(f.rpcCalls).toEqual([]);
  });

  it("a retry of the same id is never a second send: in_progress while it's sending, already_done after (security M5)", async () => {
    f.rpcResults.nanny_invoice_create = { data: { status: "in_progress", invoice_id: INVOICE, invoice_status: "sending" }, error: null };
    expect(await createInvoice(nanny, DRAFT, "4321", EXPECTED, NOW)).toEqual({ ok: false, error: "in_progress" });
    f.rpcResults.nanny_invoice_create = { data: { status: "already_done", invoice_id: INVOICE, invoice_status: "sent" }, error: null };
    expect(await createInvoice(nanny, DRAFT, "4321", EXPECTED, NOW)).toEqual({ ok: false, error: "already_done" });
  });

  it("a lock that times out (55P03) is busy, so the nanny can simply try again", async () => {
    f.rpcResults.nanny_invoice_create = { data: null, error: { message: "canceling statement due to lock timeout", code: "55P03" } };
    expect(await createInvoice(nanny, DRAFT, "4321", EXPECTED, NOW)).toEqual({ ok: false, error: "busy" });
    f.rpcResults.nanny_payment_details_save = { data: null, error: { message: "canceling statement due to lock timeout", code: "55P03" } };
    expect(await saveDetails(nanny, DETAILS_IN)).toEqual({ ok: false, error: "busy" });
  });

  it("an unknown or malformed reply, or a failure, is an error", async () => {
    for (const data of [
      { status: "made" },
      { ...CREATED, invoice_seq: 0 },
      { ...CREATED, invoice_number: "INV-0001" },
      { ...CREATED, invoice_status: "sent" },
      { ...CREATED, lines: [] },
      { ...CREATED, lines: [{ ...CREATED.lines[0], kind: "bonus" }] },
      { ...CREATED, vat_mode: "reverse" },
      { ...CREATED, business_type: "charity" },
      { ...CREATED, issuer_address: null },
    ]) {
      f.rpcResults.nanny_invoice_create = { data, error: null };
      expect(await createInvoice(nanny, DRAFT, "4321", EXPECTED, NOW)).toEqual({ ok: false, error: "error" });
    }
    f.rpcResults.nanny_invoice_create = { data: null, error: { message: "Failing row contains (admin+b06-11@babybloomnannies.co.uk)", code: "XX000" } };
    expect(await createInvoice(nanny, DRAFT, "4321", EXPECTED, NOW)).toEqual({ ok: false, error: "error" });
  });
});

describe("finishInvoice", () => {
  it("records sent with both deliveries, or failed, for the proof's nanny", async () => {
    f.rpcResults.nanny_invoice_finish = { data: { status: "sent", invoice_id: INVOICE }, error: null };
    expect(await finishInvoice(nanny, INVOICE, { kind: "sent", family: "failed", nanny: "sent" })).toEqual({ ok: true, value: "sent" });
    f.rpcResults.nanny_invoice_finish = { data: { status: "failed", invoice_id: INVOICE }, error: null };
    expect(await finishInvoice(nanny, INVOICE, { kind: "failed" })).toEqual({ ok: true, value: "failed" });
    expect(f.rpcCalls.map((c) => c.args)).toEqual([
      { p_id: INVOICE, p_nanny: NANNY_ID, p_outcome: "sent", p_family_email_status: "failed", p_nanny_email_status: "sent" },
      { p_id: INVOICE, p_nanny: NANNY_ID, p_outcome: "failed", p_family_email_status: null, p_nanny_email_status: null },
    ]);
  });

  it.each(["not_found", "not_sending", "no_pdf", "invalid"] as const)("passes %s through", async (status) => {
    f.rpcResults.nanny_invoice_finish = { data: { status }, error: null };
    expect(await finishInvoice(nanny, INVOICE, { kind: "failed" })).toEqual({ ok: false, error: status });
  });

  it("refuses a bad id or outcome before the database; a reply for another outcome is an error", async () => {
    expect(await finishInvoice(nanny, "BB-SophieTaylor-270215-0001", { kind: "failed" })).toEqual({ ok: false, error: "invalid" });
    const bad = { kind: "sent", family: "bounced", nanny: "sent" } as unknown as Parameters<typeof finishInvoice>[2];
    expect(await finishInvoice(nanny, INVOICE, bad)).toEqual({ ok: false, error: "invalid" });
    expect(f.rpcCalls).toEqual([]);
    f.rpcResults.nanny_invoice_finish = { data: { status: "sent" }, error: null };
    expect(await finishInvoice(nanny, INVOICE, { kind: "failed" })).toEqual({ ok: false, error: "error" });
  });
});

describe("countTowardsDailyCap (the database's own count, for 06b to say so before a send)", () => {
  it("counts what she created in London's day that isn't failed — sending, sent and cancelled (security M2)", async () => {
    f.reads.nanny_invoices = [
      { id: "a", status: "sent", created_at: "2027-02-15T09:00:00+00:00" },
      { id: "b", status: "cancelled", created_at: "2027-02-15T08:00:00+00:00" },
      { id: "c", status: "sending", created_at: "2027-02-15T09:55:00+00:00" },
    ];
    expect(await countTowardsDailyCap(nanny, NOW)).toEqual({ ok: true, value: 3 });
    expect(filtersOf("nanny_invoices")).toEqual([
      ["eq", "nanny_id", NANNY_ID],
      ["in", "status", ["sending", "sent", "cancelled"]],
      ["or", "status.neq.sending,created_at.gte.2027-02-15T09:50:00.000Z", undefined],
      ["gte", "created_at", "2027-02-15T00:00:00.000Z"],
      ["lt", "created_at", "2027-02-16T00:00:00.000Z"],
      ["limit", 11, undefined],
    ]);
    f.reads.nanny_invoices = [{ id: "a", status: "sent", created_at: "garbage" }];
    expect(await countTowardsDailyCap(nanny, NOW)).toEqual({ ok: false, error: "error" });
    f.reads.nanny_invoices = { not: "a list" };
    expect(await countTowardsDailyCap(nanny, NOW)).toEqual({ ok: false, error: "error" });
    f.readErrors.nanny_invoices = { message: "x", code: "57014" };
    expect(await countTowardsDailyCap(nanny, NOW)).toEqual({ ok: false, error: "error" });
  });
});

describe("readMyInvoices (her own list: 14.6 b2.4)", () => {
  const mine = (n: number, extra: Record<string, unknown> = {}) => ({
    id: `b0600000-0000-4000-8000-00000000900${n}`, nanny_id: NANNY_ID, invoice_seq: n, invoice_number: `BB-SophieTaylor-270215-000${n}`,
    kind: "regular_week", placement_id: PLACEMENT, connection_request_id: null, parent_user_id: PARENT_USER, family_name: "Olivia Hartley",
    period_start: "2027-02-08", hours: 32, shifts_pence: 58_400, expenses_pence: 1250, vat_mode: "none", vat_pence: 0, total_pence: 59_650,
    status: "sent", replaces_invoice_id: null, family_email_status: "sent", nanny_email_status: "sent", cancel_family_email_status: null,
    cancel_nanny_email_status: null, sent_at: "2027-02-15T10:00:00+00:00", cancelled_at: null, cancel_reason: null,
    created_at: `2027-02-15T0${n}:00:00+00:00`, ...extra,
  });

  it("reads hers only, newest first, paged; a row of another nanny's is dropped; no email, bank or PDF field", async () => {
    f.reads.nanny_invoices = [mine(2), mine(1, { status: "cancelled", cancelled_at: "2027-02-15T11:00:00+00:00", cancel_reason: "wrong_hours" }), mine(3, { nanny_id: OTHER_NANNY })];
    const r = await readMyInvoices(nanny);
    expect(r.ok && r.value.map((i) => [i.number, i.status])).toEqual([["BB-SophieTaylor-270215-0002", "sent"], ["BB-SophieTaylor-270215-0001", "cancelled"]]);
    expect(filtersOf("nanny_invoices")).toEqual([
      ["eq", "nanny_id", NANNY_ID],
      ["order", "created_at", { ascending: false }],
      ["order", "id", { ascending: false }],
      ["range", 0, 499],
    ]);
    expect(columnsOn("nanny_invoices")).not.toMatch(/email\b|_email,|account|pdf_path|sort_code/);
    expect(JSON.stringify(r)).not.toMatch(/@|4321|\.pdf/);
  });

  it("a malformed row or a failed read fails the list", async () => {
    f.reads.nanny_invoices = [mine(1, { status: "lost" })];
    expect(await readMyInvoices(nanny)).toEqual({ ok: false, error: "error" });
    f.readErrors.nanny_invoices = { message: "x", code: "XX000" };
    expect(await readMyInvoices(nanny)).toEqual({ ok: false, error: "error" });
  });
});

describe("readMyInvoiceLines (the correction pre-fill: 14.3, b2.4)", () => {
  it("reads one invoice of hers with its lines, in line order", async () => {
    f.reads.nanny_invoices = { id: INVOICE, nanny_id: NANNY_ID, nanny_invoice_lines: [CREATED.lines[6], CREATED.lines[0], CREATED.lines[5]] };
    const r = await readMyInvoiceLines(nanny, INVOICE);
    expect(r.ok && r.value.map((l) => l.lineNo)).toEqual([1, 6, 7]);
    expect(r.ok && r.value[2]).toEqual({ lineNo: 7, kind: "expense", expenseType: "activities", description: null, amountPence: 1250 });
    expect(filtersOf("nanny_invoices")).toEqual([["eq", "id", INVOICE], ["eq", "nanny_id", NANNY_ID]]);
    expect(columnsOn("nanny_invoices")).toMatch(/nanny_invoice_lines\(/);
  });

  it("not hers or not there → not_found; a bad id → invalid before any read; a malformed line → error", async () => {
    f.reads.nanny_invoices = null;
    expect(await readMyInvoiceLines(nanny, INVOICE)).toEqual({ ok: false, error: "not_found" });
    f.reads.nanny_invoices = { id: INVOICE, nanny_id: OTHER_NANNY, nanny_invoice_lines: [CREATED.lines[0]] };
    expect(await readMyInvoiceLines(nanny, INVOICE)).toEqual({ ok: false, error: "not_found" });
    f.ops.length = 0;
    expect(await readMyInvoiceLines(nanny, "BB-SophieTaylor-270215-0001")).toEqual({ ok: false, error: "invalid" });
    expect(f.ops).toEqual([]);
    f.reads.nanny_invoices = { id: INVOICE, nanny_id: NANNY_ID, nanny_invoice_lines: [{ ...CREATED.lines[0], shift_date: null }] };
    expect(await readMyInvoiceLines(nanny, INVOICE)).toEqual({ ok: false, error: "error" });
  });
});

describe("the readers' rows (an admin proof first; R1: what went out, with its PDF)", () => {
  const weekRow = { id: INVOICE, invoice_seq: 3, invoice_number: "BB-SophieTaylor-270215-0003", nanny_id: NANNY_ID, nanny_name: "Sophie Taylor", hours: 28, status: "sent", pdf_path: "p", sent_at: "2027-02-15T10:00:01+00:00" };

  it("a placement's week: sent regular weeks only, paged, mapped without the PDF path", async () => {
    f.reads.nanny_invoices = [weekRow, { ...weekRow, id: "x", status: "cancelled" }, { ...weekRow, id: "y", pdf_path: null }];
    const r = await readPlacementWeekRows(admin, PLACEMENT, "2027-02-08");
    expect(r).toEqual({ ok: true, value: [{ invoiceId: INVOICE, seq: 3, number: "BB-SophieTaylor-270215-0003", nannyId: NANNY_ID, nannyName: "Sophie Taylor", hours: 28, sentAt: "2027-02-15T10:00:01.000Z" }] });
    expect(filtersOf("nanny_invoices")).toEqual([
      ["eq", "placement_id", PLACEMENT],
      ["eq", "period_start", "2027-02-08"],
      ["eq", "kind", "regular_week"],
      ["eq", "status", "sent"],
      ["not", "pdf_path", "is"],
      ["order", "invoice_seq", { ascending: true }],
      ["order", "id", { ascending: true }],
      ["range", 0, 499],
    ]);
  });

  it("refuses a week that isn't a Monday, and fails on a bad row or read", async () => {
    expect(await readPlacementWeekRows(admin, PLACEMENT, "2027-02-10")).toEqual({ ok: false, error: "invalid" });
    expect(f.ops).toEqual([]);
    f.reads.nanny_invoices = [{ ...weekRow, hours: "lots" }];
    expect(await readPlacementWeekRows(admin, PLACEMENT, "2027-02-08")).toEqual({ ok: false, error: "error" });
    f.readErrors.nanny_invoices = { message: "x", code: "XX000" };
    expect(await readPlacementWeekRows(admin, PLACEMENT, "2027-02-08")).toEqual({ ok: false, error: "error" });
  });

  it("a family's invoices: sent and cancelled with a PDF, oldest first, no email or bank field", async () => {
    const row = {
      id: INVOICE, invoice_seq: 1, invoice_number: "BB-SophieTaylor-270215-0001", nanny_id: NANNY_ID, nanny_name: "Sophie Taylor", kind: "regular_week", period_start: "2027-02-08",
      hours: 30, rate_pence: 1800, total_pence: 54000, status: "cancelled", pdf_path: "p", sent_at: "2027-02-15T10:00:00+00:00",
      cancelled_at: "2027-02-15T11:00:00+00:00", cancel_reason: "wrong_hours", replaces_invoice_id: null,
    };
    f.reads.nanny_invoices = [row, { ...row, id: "f", status: "failed", sent_at: null, cancelled_at: null, cancel_reason: null }];
    const r = await readFamilyRows(admin, PARENT_USER);
    expect(r).toEqual({
      ok: true,
      value: [{
        invoiceId: INVOICE, seq: 1, number: "BB-SophieTaylor-270215-0001", nannyId: NANNY_ID, nannyName: "Sophie Taylor", kind: "regular_week", periodStart: "2027-02-08",
        hours: 30, ratePence: 1800, totalPence: 54000, status: "cancelled", sentAt: "2027-02-15T10:00:00.000Z",
        cancelledAt: "2027-02-15T11:00:00.000Z", cancelReason: "wrong_hours", replacesInvoiceId: null,
      }],
    });
    expect(filtersOf("nanny_invoices").slice(0, 3)).toEqual([
      ["eq", "parent_user_id", PARENT_USER],
      ["in", "status", ["sent", "cancelled"]],
      ["not", "pdf_path", "is"],
    ]);
    expect(columnsOn("nanny_invoices")).not.toMatch(/email|account|family_name/);
  });
});
