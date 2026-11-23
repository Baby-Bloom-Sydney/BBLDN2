/**
 * BAI's read-only `/admin/invoices` list, the store's half (plan 06 step 17, §14.6 c.1; brief §0.11, §3 admin; R1):
 * - Every invoice that went out — sent or cancelled, with its PDF — newest sent first, the newest `adminListLimit`.
 * - Each row carries the family readers' fields plus the family's name, the VAT mode and the four email deliveries;
 *   never an email, a bank field, the issuer or the PDF path.
 * - Rows the query returned anyway (failed, sending, no PDF) are dropped again here; a row that doesn't fit fails the
 *   read; failures are logged by code only.
 * - The switch first (before a client is made), then an admin proof.
 *
 * BB-wave1-041126/06c, 2026-11-23.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { requireAdmin, createAdminClient } = vi.hoisted(() => ({ requireAdmin: vi.fn(), createAdminClient: vi.fn() }));
vi.mock("@/lib/admin/require-admin", () => ({ requireAdmin }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient }));

import { INVOICE_RULES } from "@/config/invoices";
import { proveAdmin, type AdminProof } from "@/lib/calls/admin-proof";
import { fakeAdmin, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";
import { NANNY_ID, PARENT_USER, SECRETS } from "./invoice-rows.test-util";
import { ADMIN_COLUMNS, readAdminInvoiceRows } from "./store-admin";

const u = (n: number) => `b0600000-0000-4000-8000-${String(n).padStart(12, "0")}`;

/** One invoice as the admin read returns it: the Hartleys' 8–12 Feb, 30 h, sent, unless overridden. */
const adminRow = (n: number, over: Readonly<Record<string, unknown>> = {}) => ({
  id: u(9000 + n), invoice_seq: n, invoice_number: `BB-SophieTaylor-270215-${String(n).padStart(4, "0")}`, nanny_id: NANNY_ID,
  nanny_name: "Sophie Taylor", kind: "regular_week", period_start: "2027-02-08", period_end: "2027-02-12", hours: 30,
  shifts_pence: 54000, expenses_pence: 0, vat_pence: 0, total_pence: 54000, nanny_invoice_lines: [{ kind: "shift", rate_pence: 1800 }],
  status: "sent", pdf_path: `${NANNY_ID}/${u(9000 + n)}.pdf`, sent_at: `2027-02-1${n}T09:00:00+00:00`, cancelled_at: null,
  cancel_reason: null, replaces_invoice_id: null, parent_user_id: PARENT_USER, family_name: "Olivia Hartley", vat_mode: "none",
  family_email_status: "sent", nanny_email_status: "sent", cancel_family_email_status: null, cancel_nanny_email_status: null,
  // columns the read never asks for: whatever the database sent, they never leave
  family_email: "admin+b06-11@babybloomnannies.co.uk", account_last4: "4321", sort_code: "112233",
  ...over,
});

let f: FakeAdmin;
let proof: AdminProof;
const spies: Array<ReturnType<typeof vi.spyOn>> = [];

beforeEach(async () => {
  vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
  f = fakeAdmin({ nanny_invoices: [adminRow(2), adminRow(1)] });
  createAdminClient.mockReset().mockReturnValue(f.client);
  requireAdmin.mockReset().mockResolvedValue({ userId: u(31), error: null });
  const p = await proveAdmin();
  if (!p) throw new Error("fixture proof");
  proof = p;
  spies.splice(0);
  for (const level of ["error", "warn", "log", "info"] as const) spies.push(vi.spyOn(console, level).mockImplementation(() => {}));
});

