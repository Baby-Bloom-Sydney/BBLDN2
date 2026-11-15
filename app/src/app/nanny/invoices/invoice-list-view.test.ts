/**
 * Her invoice list as the page shows it (plan 06 old step 14, §14.6 b4.4; brief §0.6–0.9, §3 nanny 7–11; R1, R15):
 * one row per invoice, newest first as read — number, family, the period (its first to last shift date: "8–12 Feb
 * 2027", one day "3 Feb 2027"; 06b-4 rework), hours, total, the shown status (a send stuck past the stale time is "failed"), "Emailed ✓", what wasn't
 * delivered (a recorded failure, the resend action's rule, so it can be resent), "Replaces …" / "Replaced by …", and
 * which actions apply. Strings and the invoice
 * id only: no family id, no nanny id, no placement.
 *
 * BB-wave1-041126/06b4, 2026-11-12; BB-wave1-041126/06b4-ui, 2026-11-12 (rework: the period).
 */
import { describe, expect, it } from "vitest";
import { myInvoiceRow } from "@/lib/invoices/store-map-lines";
import { invoiceRow, NANNY_ID, NOW, PARENT_USER, PLACEMENT } from "@/lib/invoices/invoice-rows.test-util";
import { familyNames, noticeFor, toInvoiceRows } from "./invoice-list-view";

const mine = (...over: Array<Record<string, unknown>>) => over.map((o) => myInvoiceRow.parse(invoiceRow(o)));

