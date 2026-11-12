/**
 * The readers brief 07 (and 08) use — plan 06 step 9, §7 as superseded by §12 R18/R21; brief §0.12, §8, §9.15.
 * Worked example: Hartley, w/c 8 Feb 2027 — …-0001 30 h cancelled, …-0003 28 h replaces it → 28 h from …-0003
 * (numbers BB-<name>-<YYMMDD>-<seq>, BAI 2026-11-04).
 * Admin proof first (the 04a lesson); switch off → null / []; a read failure throws InvoiceReadError; no reader
 * returns an email, a bank field, a PDF path or a link.
 *
 * 06b-2 (plan 14.7): an invoice is a header plus lines; `getPlacementWeekHours` is unchanged (header hours, which
 * the database keeps equal to the shift lines); `FamilyInvoice.ratePence` is null when the rates differ, and it
 * gains `shiftsPence`, `expensesPence` and `vatPence`; `totalPence` includes expenses and VAT.
 *
 * 06b-4 rework (spec j; amendment 21 as revised): an invoice is any set of dated shifts, linked to a placement or a
 * connection. `getPlacementWeekHours` keeps its signature and sums the shift lines of the placement's live invoices
 * dated in that London Monday–Sunday and on or after its start; an invoice with no such line is not listed. A family's
 * invoice carries its period's end.
 *
 * BB-wave1-041126/06a-build, 2026-11-04; BB-wave1-041126/06b2-build, 2026-11-06; BB-wave1-041126/06b4-server, 2026-11-12.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdmin, createAdminClient } = vi.hoisted(() => ({ requireAdmin: vi.fn(), createAdminClient: vi.fn() }));
vi.mock("@/lib/admin/require-admin", () => ({ requireAdmin }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import { proveAdmin, type AdminProof } from "@/lib/calls/admin-proof";
import { fakeAdmin, type FakeAdmin, type Op } from "@/lib/payments/fake-admin.test-util";
import {
  formatFamilySummary,
  getFamilyInvoiceSummary,
  getPlacementWeekHours,
  InvoiceReadError,
  listFamilyInvoices,
  londonWeekStart,
  summarise,
} from "./index";

const u = (n: number) => `b0600000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SOPHIE = u(101);
const LUCJA = u(102);
const HARTLEY = u(11);
const PLACEMENT = u(411);

/** A shift line as the readers embed it (the week reader reads its date and hours; the family reader its rate). */
const line = (shift_date: string, hours: number) => ({ kind: "shift", shift_date, hours, rate_pence: 1800 });
/** Mon–Fri of w/c 8 Feb, `each` hours a day. */
const week = (each: number) => ["2027-02-08", "2027-02-09", "2027-02-10", "2027-02-11", "2027-02-12"].map((d) => line(d, each));
const row = (n: number, extra: Record<string, unknown>) => ({
  id: u(9000 + n), invoice_seq: n, invoice_number: `BB-SophieTaylor-270215-${String(n).padStart(4, "0")}`, nanny_id: SOPHIE, nanny_name: "Sophie Taylor", parent_user_id: HARTLEY,
  placement_id: PLACEMENT, kind: "regular_week", period_start: "2027-02-08", period_end: "2027-02-12", hours: 30, shifts_pence: 54000, expenses_pence: 0,
  vat_pence: 0, total_pence: 54000, nanny_invoice_lines: week(6), status: "sent", pdf_path: `${SOPHIE}/${u(9000 + n)}.pdf`, sent_at: `2027-02-1${n}T09:00:00+00:00`, cancelled_at: null,
  cancel_reason: null, replaces_invoice_id: null, family_email: "admin+b06-11@babybloomnannies.co.uk", account_last4: "4321",
  ...extra,
});
const INV1 = row(1, { status: "cancelled", cancelled_at: "2027-02-15T12:00:00+00:00", cancel_reason: "wrong_hours" });
const INV2 = row(2, {
  parent_user_id: u(12), placement_id: null, kind: "trial_shift", period_start: "2027-02-03", period_end: "2027-02-03", hours: 4, shifts_pence: 7200,
  total_pence: 7200, nanny_invoice_lines: [line("2027-02-03", 4)],
});
const INV3 = row(3, {
  hours: 28, shifts_pence: 50400, total_pence: 50400, replaces_invoice_id: u(9001), sent_at: "2027-02-15T13:00:00+00:00",
  nanny_invoice_lines: [...week(5), line("2027-02-13", 3)], period_end: "2027-02-13",
});
const FAILED = row(4, { status: "failed", sent_at: null });
const SENDING = row(5, { status: "sending", sent_at: null });

