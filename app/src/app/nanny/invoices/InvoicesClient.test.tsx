/**
 * Her invoices page, client half (plan 06 old step 14, §14.6 b4.4; brief §0.6–0.9, §3 nanny 7–11; R14a, R15, §14.3):
 * - "New invoice" is a link, never disabled — with or without bank details (§14.3 replaces §0.1).
 * - Her business card: type, trading name ("None" when she hasn't entered one), bank details masked or "Not added",
 *   and "Change in Settings" (a new tab).
 * - Each row: number, family, period, hours, total, status, "Emailed ✓"; "View PDF" (a new tab, through the PDF
 *   route); "Cancel invoice" on a sent one; "Send a corrected invoice" on a cancelled one not yet corrected;
 *   "Not delivered to the family" with "Resend email"; "Resend cancellation" when a cancellation wasn't delivered.
 * - Filterable by family (R14a).
 * - Cancel: a reason must be chosen; it calls the action with the id and reason, then refreshes; a refusal shows
 *   its plain message in the dialog.
 * - Resend: the action with what and to whom, then a refresh.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const calls = vi.hoisted(() => ({ cancelInvoice: vi.fn(), resendInvoiceEmail: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: calls.refresh, push: vi.fn() }) }));
vi.mock("@/lib/invoices/actions/cancel-invoice", () => ({ cancelInvoice: calls.cancelInvoice }));
vi.mock("@/lib/invoices/actions/resend-invoice-email", () => ({ resendInvoiceEmail: calls.resendInvoiceEmail }));

import { myInvoiceRow } from "@/lib/invoices/store-map-lines";
import { invoiceRow, NOW } from "@/lib/invoices/invoice-rows.test-util";
import { toInvoiceRows, type InvoiceRowView } from "./invoice-list-view";
import { InvoicesClient, type InvoicesClientProps } from "./InvoicesClient";

const SENT = "b0600000-0000-4000-8000-000000006001";
const CANCELLED = "b0600000-0000-4000-8000-000000006002";
const rows = (...over: Array<Record<string, unknown>>): readonly InvoiceRowView[] =>
  toInvoiceRows(over.map((o) => myInvoiceRow.parse(invoiceRow(o))), NOW);

const BASE: InvoicesClientProps = {
  rows: rows(
    { id: SENT, invoice_number: "BB-SophieTaylor-270215-0002", family_email_status: "failed" },
    { id: CANCELLED, invoice_number: "BB-SophieTaylor-270214-0001", family_name: "Priya Patel", status: "cancelled", cancel_reason: "wrong_hours", cancelled_at: "2027-02-14T11:00:00+00:00", cancel_family_email_status: "sent", cancel_nanny_email_status: "failed" },
  ),
  business: { businessType: "Sole trader", tradingName: null },
  bank: { accountName: "Sophie Taylor", sortCodeLast2: "33", accountLast4: "4321" },
  loadFailed: false,
  notice: null,
};

beforeEach(() => {
  calls.cancelInvoice.mockReset().mockResolvedValue({ ok: true, invoiceId: SENT, number: "x", delivery: { family: "sent", nanny: "sent" } });
  calls.resendInvoiceEmail.mockReset().mockResolvedValue({ ok: true, invoiceId: SENT, what: "invoice", recipient: "family", delivery: "sent" });
  calls.refresh.mockReset();
});
afterEach(cleanup);

const rowOf = (number: string) => screen.getByText(number).closest("li") as HTMLElement;

describe("InvoicesClient — the page", () => {
  it("New invoice is a link to the form, never disabled — even with no bank details", () => {
    render(<InvoicesClient {...BASE} bank={null} />);
    const link = screen.getByRole("link", { name: "New invoice" });
    expect(link).toHaveAttribute("href", "/nanny/invoices/new");
    expect(link).not.toHaveAttribute("aria-disabled");
  });

  it("the business card: type, trading name, bank details masked, Change in Settings in a new tab", () => {
    render(<InvoicesClient {...BASE} />);
    expect(screen.getByText("Sole trader")).toBeInTheDocument();
    expect(screen.getByText("None")).toBeInTheDocument();
    expect(screen.getByText("sort code ••-••-33, account ending 4321")).toBeInTheDocument();
    const change = screen.getByRole("link", { name: /Change in Settings/ });
    expect(change).toHaveAttribute("href", "/nanny/settings?s=business");
    expect(change).toHaveAttribute("target", "_blank");
    expect(change).toHaveAttribute("rel", expect.stringContaining("noopener"));
  });

  it("no bank details → Not added", () => {
    render(<InvoicesClient {...BASE} bank={null} />);
    expect(screen.getByText("Not added")).toBeInTheDocument();
  });

  it("a load failure: one plain message, no list; New invoice still there", () => {
    render(<InvoicesClient {...BASE} rows={[]} bank={null} business={null} loadFailed />);
    expect(screen.getByText("Something went wrong. Please try again.")).toBeInTheDocument();
    expect(screen.queryByText("Bank details")).toBeNull(); // never "Not added" for a read that failed
    expect(screen.queryByText("Not added")).toBeNull();
    expect(screen.queryByRole("list")).toBeNull();
    expect(screen.getByRole("link", { name: "New invoice" })).toBeInTheDocument();
  });

  it("no invoices yet", () => {
    render(<InvoicesClient {...BASE} rows={[]} />);
    expect(screen.getByText("No invoices yet.")).toBeInTheDocument();
  });

  it("a notice from a send shows as a status", () => {
    render(<InvoicesClient {...BASE} notice="This invoice has already been sent." />);
    expect(screen.getByRole("alert")).toHaveTextContent("This invoice has already been sent.");
  });
});

describe("InvoicesClient — rows", () => {
  it("a sent row: family, period, hours, total, Sent; View PDF in a new tab; Cancel invoice; family not delivered → Resend email", () => {
    render(<InvoicesClient {...BASE} />);
    const row = within(rowOf("BB-SophieTaylor-270215-0002"));
    for (const text of ["Olivia Hartley", "week of 8 Feb 2027", "30 h", "£540.00", "Sent", "Not delivered to the family"]) {
      expect(row.getByText(text)).toBeInTheDocument();
    }
    expect(row.queryByText("Emailed ✓")).toBeNull();
    const pdf = row.getByRole("link", { name: "View PDF" });
    expect(pdf).toHaveAttribute("href", `/nanny/invoices/${SENT}/pdf`);
    expect(pdf).toHaveAttribute("target", "_blank");
    expect(row.getByRole("button", { name: "Cancel invoice" })).toBeInTheDocument();
    expect(row.getByRole("button", { name: "Resend email" })).toBeInTheDocument();
  });

  it("ids go into links encoded (whatever a row's id holds)", () => {
    const odd = { ...rows({})[0]!, invoiceId: "a/b?c" };
    render(<InvoicesClient {...BASE} rows={[odd]} />);
    expect(screen.getByRole("link", { name: "View PDF" })).toHaveAttribute("href", "/nanny/invoices/a%2Fb%3Fc/pdf");
  });

  it("a delivered row says Emailed ✓", () => {
    render(<InvoicesClient {...BASE} rows={rows({})} />);
    expect(screen.getByText("Emailed ✓")).toBeInTheDocument();
  });

  it("a cancelled row: Cancelled · reason, no Cancel, Send a corrected invoice, Resend cancellation to her", () => {
    render(<InvoicesClient {...BASE} />);
    const row = within(rowOf("BB-SophieTaylor-270214-0001"));
    expect(row.getByText("Cancelled · Wrong hours")).toBeInTheDocument();
    expect(row.queryByRole("button", { name: "Cancel invoice" })).toBeNull();
    expect(row.getByRole("link", { name: "Send a corrected invoice" })).toHaveAttribute("href", `/nanny/invoices/new?replaces=${CANCELLED}`);
    expect(row.getByText("Not delivered to you")).toBeInTheDocument();
    expect(row.getByRole("button", { name: "Resend cancellation" })).toBeInTheDocument();
  });

  it("filters by family (R14a)", async () => {
    render(<InvoicesClient {...BASE} />);
    await userEvent.selectOptions(screen.getByLabelText("Family"), "Priya Patel");
    expect(screen.queryByText("BB-SophieTaylor-270215-0002")).toBeNull();
    expect(screen.getByText("BB-SophieTaylor-270214-0001")).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText("Family"), "All families");
    expect(screen.getByText("BB-SophieTaylor-270215-0002")).toBeInTheDocument();
  });

  it("a chosen family that's gone after a refresh: all families again", async () => {
    const view = render(<InvoicesClient {...BASE} />);
    await userEvent.selectOptions(screen.getByLabelText("Family"), "Priya Patel");
    view.rerender(<InvoicesClient {...BASE} rows={[...BASE.rows.slice(0, 1), ...rows({ family_name: "Amira Khan" })]} />);
    expect(screen.getByText("BB-SophieTaylor-270215-0002")).toBeInTheDocument();
    expect(screen.getByLabelText("Family")).toHaveValue("");
  });

  it("one family: no filter", () => {
    render(<InvoicesClient {...BASE} rows={rows({})} />);
    expect(screen.queryByLabelText("Family")).toBeNull();
  });

  it("Resend email → the action for that invoice and recipient, then a refresh", async () => {
    render(<InvoicesClient {...BASE} />);
    await userEvent.click(within(rowOf("BB-SophieTaylor-270215-0002")).getByRole("button", { name: "Resend email" }));
    expect(calls.resendInvoiceEmail).toHaveBeenCalledWith({ invoiceId: SENT, what: "invoice", recipient: "family" });
    expect(calls.refresh).toHaveBeenCalled();
  });

  it("a refused resend shows its message", async () => {
    calls.resendInvoiceEmail.mockResolvedValueOnce({ ok: false, error: "not_resendable", message: "There's nothing to resend for this invoice." });
    render(<InvoicesClient {...BASE} />);
    await userEvent.click(within(rowOf("BB-SophieTaylor-270214-0001")).getByRole("button", { name: "Resend cancellation" }));
    expect(calls.resendInvoiceEmail).toHaveBeenCalledWith({ invoiceId: CANCELLED, what: "cancellation", recipient: "nanny" });
    expect(await screen.findByRole("alert")).toHaveTextContent("There's nothing to resend for this invoice.");
  });
});

describe("InvoicesClient — cancel", () => {
  it("opens the dialog; Cancel invoice needs a reason; then the action, the dialog closes and the list refreshes", async () => {
    render(<InvoicesClient {...BASE} />);
    await userEvent.click(within(rowOf("BB-SophieTaylor-270215-0002")).getByRole("button", { name: "Cancel invoice" }));
    const dialog = within(await screen.findByRole("dialog"));
    expect(dialog.getByText(/BB-SophieTaylor-270215-0002/)).toBeInTheDocument();
    const confirm = dialog.getByRole("button", { name: "Cancel invoice" });
    expect(confirm).toBeDisabled();
    await userEvent.click(dialog.getByLabelText("Wrong hours"));
    await userEvent.click(confirm);
    expect(calls.cancelInvoice).toHaveBeenCalledWith({ invoiceId: SENT, reason: "wrong_hours" });
    expect(calls.refresh).toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("Back closes it without cancelling", async () => {
    render(<InvoicesClient {...BASE} />);
    await userEvent.click(within(rowOf("BB-SophieTaylor-270215-0002")).getByRole("button", { name: "Cancel invoice" }));
    await userEvent.click(within(await screen.findByRole("dialog")).getByRole("button", { name: "Back" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(calls.cancelInvoice).not.toHaveBeenCalled();
  });

  it("a refusal stays in the dialog with its plain message", async () => {
    calls.cancelInvoice.mockResolvedValueOnce({ ok: false, error: "not_cancellable", message: "Only a sent invoice can be cancelled." });
    render(<InvoicesClient {...BASE} />);
    await userEvent.click(within(rowOf("BB-SophieTaylor-270215-0002")).getByRole("button", { name: "Cancel invoice" }));
    const dialog = within(await screen.findByRole("dialog"));
    await userEvent.click(dialog.getByLabelText("Other"));
    await userEvent.click(dialog.getByRole("button", { name: "Cancel invoice" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("Only a sent invoice can be cancelled.");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("a thrown action gives the general message", async () => {
    calls.cancelInvoice.mockRejectedValueOnce(new Error("Failed to find Server Action"));
    render(<InvoicesClient {...BASE} />);
    await userEvent.click(within(rowOf("BB-SophieTaylor-270215-0002")).getByRole("button", { name: "Cancel invoice" }));
    const dialog = within(await screen.findByRole("dialog"));
    await userEvent.click(dialog.getByLabelText("Wrong rate"));
    await userEvent.click(dialog.getByRole("button", { name: "Cancel invoice" }));
    expect(await dialog.findByRole("alert")).toHaveTextContent("Something went wrong. Please try again.");
  });
});