describe("toInvoiceRows", () => {
  it("a sent invoice: number, family, period, hours, total, Sent, Emailed ✓, View PDF and Cancel", () => {
    const [row] = toInvoiceRows(mine({ invoice_number: "BB-SophieTaylor-270215-0001" }), NOW);
    expect(row).toEqual({
      invoiceId: expect.any(String),
      number: "BB-SophieTaylor-270215-0001",
      familyName: "Olivia Hartley",
      period: "8–12 Feb 2027",
      hours: "30 h",
      total: "£540.00",
      status: "sent",
      cancelReason: null,
      emailed: true,
      undelivered: [],
      replacesNumber: null,
      replacedByNumber: null,
      hasPdf: true,
      canCancel: true,
      canCorrect: false,
    });
  });

  it("one day reads as its date, whatever the link (no Trial Shift wording)", () => {
    const [row] = toInvoiceRows(mine({ kind: "trial_shift", period_start: "2027-02-03", period_end: "2027-02-03", placement_id: null, connection_request_id: PLACEMENT, hours: 4 }), NOW);
    expect(row?.period).toBe("3 Feb 2027");
    expect(row?.hours).toBe("4 h");
  });

  it("a period of any length: across months, and across years", () => {
    const rows = toInvoiceRows(mine(
      { period_start: "2026-10-29", period_end: "2026-11-02" },
      { period_start: "2026-12-29", period_end: "2027-01-02" },
      { period_start: "2026-11-02", period_end: "2026-11-29" },
    ), NOW);
    expect(rows.map((r) => r.period)).toEqual(["29 Oct – 2 Nov 2026", "29 Dec 2026 – 2 Jan 2027", "2–29 Nov 2026"]);
  });

  it("expenses only: its send date, 0 h", () => {
    const [row] = toInvoiceRows(mine({ period_start: "2027-02-14", period_end: "2027-02-14", hours: 0, shifts_pence: 0, expenses_pence: 1250, total_pence: 1250 }), NOW);
    expect(row).toMatchObject({ period: "14 Feb 2027", hours: "0 h", total: "£12.50" });
  });

  it("carries no family, nanny or placement id", () => {
    const text = JSON.stringify(toInvoiceRows(mine({}, { status: "cancelled", cancel_reason: "wrong_hours" }), NOW));
    for (const id of [NANNY_ID, PARENT_USER, PLACEMENT]) expect(text).not.toContain(id);
  });

  it("a family email that failed: not Emailed, offered for resend; her copy too", () => {
    const [row] = toInvoiceRows(mine({ family_email_status: "failed", nanny_email_status: "failed" }), NOW);
    expect(row?.emailed).toBe(false);
    expect(row?.undelivered).toEqual([
      { what: "invoice", recipient: "family" },
      { what: "invoice", recipient: "nanny" },
    ]);
  });

  it("only a recorded failure is offered (the resend action's rule): no record isn't", () => {
    const [row] = toInvoiceRows(mine({ family_email_status: null, nanny_email_status: null }), NOW);
    expect(row?.undelivered).toEqual([]);
  });

  it("cancelled: its reason, no Cancel; a cancellation not delivered can be resent; correctable until corrected", () => {
    const [row] = toInvoiceRows(mine({ status: "cancelled", cancel_reason: "wrong_hours", cancelled_at: "2027-02-14T11:00:00+00:00", cancel_family_email_status: "sent", cancel_nanny_email_status: "failed" }), NOW);
    expect(row).toMatchObject({ status: "cancelled", cancelReason: "Wrong hours", canCancel: false, canCorrect: true, hasPdf: true, emailed: false });
    expect(row?.undelivered).toEqual([{ what: "cancellation", recipient: "nanny" }]);
  });

  it("a cancellation with no record of its emails offers no resend (a cancellation is resent only after a recorded failure)", () => {
    const [row] = toInvoiceRows(mine({ status: "cancelled", cancel_reason: "other", cancelled_at: "2027-02-14T11:00:00+00:00" }), NOW);
    expect(row?.undelivered).toEqual([]);
  });

  it("a correction names what it replaces; the cancelled one names its replacement and can't be corrected again", () => {
    const [newer, older] = mine({ invoice_number: "BB-SophieTaylor-270215-0003", replaces_invoice_id: "b0600000-0000-4000-8000-000000007001" },
      { id: "b0600000-0000-4000-8000-000000007001", invoice_number: "BB-SophieTaylor-270214-0001", status: "cancelled", cancel_reason: "wrong_hours", cancelled_at: "2027-02-14T11:00:00+00:00" });
    const rows = toInvoiceRows([newer!, older!], NOW);
    expect(rows[0]?.replacesNumber).toBe("BB-SophieTaylor-270214-0001");
    expect(rows[1]).toMatchObject({ replacedByNumber: "BB-SophieTaylor-270215-0003", canCorrect: false });
  });

  it("a failed correction doesn't count as the replacement", () => {
    const [newer, older] = mine({ replaces_invoice_id: "b0600000-0000-4000-8000-000000007002", status: "failed", family_email_status: null, nanny_email_status: null, sent_at: null },
      { id: "b0600000-0000-4000-8000-000000007002", status: "cancelled", cancel_reason: "other", cancelled_at: "2027-02-14T11:00:00+00:00" });
    const rows = toInvoiceRows([newer!, older!], NOW);
    expect(rows[1]).toMatchObject({ replacedByNumber: null, canCorrect: true });
    expect(rows[0]).toMatchObject({ status: "failed", hasPdf: false, canCancel: false, undelivered: [], emailed: false });
  });

  it("a send still going is sending; one stuck past the stale time shows as failed (R1)", () => {
    const fresh = mine({ status: "sending", created_at: "2027-02-15T09:55:00+00:00", sent_at: null, family_email_status: null, nanny_email_status: null });
    const stuck = mine({ status: "sending", created_at: "2027-02-15T09:00:00+00:00", sent_at: null, family_email_status: null, nanny_email_status: null });
    expect(toInvoiceRows(fresh, NOW)[0]).toMatchObject({ status: "sending", hasPdf: false, canCancel: false, undelivered: [] });
    expect(toInvoiceRows(stuck, NOW)[0]?.status).toBe("failed");
  });
});

describe("familyNames", () => {
  it("each family once, by name", () => {
    const rows = toInvoiceRows(mine({ family_name: "Priya Patel" }, {}, { family_name: "Priya Patel" }), NOW);
    expect(familyNames(rows)).toEqual(["Olivia Hartley", "Priya Patel"]);
  });
});

describe("noticeFor", () => {
  it("only the three send answers that land on the list, as their plain messages", () => {
    expect(noticeFor("not_recorded")).toBe("Your invoice was emailed, but your list couldn't be updated. Check your invoices before sending it again.");
    expect(noticeFor("in_progress")).toBe("This invoice is being sent — check your invoices in a moment.");
    expect(noticeFor("already_done")).toBe("This invoice has already been sent.");
    for (const other of [undefined, "", "error", "<b>x</b>", ["not_recorded"], "toString"]) expect(noticeFor(other)).toBeNull();
  });
});