type Filter = [string, string, unknown];
const passes = (r: Record<string, unknown>, [f, col, val]: Filter): boolean => {
  const v = r[col];
  if (f === "eq") return v === val;
  if (f === "in") return (val as unknown[]).includes(v);
  if (f === "not") return v !== null;
  if (f === "gte") return typeof v === "string" && v >= String(val);
  if (f === "lte") return typeof v === "string" && v <= String(val);
  return true;
};

/** Answer like PostgREST would: top-level filters pick the rows; `nanny_invoice_lines.<col>` filters pick their lines. */
function table(rows: readonly Record<string, unknown>[]) {
  return (op: Op) => {
    const own = op.filters.filter(([, col]) => !String(col).includes("."));
    const embedded = op.filters.flatMap(([f, col, val]): Filter[] => (String(col).startsWith("nanny_invoice_lines.") ? [[f, String(col).slice(20), val]] : []));
    return rows.filter((r) => own.every((filter) => passes(r, filter))).map((r) => ({
      ...r,
      nanny_invoice_lines: (r.nanny_invoice_lines as Record<string, unknown>[]).filter((l) => embedded.every((filter) => passes(l, filter))),
    }));
  };
}

let f: FakeAdmin;
let admin: AdminProof;

beforeEach(async () => {
  vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
  f = fakeAdmin();
  f.reads.nanny_invoices = table([INV1, INV2, INV3, FAILED, SENDING]);
  f.reads.nanny_placements = { id: PLACEMENT, start_date: "2027-01-11" };
  createAdminClient.mockReset().mockReturnValue(f.client);
  requireAdmin.mockResolvedValue({ userId: u(31), error: null });
  const a = await proveAdmin();
  if (!a) throw new Error("fixture proof");
  admin = a;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("getPlacementWeekHours — sets 07's week hours (spec j)", () => {
  it("the worked example: 28 h from …-0003; the cancelled …-0001 (30 h) never counts", async () => {
    expect(await getPlacementWeekHours(admin, PLACEMENT, "2027-02-08")).toEqual({
      hours: 28,
      invoiceId: u(9003),
      number: "BB-SophieTaylor-270215-0003",
      invoices: [{ invoiceId: u(9003), number: "BB-SophieTaylor-270215-0003", nannyName: "Sophie Taylor", hours: 28 }],
    });
  });

  it("adds two live invoices with shifts in the same week (brief §11 Q9) and names the latest", async () => {
    f.reads.nanny_invoices = table([INV3, row(6, { period_start: "2027-02-14", period_end: "2027-02-14", hours: 4.5, nanny_invoice_lines: [line("2027-02-14", 4.5)] })]);
    const result = await getPlacementWeekHours(admin, PLACEMENT, "2027-02-08");
    expect(result).toMatchObject({ hours: 32.5, number: "BB-SophieTaylor-270215-0006" });
    expect(result?.invoices.map((i) => [i.number, i.hours])).toEqual([["BB-SophieTaylor-270215-0003", 28], ["BB-SophieTaylor-270215-0006", 4.5]]);
  });

  it("splits a longer invoice by week: only its shifts dated Monday to Sunday of that week count", async () => {
    const month = row(7, {
      period_start: "2027-02-01", period_end: "2027-02-28", hours: 26,
      nanny_invoice_lines: [line("2027-02-01", 8), line("2027-02-07", 2), line("2027-02-08", 6), line("2027-02-14", 4), line("2027-02-15", 6)],
    });
    f.reads.nanny_invoices = table([month]);
    expect(await getPlacementWeekHours(admin, PLACEMENT, "2027-02-01")).toMatchObject({ hours: 10 });
    expect(await getPlacementWeekHours(admin, PLACEMENT, "2027-02-08")).toMatchObject({ hours: 10, invoices: [{ hours: 10 }] });
    expect(await getPlacementWeekHours(admin, PLACEMENT, "2027-02-15")).toMatchObject({ hours: 6 });
    expect(await getPlacementWeekHours(admin, PLACEMENT, "2027-02-22")).toBeNull();
  });

  it("counts from the placement's start: a trial day before it, on the same invoice, adds no hours", async () => {
    f.reads.nanny_placements = { id: PLACEMENT, start_date: "2027-02-10" };
    f.reads.nanny_invoices = table([row(8, { nanny_invoice_lines: [line("2027-02-08", 4), line("2027-02-10", 6), line("2027-02-11", 6)] })]);
    expect(await getPlacementWeekHours(admin, PLACEMENT, "2027-02-08")).toMatchObject({ hours: 12 });
  });

  it("adds the week's shift hours only: an invoice's expenses add no hours, and one of expenses only isn't listed (14.7)", async () => {
    const expensesOnly = row(9, { hours: 0, shifts_pence: 0, expenses_pence: 1250, total_pence: 1250, period_start: "2027-02-10", period_end: "2027-02-10", nanny_invoice_lines: [{ kind: "expense", shift_date: null, hours: null, rate_pence: null }] });
    f.reads.nanny_invoices = table([INV3, expensesOnly]);
    expect(await getPlacementWeekHours(admin, PLACEMENT, "2027-02-08")).toMatchObject({ hours: 28, invoices: [{ number: "BB-SophieTaylor-270215-0003" }] });
  });

  it("is null when the week has no live invoice linked to the placement (failed, sending, a trial's and cancelled are ignored)", async () => {
    f.reads.nanny_invoices = table([INV1, FAILED, SENDING, row(7, { kind: "trial_shift", placement_id: null })]);
    expect(await getPlacementWeekHours(admin, PLACEMENT, "2027-02-08")).toBeNull();
    f.reads.nanny_invoices = table([INV1, INV2, INV3]);
    expect(await getPlacementWeekHours(admin, PLACEMENT, "2027-02-15")).toBeNull();
  });

  it("returns exactly these keys — no bank, email, PDF or link field (R21)", async () => {
    const result = await getPlacementWeekHours(admin, PLACEMENT, "2027-02-08");
    expect(Object.keys(result ?? {}).sort()).toEqual(["hours", "invoiceId", "invoices", "number"]);
    expect(Object.keys(result?.invoices[0] ?? {}).sort()).toEqual(["hours", "invoiceId", "nannyName", "number"]);
  });

  it("throws a TypeError for a week that isn't a Monday, or with no admin proof", async () => {
    await expect(getPlacementWeekHours(admin, PLACEMENT, "2027-02-10")).rejects.toThrow(TypeError);
    await expect(getPlacementWeekHours({ kind: "admin_proof", userId: u(31) } as unknown as AdminProof, PLACEMENT, "2027-02-08")).rejects.toThrow(TypeError);
    await expect(getPlacementWeekHours(admin, "not-an-id", "2027-02-08")).rejects.toThrow(TypeError);
    expect(f.ops).toEqual([]);
  });

  it("throws InvoiceReadError when a read fails — never a silent null 07 could mistake for 'no invoice'", async () => {
    f.readErrors.nanny_invoices = { message: "x", code: "57014" };
    await expect(getPlacementWeekHours(admin, PLACEMENT, "2027-02-08")).rejects.toThrow(InvoiceReadError);
    f.readErrors.nanny_placements = { message: "x", code: "57014" };
    await expect(getPlacementWeekHours(admin, PLACEMENT, "2027-02-08")).rejects.toThrow(InvoiceReadError);
  });

  it("switch off → null before any check or read", async () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "");
    expect(await getPlacementWeekHours(admin, PLACEMENT, "2027-02-10")).toBeNull();
    expect(createAdminClient).not.toHaveBeenCalled();
  });

  it("07 finds a placement's first week with the one clock's Monday (R21)", () => {
    expect(londonWeekStart("2027-02-11")).toBe("2027-02-08");
  });
});

