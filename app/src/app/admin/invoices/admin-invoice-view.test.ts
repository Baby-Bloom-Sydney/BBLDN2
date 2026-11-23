/**
 * `/admin/invoices`, the rows as the page shows them (plan 06 step 17, §14.6 c.1; brief §0.11, §3 admin 2; A14):
 * - Each row: number, family, nanny, the kind's label ("Hired" for a placement, "Trial" for a trial connection —
 *   derived from the link, never chosen), the period exactly as the nanny's list prints it, hours, "incl. £x expenses"
 *   when there are any, the VAT mode, the total (expenses and VAT included), the status ("Cancelled · <reason>"),
 *   "Replaces …" / "Replaced by …", and both recipients' deliveries.
 * - Per family: the same `summarise()` as 07's reader, printed by `formatFamilySummary`, "(excluding cancelled)".
 * - Families and nannies are keyed by opaque keys, never a user id; the view holds no email, bank field or path.
 *
 * BB-wave1-041126/06c, 2026-11-23.
 */
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

import { INVOICE_RULES } from "@/config/invoices";
import type { AdminInvoice } from "@/lib/invoices";
import { periodLabel } from "@/lib/invoices/week";
import { toAdminInvoicesView } from "./admin-invoice-view";
import { INVOICE_KIND_LABELS } from "./types";