afterEach(() => {
  expect(JSON.stringify(spies.flatMap((s) => s.mock.calls))).not.toMatch(SECRETS);
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("readAdminInvoiceRows", () => {
  it("asks for what went out, newest sent first, at most the admin limit (500)", async () => {
    expect((await readAdminInvoiceRows(proof)).ok).toBe(true);
    expect(INVOICE_RULES.adminListLimit).toBe(500);
    const read = f.ops.find((o) => o.table === "nanny_invoices");
    expect(read?.kind).toBe("select");
    expect(read?.filters).toEqual([
      ["in", "status", ["sent", "cancelled"]],
      ["not", "pdf_path", "is"],
      ["order", "sent_at", { ascending: false }],
      ["order", "id", { ascending: false }],
      ["limit", 500, undefined],
    ]);
  });

  it("reads no email, bank, issuer or link column (pdf_path only to re-check R1)", () => {
    const columns = ADMIN_COLUMNS.replace(/\(.*\)/, "").split(", ").map((c) => c.trim());
    for (const banned of ["family_email", "nanny_email", "sort_code", "account_number", "account_last4", "account_name", "issuer_address", "issuer_trading_name"]) {
      expect(columns).not.toContain(banned);
    }
    expect(columns).toEqual(expect.arrayContaining(["family_name", "vat_mode", "parent_user_id", "family_email_status", "cancel_nanny_email_status"]));
  });

  it("maps each row: the family readers' fields, the family's name, the VAT mode and the four deliveries", async () => {
    f.reads.nanny_invoices = [
      adminRow(1, {
        status: "cancelled", cancelled_at: "2027-02-15T12:00:00+00:00", cancel_reason: "wrong_hours", vat_mode: "added",
        cancel_family_email_status: "sent", cancel_nanny_email_status: "failed", nanny_email_status: "failed",
      }),
    ];
    const read = await readAdminInvoiceRows(proof);
    expect(read).toEqual({
      ok: true,
      value: [{
        invoiceId: u(9001), seq: 1, number: "BB-SophieTaylor-270215-0001", nannyId: NANNY_ID, nannyName: "Sophie Taylor",
        kind: "regular_week", periodStart: "2027-02-08", periodEnd: "2027-02-12", hours: 30, ratePence: 1800, shiftsPence: 54000,
        expensesPence: 0, vatPence: 0, totalPence: 54000, status: "cancelled", sentAt: "2027-02-11T09:00:00.000Z",
        cancelledAt: "2027-02-15T12:00:00.000Z", cancelReason: "wrong_hours", replacesInvoiceId: null,
        parentUserId: PARENT_USER, familyName: "Olivia Hartley", vatMode: "added",
        delivery: { family: "sent", nanny: "failed", cancelFamily: "sent", cancelNanny: "failed" },
      }],
    });
    expect(JSON.stringify(read)).not.toMatch(/@|4321|112233|\.pdf|pdf_path/);
  });

  it("drops a row the query returned that never went out (failed, sending, no PDF, no send time)", async () => {
    f.reads.nanny_invoices = [
      adminRow(1), adminRow(2, { status: "failed" }), adminRow(3, { status: "sending" }), adminRow(4, { pdf_path: null }),
      adminRow(5, { sent_at: null }),
    ];
    const read = await readAdminInvoiceRows(proof);
    expect(read.ok && read.value.map((r) => r.seq)).toEqual([1]);
  });

  it("a read failure, a thrown read, a reply that isn't rows, or a row that doesn't fit → error, logged by code only", async () => {
    f.readErrors.nanny_invoices = { message: "boom Olivia Hartley 87654321", code: "XX000" };
    expect(await readAdminInvoiceRows(proof)).toEqual({ ok: false, error: "error" });
    f.readErrors.nanny_invoices = undefined;
    f.reads.nanny_invoices = { not: "rows" };
    expect(await readAdminInvoiceRows(proof)).toEqual({ ok: false, error: "error" });
    f.reads.nanny_invoices = [adminRow(1, { vat_mode: "sometimes" })];
    expect(await readAdminInvoiceRows(proof)).toEqual({ ok: false, error: "error" });
    f.reads.nanny_invoices = () => {
      throw new Error("Olivia Hartley");
    };
    expect(await readAdminInvoiceRows(proof)).toEqual({ ok: false, error: "error" });
    createAdminClient.mockImplementationOnce(() => {
      throw new Error("no key");
    });
    expect(await readAdminInvoiceRows(proof)).toEqual({ ok: false, error: "error" });
  });

  it("switch off → invoices_disabled before a client; not an admin proof → invalid, nothing read", async () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "false");
    createAdminClient.mockClear();
    expect(await readAdminInvoiceRows(proof)).toEqual({ ok: false, error: "invoices_disabled" });
    expect(createAdminClient).not.toHaveBeenCalled();
    vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
    expect(await readAdminInvoiceRows({ kind: "admin_proof", userId: u(31) } as unknown as AdminProof)).toEqual({ ok: false, error: "invalid" });
    expect(f.ops).toEqual([]);
  });
});