describe("listFamilyInvoices", () => {
  it("lists what went out to the family, newest first, with the correction links", async () => {
    const list = await listFamilyInvoices(admin, HARTLEY);
    expect(list.map((i) => [i.number, i.status, i.replacesNumber, i.replacedByNumber])).toEqual([
      ["BB-SophieTaylor-270215-0003", "sent", "BB-SophieTaylor-270215-0001", null],
      ["BB-SophieTaylor-270215-0001", "cancelled", null, "BB-SophieTaylor-270215-0003"],
    ]);
    expect(list[1]).toEqual({
      invoiceId: u(9001), number: "BB-SophieTaylor-270215-0001", nannyId: SOPHIE, nannyName: "Sophie Taylor", kind: "regular_week",
      periodStart: "2027-02-08", periodEnd: "2027-02-12", hours: 30, ratePence: 1800, shiftsPence: 54000, expensesPence: 0, vatPence: 0, totalPence: 54000, status: "cancelled",
      sentAt: "2027-02-11T09:00:00.000Z", cancelledAt: "2027-02-15T12:00:00.000Z", cancelReason: "wrong_hours",
      replacesNumber: null, replacedByNumber: "BB-SophieTaylor-270215-0003",
    });
    expect(JSON.stringify(list)).not.toMatch(/@|4321|\.pdf|pdf_path|account/);
  });

  it("an invoice with two rates, an expense and VAT added: ratePence null; the total includes expenses and VAT (14.7)", async () => {
    const mixed = row(9, {
      hours: 32, shifts_pence: 58_400, expenses_pence: 1250, vat_pence: 11_680, total_pence: 71_330,
      nanny_invoice_lines: [{ kind: "shift", rate_pence: 1800 }, { kind: "shift", rate_pence: 2200 }, { kind: "expense", rate_pence: null }],
    });
    f.reads.nanny_invoices = table([mixed]);
    const [invoice] = await listFamilyInvoices(admin, HARTLEY);
    expect(invoice).toMatchObject({ ratePence: null, shiftsPence: 58_400, expensesPence: 1250, vatPence: 11_680, totalPence: 71_330, hours: 32 });
    expect(await getFamilyInvoiceSummary(admin, HARTLEY)).toMatchObject({ hours: 32, totalPence: 71_330 });
  });

  it("returns exactly these keys — no bank, email, PDF, link or issuer field (R21, 14.7)", async () => {
    const [invoice] = await listFamilyInvoices(admin, HARTLEY);
    expect(Object.keys(invoice ?? {}).sort()).toEqual([
      "cancelReason", "cancelledAt", "expensesPence", "hours", "invoiceId", "kind", "nannyId", "nannyName", "number", "periodEnd", "periodStart",
      "ratePence", "replacedByNumber", "replacesNumber", "sentAt", "shiftsPence", "status", "totalPence", "vatPence",
    ]);
  });

  it("each nanny's numbering is her own (her name is in the number)", async () => {
    f.reads.nanny_invoices = table([INV3, row(1, { id: u(9101), nanny_id: LUCJA, nanny_name: "Łucja Wiśniewska", invoice_number: "BB-LucjaWisniewska-270215-0001" })]);
    const list = await listFamilyInvoices(admin, HARTLEY);
    expect(list.map((i) => `${i.nannyName} ${i.number}`)).toEqual(["Sophie Taylor BB-SophieTaylor-270215-0003", "Łucja Wiśniewska BB-LucjaWisniewska-270215-0001"]);
  });

  it("switch off → [] (R18); a failed read throws; no proof throws", async () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "");
    expect(await listFamilyInvoices(admin, HARTLEY)).toEqual([]);
    vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
    f.readErrors.nanny_invoices = { message: "x", code: "XX000" };
    await expect(listFamilyInvoices(admin, HARTLEY)).rejects.toThrow(InvoiceReadError);
    await expect(listFamilyInvoices({} as AdminProof, HARTLEY)).rejects.toThrow(TypeError);
  });
});

