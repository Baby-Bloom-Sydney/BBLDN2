/**
 * The store (plan 06 step 6; R1): the only module that touches `nanny_payment_details` and `nanny_invoices`.
 * - Switch off → `invoices_disabled` before any client is made; not a proof → `invalid` before any read.
 * - Screens get masks only; the full numbers come back from one named read, for the PDF.
 * - Every write goes through amendment 21's functions with the nanny id from the proof, never from the input.
 * - Readers' rows: sent (or sent + cancelled) with a PDF only; an admin proof first.
 * - Nothing logged ever carries a bank digit or an email (a spy on console.* checks every test).
 * Fixture numbers only (11-22-33 / 87654321).
 *
 * BB-wave1-041126/06a-build, 2026-11-04.
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

const DETAILS_IN = { accountName: "Sophie Taylor", sortCode: "11-22-33", accountNumber: "87654321", tradingName: "", invoiceAddress: "" };
const DRAFT = {
  invoiceId: INVOICE,
  kind: "regular_week",
  targetId: PLACEMENT,
  periodStart: "2027-02-08",
  hours: 30,
  ratePence: 1800,
  replacesInvoiceId: null,
};
const CREATED = {
  status: "created", invoice_id: INVOICE, invoice_seq: 1, invoice_status: "sending", kind: "regular_week",
  placement_id: PLACEMENT, connection_request_id: null, period_start: "2027-02-08", hours: 30, rate_pence: 1800,
  total_pence: 54000, parent_user_id: PARENT_USER, family_name: "Olivia Hartley", family_email: "admin+b06-11@babybloomnannies.co.uk",
  nanny_name: "Sophie Taylor", nanny_email: "admin+b06-1@babybloomnannies.co.uk", account_last4: "4321",
  pdf_path: `${NANNY_ID}/${INVOICE}.pdf`, replaces_invoice_id: null, replaces_seq: null, created_at: "2027-02-15T10:00:00.123456+00:00",
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
  expect(logged).not.toMatch(/87654321|112233|11-22-33|@babybloomnannies|Hartley|Taylor/);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const opsOn = (table: string) => f.ops.filter((o) => o.table === table);
const filtersOf = (table: string) => opsOn(table).flatMap((o) => o.filters);

describe("with the switch off", () => {
  it("every operation refuses before a client is made", async () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "");
    const results = await Promise.all([
      readMaskedDetails(nanny),
      readFullDetailsForInvoicePdf(nanny),
      saveDetails(nanny, DETAILS_IN),
      createInvoice(nanny, DRAFT, "4321", NOW),
      finishInvoice(nanny, INVOICE, { kind: "failed" }),
      countTowardsDailyCap(nanny, NOW),
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
      createInvoice(lookAlike, DRAFT, "4321", NOW),
      finishInvoice(lookAlike, INVOICE, { kind: "failed" }),
      countTowardsDailyCap(lookAlike, NOW),
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
    for (const r of await Promise.all([readMaskedDetails(nanny), saveDetails(nanny, DETAILS_IN), createInvoice(nanny, DRAFT, "4321", NOW),
      finishInvoice(nanny, INVOICE, { kind: "failed" }), countTowardsDailyCap(nanny, NOW), readFamilyRows(admin, PARENT_USER)])) {
      expect(r).toEqual({ ok: false, error: "error" });
    }
    expect(console.error).toHaveBeenCalledWith("[invoices] createAdminClient failed", { code: "Error" });
    createAdminClient.mockReturnValue(f.client);
    f.reads.nanny_payment_details = () => { throw new TypeError("network"); };
    f.reads.nanny_invoices = () => { throw new TypeError("network"); };
    expect(await readMaskedDetails(nanny)).toEqual({ ok: false, error: "error" });
    expect(await countTowardsDailyCap(nanny, NOW)).toEqual({ ok: false, error: "error" });
  });
});

describe("readMaskedDetails", () => {
  it("reads her row by the proof's nanny id, selecting the masks only", async () => {
    f.reads.nanny_payment_details = {
      account_name: "Sophie Taylor", sort_code_last2: "33", account_last4: "4321", trading_name: null,
      invoice_address: "1 Upper Street\nLondon N1", updated_at: "2027-02-01T09:00:00+00:00",
    };
    const r = await readMaskedDetails(nanny);
    expect(r).toEqual({
      ok: true,
      value: {
        accountName: "Sophie Taylor", sortCodeLast2: "33", accountLast4: "4321", tradingName: null,
        invoiceAddress: "1 Upper Street\nLondon N1", updatedAt: "2027-02-01T09:00:00.000Z",
      },
    });
    expect(filtersOf("nanny_payment_details")).toEqual([["eq", "nanny_id", NANNY_ID]]);
    const columns = selects.filter(([t]) => t === "nanny_payment_details").map(([, c]) => c).join(",");
    expect(columns).not.toMatch(/\bsort_code\b|\baccount_number\b/);
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
    f.reads.nanny_payment_details = {
      account_name: "Sophie Taylor", sort_code: "112233", account_number: "87654321", account_last4: "4321",
      trading_name: "Taylor Childcare", invoice_address: null,
    };
    expect(await readFullDetailsForInvoicePdf(nanny)).toEqual({
      ok: true,
      value: { accountName: "Sophie Taylor", sortCode: "112233", accountNumber: "87654321", accountLast4: "4321", tradingName: "Taylor Childcare", invoiceAddress: null },
    });
    expect(filtersOf("nanny_payment_details")).toEqual([["eq", "nanny_id", NANNY_ID]]);
    f.reads.nanny_payment_details = null;
    expect(await readFullDetailsForInvoicePdf(nanny)).toEqual({ ok: true, value: null });
    f.reads.nanny_payment_details = { account_name: "x", sort_code: "1122", account_number: "8765", account_last4: "4321" };
    expect(await readFullDetailsForInvoicePdf(nanny)).toEqual({ ok: false, error: "error" });
  });
});

describe("saveDetails", () => {
  it("saves the parsed details for the proof's nanny and replies with masks only", async () => {
    f.rpcResults.nanny_payment_details_save = {
      data: { status: "saved", first_save: true, changed: true, sort_code_last2: "33", account_last4: "4321" },
      error: null,
    };
    const r = await saveDetails(nanny, { ...DETAILS_IN, nannyId: OTHER_NANNY });
    expect(r).toEqual({ ok: true, value: { firstSave: true, changed: true, masks: { sortCodeLast2: "33", accountLast4: "4321" } } });
    expect(f.rpcCalls).toEqual([{
      fn: "nanny_payment_details_save",
      args: { p_nanny: NANNY_ID, p_account_name: "Sophie Taylor", p_sort_code: "112233", p_account_number: "87654321", p_trading_name: null, p_invoice_address: null },
    }]);
    expect(JSON.stringify(r)).not.toMatch(/87654321|112233/);
  });

  it("refuses bad input without calling the database", async () => {
    expect(await saveDetails(nanny, { ...DETAILS_IN, sortCode: "11223" })).toEqual({ ok: false, error: "invalid" });
    expect(await saveDetails(nanny, "not an object")).toEqual({ ok: false, error: "invalid" });
    expect(f.rpcCalls).toEqual([]);
  });

  it("maps the database's refusal, a failure and a reply it doesn't recognise", async () => {
    f.rpcResults.nanny_payment_details_save = { data: { status: "invalid" }, error: null };
    expect(await saveDetails(nanny, DETAILS_IN)).toEqual({ ok: false, error: "invalid" });
    f.rpcResults.nanny_payment_details_save = { data: null, error: { message: "Failing row contains (112233, 87654321)", code: "23514" } };
    expect(await saveDetails(nanny, DETAILS_IN)).toEqual({ ok: false, error: "error" });
    expect(console.error).toHaveBeenLastCalledWith("[invoices] nanny_payment_details_save failed", { code: "23514" });
    f.rpcResults.nanny_payment_details_save = { data: { status: "saved", first_save: "yes" }, error: null };
    expect(await saveDetails(nanny, DETAILS_IN)).toEqual({ ok: false, error: "error" });
  });
});

describe("createInvoice", () => {
  it("creates through the database with the proof's nanny id and maps the reply", async () => {
    f.rpcResults.nanny_invoice_create = { data: CREATED, error: null };
    const r = await createInvoice(nanny, { ...DRAFT, nannyId: OTHER_NANNY, parentUserId: OTHER_NANNY }, "4321", NOW);
    expect(f.rpcCalls).toEqual([{
      fn: "nanny_invoice_create",
      args: {
        p_id: INVOICE, p_nanny: NANNY_ID, p_kind: "regular_week", p_target: PLACEMENT, p_period_start: "2027-02-08",
        p_hours: 30, p_rate_pence: 1800, p_replaces: null, p_account_last4: "4321", p_daily_cap: 10, p_stale_minutes: 10,
      },
    }]);
    expect(r).toEqual({
      ok: true,
      value: {
        invoiceId: INVOICE, seq: 1, number: "INV-0001", status: "sending", kind: "regular_week",
        placementId: PLACEMENT, connectionRequestId: null, periodStart: "2027-02-08", hours: 30, ratePence: 1800,
        totalPence: 54000, parentUserId: PARENT_USER, familyName: "Olivia Hartley", familyEmail: "admin+b06-11@babybloomnannies.co.uk",
        nannyName: "Sophie Taylor", nannyEmail: "admin+b06-1@babybloomnannies.co.uk", accountLast4: "4321",
        pdfPath: `${NANNY_ID}/${INVOICE}.pdf`, replacesInvoiceId: null, replacesNumber: null, createdAt: "2027-02-15T10:00:00.123Z",
      },
    });
  });

  it("prints the replaced invoice's number for a correction", async () => {
    f.rpcResults.nanny_invoice_create = {
      data: { ...CREATED, invoice_seq: 3, replaces_invoice_id: "b0600000-0000-4000-8000-000000009000", replaces_seq: 1, hours: "28.0", total_pence: 50400 },
      error: null,
    };
    const r = await createInvoice(nanny, { ...DRAFT, hours: 28, replacesInvoiceId: "b0600000-0000-4000-8000-000000009000" }, "4321", NOW);
    expect(r.ok && [r.value.number, r.value.replacesNumber, r.value.hours]).toEqual(["INV-0003", "INV-0001", 28]);
  });

  it.each(["future", "not_hers", "no_trial", "wrong_date", "no_details", "bad_replaces", "already_replaced", "no_contact",
    "nanny_inactive", "cap", "busy", "invalid", "in_progress", "already_done", "already_failed"] as const)(
    "passes the database's %s refusal through",
    async (status) => {
      f.rpcResults.nanny_invoice_create = { data: { status }, error: null };
      expect(await createInvoice(nanny, DRAFT, "4321", NOW)).toEqual({ ok: false, error: status });
    },
  );

  it("refuses a future period, a bad draft or a bad last-4 before the database", async () => {
    expect(await createInvoice(nanny, { ...DRAFT, periodStart: "2027-02-22" }, "4321", NOW)).toEqual({ ok: false, error: "future" });
    expect(await createInvoice(nanny, { ...DRAFT, hours: 0.25 }, "4321", NOW)).toEqual({ ok: false, error: "invalid" });
    expect(await createInvoice(nanny, { ...DRAFT, ratePence: 999 }, "4321", NOW)).toEqual({ ok: false, error: "invalid" });
    expect(await createInvoice(nanny, DRAFT, "87654321", NOW)).toEqual({ ok: false, error: "invalid" });
    expect(f.rpcCalls).toEqual([]);
  });

  it("a retry of the same id is never a second send: in_progress while it's sending, already_done after (security M5)", async () => {
    f.rpcResults.nanny_invoice_create = { data: { status: "in_progress", invoice_id: INVOICE, invoice_status: "sending" }, error: null };
    expect(await createInvoice(nanny, DRAFT, "4321", NOW)).toEqual({ ok: false, error: "in_progress" });
    f.rpcResults.nanny_invoice_create = { data: { status: "already_done", invoice_id: INVOICE, invoice_status: "sent" }, error: null };
    expect(await createInvoice(nanny, DRAFT, "4321", NOW)).toEqual({ ok: false, error: "already_done" });
  });

  it("a lock that times out (55P03) is busy, so the nanny can simply try again", async () => {
    f.rpcResults.nanny_invoice_create = { data: null, error: { message: "canceling statement due to lock timeout", code: "55P03" } };
    expect(await createInvoice(nanny, DRAFT, "4321", NOW)).toEqual({ ok: false, error: "busy" });
    f.rpcResults.nanny_payment_details_save = { data: null, error: { message: "canceling statement due to lock timeout", code: "55P03" } };
    expect(await saveDetails(nanny, DETAILS_IN)).toEqual({ ok: false, error: "busy" });
  });

  it("an unknown or malformed reply, or a failure, is an error", async () => {
    f.rpcResults.nanny_invoice_create = { data: { status: "made" }, error: null };
    expect(await createInvoice(nanny, DRAFT, "4321", NOW)).toEqual({ ok: false, error: "error" });
    f.rpcResults.nanny_invoice_create = { data: { ...CREATED, invoice_seq: 0 }, error: null };
    expect(await createInvoice(nanny, DRAFT, "4321", NOW)).toEqual({ ok: false, error: "error" });
    f.rpcResults.nanny_invoice_create = { data: { ...CREATED, invoice_status: "sent" }, error: null };
    expect(await createInvoice(nanny, DRAFT, "4321", NOW)).toEqual({ ok: false, error: "error" });
    f.rpcResults.nanny_invoice_create = { data: null, error: { message: "Failing row contains (admin+b06-11@babybloomnannies.co.uk)", code: "XX000" } };
    expect(await createInvoice(nanny, DRAFT, "4321", NOW)).toEqual({ ok: false, error: "error" });
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
    expect(await finishInvoice(nanny, "INV-0001", { kind: "failed" })).toEqual({ ok: false, error: "invalid" });
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
    // stale sends are dropped in the query, before the limit (code review: the limit must count only live rows)
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

describe("the readers' rows (an admin proof first; R1: what went out, with its PDF)", () => {
  const weekRow = { id: INVOICE, invoice_seq: 3, nanny_id: NANNY_ID, nanny_name: "Sophie Taylor", hours: 28, status: "sent", pdf_path: "p", sent_at: "2027-02-15T10:00:01+00:00" };

  it("a placement's week: sent regular weeks only, paged, mapped without the PDF path", async () => {
    f.reads.nanny_invoices = [weekRow, { ...weekRow, id: "x", status: "cancelled" }, { ...weekRow, id: "y", pdf_path: null }];
    const r = await readPlacementWeekRows(admin, PLACEMENT, "2027-02-08");
    expect(r).toEqual({ ok: true, value: [{ invoiceId: INVOICE, seq: 3, nannyId: NANNY_ID, nannyName: "Sophie Taylor", hours: 28, sentAt: "2027-02-15T10:00:01.000Z" }] });
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
      id: INVOICE, invoice_seq: 1, nanny_id: NANNY_ID, nanny_name: "Sophie Taylor", kind: "regular_week", period_start: "2027-02-08",
      hours: 30, rate_pence: 1800, total_pence: 54000, status: "cancelled", pdf_path: "p", sent_at: "2027-02-15T10:00:00+00:00",
      cancelled_at: "2027-02-15T11:00:00+00:00", cancel_reason: "wrong_hours", replaces_invoice_id: null,
    };
    f.reads.nanny_invoices = [row, { ...row, id: "f", status: "failed", sent_at: null, cancelled_at: null, cancel_reason: null }];
    const r = await readFamilyRows(admin, PARENT_USER);
    expect(r).toEqual({
      ok: true,
      value: [{
        invoiceId: INVOICE, seq: 1, nannyId: NANNY_ID, nannyName: "Sophie Taylor", kind: "regular_week", periodStart: "2027-02-08",
        hours: 30, ratePence: 1800, totalPence: 54000, status: "cancelled", sentAt: "2027-02-15T10:00:00.000Z",
        cancelledAt: "2027-02-15T11:00:00.000Z", cancelReason: "wrong_hours", replacesInvoiceId: null,
      }],
    });
    expect(filtersOf("nanny_invoices").slice(0, 3)).toEqual([
      ["eq", "parent_user_id", PARENT_USER],
      ["in", "status", ["sent", "cancelled"]],
      ["not", "pdf_path", "is"],
    ]);
    const columns = selects.filter(([t]) => t === "nanny_invoices").map(([, c]) => c).join(",");
    expect(columns).not.toMatch(/email|account|family_name/);
  });
});