const u = (n: number) => `b0600000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const SOPHIE = u(101);
const LUCJA = u(102);
const HARTLEY = u(11);
const AHMED = u(12);

const invoice = (n: number, over: Partial<AdminInvoice> = {}): AdminInvoice => ({
  invoiceId: u(9000 + n), number: `BB-SophieTaylor-270215-${String(n).padStart(4, "0")}`, nannyId: SOPHIE, nannyName: "Sophie Taylor",
  kind: "regular_week", periodStart: "2027-02-08", periodEnd: "2027-02-12", hours: 30, ratePence: 1800, shiftsPence: 54000,
  expensesPence: 0, vatPence: 0, totalPence: 54000, status: "sent", sentAt: `2027-02-1${n}T09:00:00.000Z`, cancelledAt: null,
  cancelReason: null, replacesNumber: null, replacedByNumber: null, parentUserId: HARTLEY, familyName: "Olivia Hartley",
  vatMode: "none", delivery: { family: "sent", nanny: "sent", cancelFamily: null, cancelNanny: null },
  ...over,
});

/** The worked example, newest first: …-0003 (28 h) replaces the cancelled …-0001 (30 h); the Ahmeds' Trial day …-0002. */
const INV3 = invoice(3, { hours: 28, shiftsPence: 50400, totalPence: 50400, replacesNumber: "BB-SophieTaylor-270215-0001", periodEnd: "2027-02-13" });
const INV2 = invoice(2, {
  kind: "trial_shift", parentUserId: AHMED, familyName: "Amira Ahmed", periodStart: "2027-02-03", periodEnd: "2027-02-03", hours: 4,
  shiftsPence: 7200, totalPence: 7200,
});
const INV1 = invoice(1, {
  status: "cancelled", cancelledAt: "2027-02-15T12:00:00.000Z", cancelReason: "wrong_hours", replacedByNumber: "BB-SophieTaylor-270215-0003",
  delivery: { family: "sent", nanny: "sent", cancelFamily: "sent", cancelNanny: "failed" },
});
const WORKED = [INV3, INV2, INV1];

describe("toAdminInvoicesView — rows", () => {
  it("a sent hire invoice: number, names, kind, the nanny list's period, hours, total, VAT, deliveries", () => {
    const [row] = toAdminInvoicesView(WORKED).rows;
    expect(row).toEqual({
      invoiceId: u(9003), number: "BB-SophieTaylor-270215-0003", familyKey: "family-2", familyName: "Olivia Hartley",
      nannyKey: "nanny-1", nannyName: "Sophie Taylor", kind: "regular_week", kindLabel: "Hired", period: "8–13 Feb 2027",
      hours: "28 h", expenses: null, vat: "No VAT", total: "£504.00", status: "sent", statusLabel: "Sent",
      replacesNumber: "BB-SophieTaylor-270215-0001", replacedByNumber: null,
      deliveries: [{ text: "Emailed to the family", delivered: true }, { text: "Copy emailed to the nanny", delivered: true }],
    });
    expect(row?.period).toBe(periodLabel("2027-02-08", "2027-02-13"));
  });

  it("the kind is the link's label — Hired for a placement, Trial for a trial connection — from one constant", () => {
    const rows = toAdminInvoicesView(WORKED).rows;
    expect(rows.map((r) => [r.kind, r.kindLabel, r.period])).toEqual([
      ["regular_week", "Hired", "8–13 Feb 2027"], ["trial_shift", "Trial", "3 Feb 2027"], ["regular_week", "Hired", "8–12 Feb 2027"],
    ]);
    expect(INVOICE_KIND_LABELS).toEqual({ regular_week: "Hired", trial_shift: "Trial" });
  });

  it("a cancelled invoice: its reason, the invoice that replaced it, and the cancellation's deliveries", () => {
    const row = toAdminInvoicesView(WORKED).rows[2];
    expect(row).toMatchObject({ status: "cancelled", statusLabel: "Cancelled · Wrong hours", replacedByNumber: "BB-SophieTaylor-270215-0003" });
    expect(row?.deliveries).toEqual([
      { text: "Emailed to the family", delivered: true }, { text: "Copy emailed to the nanny", delivered: true },
      { text: "Cancellation emailed to the family", delivered: true }, { text: "Cancellation not delivered to the nanny", delivered: false },
    ]);
  });

  it("an email that failed reads as not delivered; one with no record is left out", () => {
    const row = toAdminInvoicesView([invoice(1, { delivery: { family: "failed", nanny: null, cancelFamily: null, cancelNanny: null } })]).rows[0];
    expect(row?.deliveries).toEqual([{ text: "Not delivered to the family", delivered: false }]);
    const cancelled = toAdminInvoicesView([invoice(1, { status: "cancelled", cancelReason: null })]).rows[0];
    expect(cancelled?.statusLabel).toBe("Cancelled");
  });

  it("expenses show as 'incl. £x expenses' only when there are any; the VAT mode; the total includes both", () => {
    const rows = toAdminInvoicesView([
      invoice(1, { expensesPence: 1250, vatMode: "added", vatPence: 11680, shiftsPence: 58400, totalPence: 71330, hours: 32 }),
      invoice(2, { vatMode: "included", vatPence: 9000 }),
      invoice(3, { hours: 0, shiftsPence: 0, expensesPence: 2500, totalPence: 2500 }),
    ]).rows;
    expect(rows.map((r) => [r.hours, r.expenses, r.vat, r.total])).toEqual([
      ["32 h", "incl. £12.50 expenses", "VAT added", "£713.30"],
      ["30 h", null, "VAT included", "£540.00"],
      ["0 h", "incl. £25.00 expenses", "No VAT", "£25.00"],
    ]);
  });
});

describe("toAdminInvoicesView — families, nannies, the limit", () => {
  it("each family once, by name, with summarise()'s line '(excluding cancelled)' — the worked example", () => {
    expect(toAdminInvoicesView(WORKED).families).toEqual([
      { key: "family-1", name: "Amira Ahmed", summary: "1 invoice · 0 cancelled · 4 h · £72.00 (excluding cancelled)" },
      { key: "family-2", name: "Olivia Hartley", summary: "2 invoices · 1 cancelled · 28 h · £504.00 (excluding cancelled)" },
    ]);
  });

  it("each nanny once, by name; two people with one name stay two (keys, never user ids)", () => {
    const view = toAdminInvoicesView([
      ...WORKED,
      invoice(4, { nannyId: LUCJA, nannyName: "Łucja Wiśniewska", number: "BB-LucjaWisniewska-270215-0001" }),
      invoice(5, { parentUserId: u(13), familyName: "Olivia Hartley" }),
    ]);
    expect(view.nannies).toEqual([{ key: "nanny-1", name: "Łucja Wiśniewska" }, { key: "nanny-2", name: "Sophie Taylor" }]);
    expect(view.families.map((f) => [f.key, f.name])).toEqual([["family-1", "Amira Ahmed"], ["family-2", "Olivia Hartley"], ["family-3", "Olivia Hartley"]]);
    expect(view.rows.map((r) => r.familyKey)).toEqual(["family-2", "family-1", "family-2", "family-2", "family-3"]);
    const payload = JSON.stringify(view);
    for (const id of [SOPHIE, LUCJA, HARTLEY, AHMED, u(13)]) expect(payload).not.toContain(id);
  });

  it("holds no email, bank field, path or send time", () => {
    const payload = JSON.stringify(toAdminInvoicesView(WORKED));
    expect(payload).not.toMatch(/@|4321|112233|87654321|\.pdf|2027-02-1\dT/);
  });

  it("says when it holds the admin limit (the newest only); empty in, empty out", () => {
    const many = Array.from({ length: INVOICE_RULES.adminListLimit }, (_, i) => invoice(1, { invoiceId: u(20000 + i) }));
    expect(toAdminInvoicesView(many).atLimit).toBe(true);
    expect(toAdminInvoicesView(WORKED).atLimit).toBe(false);
    expect(toAdminInvoicesView([])).toEqual({ rows: [], families: [], nannies: [], atLimit: false });
  });
});
