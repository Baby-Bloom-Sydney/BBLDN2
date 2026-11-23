/**
 * `/admin/invoices`, the server page (plan 06 step 17, §14.6 c.1; brief §0.11, §0.13, §3 admin; A14):
 * - Switch off ("", "false", "TRUE", "1"): `notFound()` before the admin check or any read (the `/admin/payouts` order).
 * - Not an admin (a parent, a nanny, nobody): `notFound()`, nothing read.
 * - On: every invoice that went out, through the entry point's `listAdminInvoices`, with the session's admin proof.
 * - **The RSC payload** — the props serialised to the browser — holds the rows' strings, the invoice ids, the family
 *   summaries and opaque filter keys: no email, no bank field, no PDF path, no user id, whatever extra the read carried.
 * - A failed read: the page with one plain message; any other failure is not swallowed.
 *
 * BB-wave1-041126/06c, 2026-11-23.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { isValidElement, type ReactElement } from "react";

const calls = vi.hoisted(() => ({ proveAdmin: vi.fn(), listAdminInvoices: vi.fn() }));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/calls/admin-proof", async (original) => ({ ...(await original<typeof import("@/lib/calls/admin-proof")>()), proveAdmin: calls.proveAdmin }));
vi.mock("@/lib/invoices", async (original) => ({ ...(await original<typeof import("@/lib/invoices")>()), listAdminInvoices: calls.listAdminInvoices }));

import { InvoiceReadError, type AdminInvoice } from "@/lib/invoices";
import AdminInvoicesPage, { dynamic } from "./page";
import { AdminInvoicesClient } from "./AdminInvoicesClient";

const u = (n: number) => `b0600000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const PROOF = { kind: "admin_proof", userId: u(31) };
const INVOICE: AdminInvoice = {
  invoiceId: u(9001), number: "BB-SophieTaylor-270215-0001", nannyId: u(101), nannyName: "Sophie Taylor", kind: "regular_week",
  periodStart: "2027-02-08", periodEnd: "2027-02-12", hours: 30, ratePence: 1800, shiftsPence: 54000, expensesPence: 0, vatPence: 0,
  totalPence: 54000, status: "sent", sentAt: "2027-02-14T10:00:00.000Z", cancelledAt: null, cancelReason: null, replacesNumber: null,
  replacedByNumber: null, parentUserId: u(11), familyName: "Olivia Hartley", vatMode: "none",
  delivery: { family: "sent", nanny: "sent", cancelFamily: null, cancelNanny: null },
};
/** What a careless read might carry on top: none of it may reach the browser. */
const EXTRA = {
  familyEmail: "admin+b06-11@babybloomnannies.co.uk", nannyEmail: "admin+b06-1@babybloomnannies.co.uk", sortCode: "112233",
  accountNumber: "87654321", pdfPath: `${u(101)}/${u(9001)}.pdf`,
};

beforeEach(() => {
  vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
  calls.proveAdmin.mockReset().mockResolvedValue(PROOF);
  calls.listAdminInvoices.mockReset().mockResolvedValue([{ ...INVOICE, ...EXTRA }]);
});
afterEach(() => vi.unstubAllEnvs());

const render = async () => (await AdminInvoicesPage()) as ReactElement<Record<string, unknown>>;

describe("/admin/invoices — switch off", () => {
  it.each(["", "false", "TRUE", "1"])("%j → notFound() before the admin check or any read", async (value) => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", value);
    await expect(render()).rejects.toThrow("NOT_FOUND");
    expect(calls.proveAdmin).not.toHaveBeenCalled();
    expect(calls.listAdminInvoices).not.toHaveBeenCalled();
  });
});

describe("/admin/invoices — switch on", () => {
  it("is rendered per request", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("not an admin (a parent, a nanny, nobody) → notFound(), nothing read", async () => {
    calls.proveAdmin.mockResolvedValueOnce(null);
    await expect(render()).rejects.toThrow("NOT_FOUND");
    expect(calls.listAdminInvoices).not.toHaveBeenCalled();
  });

  it("reads every invoice with the session's admin proof and renders the client", async () => {
    const out = await render();
    expect(isValidElement(out)).toBe(true);
    expect(out.type).toBe(AdminInvoicesClient);
    expect(calls.listAdminInvoices).toHaveBeenCalledWith(PROOF);
  });

  it("the RSC payload: rows, summaries and opaque keys only — no email, bank field, path or user id", async () => {
    const out = await render();
    expect(Object.keys(out.props).sort()).toEqual(["atLimit", "families", "loadFailed", "nannies", "rows"]);
    expect(out.props).toMatchObject({
      loadFailed: false,
      atLimit: false,
      families: [{ key: "family-1", name: "Olivia Hartley", summary: "1 invoice · 0 cancelled · 30 h · £540.00 (excluding cancelled)" }],
      nannies: [{ key: "nanny-1", name: "Sophie Taylor" }],
    });
    const payload = JSON.stringify(out.props);
    expect(payload).toContain(u(9001)); // the invoice id: its "View PDF" needs it
    for (const secret of ["@", "112233", "87654321", ".pdf", u(101), u(11), u(31), "admin_proof"]) expect(payload).not.toContain(secret);
  });

  it("a failed read → the page with one plain message, no rows", async () => {
    calls.listAdminInvoices.mockRejectedValueOnce(new InvoiceReadError("admin invoices"));
    expect((await render()).props).toEqual({ rows: [], families: [], nannies: [], atLimit: false, loadFailed: true });
  });

  it("any other failure is not swallowed", async () => {
    calls.listAdminInvoices.mockRejectedValueOnce(new TypeError("boom"));
    await expect(render()).rejects.toThrow("boom");
  });
});