describe("getFamilyInvoiceSummary and summarise (the admin summary uses the same function)", () => {
  it("the worked example: 2 invoices · 1 cancelled · 28 h · £504.00 (brief §0.11, §9.14)", async () => {
    const summary = await getFamilyInvoiceSummary(admin, HARTLEY);
    expect(summary).toEqual({ invoiceCount: 2, activeCount: 1, cancelledCount: 1, hours: 28, totalPence: 50400 });
    expect(summary && formatFamilySummary(summary)).toBe("2 invoices · 1 cancelled · 28 h · £504.00");
  });

  it("counts Trial Shifts as invoices to the family (they make no bill line in 07)", async () => {
    expect(await getFamilyInvoiceSummary(admin, u(12))).toEqual({ invoiceCount: 1, activeCount: 1, cancelledCount: 0, hours: 4, totalPence: 7200 });
  });

  it("an empty family is all zeros; one invoice reads in the singular", () => {
    expect(summarise([])).toEqual({ invoiceCount: 0, activeCount: 0, cancelledCount: 0, hours: 0, totalPence: 0 });
    expect(formatFamilySummary({ invoiceCount: 1, activeCount: 1, cancelledCount: 0, hours: 4, totalPence: 7200 })).toBe("1 invoice · 0 cancelled · 4 h · £72.00");
  });

  it("switch off → an all-zero summary, never null (R21 types it non-null), with nothing read; a failed read throws", async () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "");
    expect(await getFamilyInvoiceSummary(admin, HARTLEY)).toEqual({ invoiceCount: 0, activeCount: 0, cancelledCount: 0, hours: 0, totalPence: 0 });
    expect(createAdminClient).not.toHaveBeenCalled();
    vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
    f.readErrors.nanny_invoices = { message: "x", code: "XX000" };
    await expect(getFamilyInvoiceSummary(admin, HARTLEY)).rejects.toThrow(InvoiceReadError);
  });
});
