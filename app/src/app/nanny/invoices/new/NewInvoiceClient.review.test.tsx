/**
 * The review and send (plan 06 old steps 12, 14, §14.3, §14.6 b4.2/b4.4; brief §0.4–0.5, §0a A, C, §3 nanny 6–7;
 * A4; ledger B06 §9.10 item 4; risk X5):
 * - The review: "This invoice goes to … and a copy to you", who she is read-only (From / Business / Bill to, as the PDF
 *   prints) with "Change in Settings" in a new tab, her bank details masked, every line and the server's totals, the
 *   duplicate warning, "Replaces …"; Back and Send.
 * - **The first-invoice setup** appears only when her bank details (or, rarely, an address) are missing; it saves
 *   through the Business page's action (bank with no version: none saved; address with its row's version), then
 *   reviews again — the setup is gone and Send is there. Send never shows while the setup is needed.
 * - **Send** returns what the review sealed (`invoiceId`, `expectedTotalPence`, `reviewKey`) with the draft. Sent → her
 *   list. `changed`, `no_details`, `no_address`, `already_failed` → reviewed again, with the message. `in_progress`,
 *   `already_done`, `not_recorded` → her list with that message. Anything else → its message, on the review.
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const calls = vi.hoisted(() => ({ previewInvoice: vi.fn(), sendInvoice: vi.fn(), saveBusinessSettings: vi.fn(), push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: calls.push, refresh: calls.refresh }) }));
vi.mock("@/lib/invoices/actions/preview-invoice", () => ({ previewInvoice: calls.previewInvoice }));
vi.mock("@/lib/invoices/actions/send-invoice", () => ({ sendInvoice: calls.sendInvoice }));
vi.mock("@/lib/invoices/actions/save-business-settings", () => ({ saveBusinessSettings: calls.saveBusinessSettings }));
vi.mock("@/components/settings/AddressSearchField", () => ({
  AddressSearchField: ({ onPick, error }: { onPick: (home: unknown) => void; error?: string }) => (
    <div>
      <button type="button" onClick={() => onPick({ line1: "7 New Road", line2: "", town: "London", postcode: "N1 1AA" })}>pick an address</button>
      {error && <p>{error}</p>}
    </div>
  ),
}));

import type { InvoicePreview } from "@/lib/invoices/actions/invoice-messages";
import { NewInvoiceClient, type NewInvoiceClientProps } from "./NewInvoiceClient";

const PLACEMENT = "b0600000-0000-4000-8000-000000000411";
const INVOICE = "b0600000-0000-4000-8000-000000009001";
const KEY = "a".repeat(64);
const RATE = 1800;
const TARGET: NonNullable<NewInvoiceClientProps["target"]> = {
  kind: "regular_week", targetId: PLACEMENT, familyKey: "0", familyName: "Olivia Hartley", area: "Islington",
  weeks: ["2027-02-15", "2027-02-08"], periodStart: "2027-02-08",
  pattern: [{ offset: 0, hours: 6, ratePence: RATE, description: null }, { offset: 2, hours: 2, ratePence: 2200, description: "evening" }],
  expenses: [{ expenseType: "activities", amount: "12.50", description: "" }], ratePence: RATE, replaces: null,
};
const BASE: NewInvoiceClientProps = {
  families: [{ key: "0", familyName: "Olivia Hartley", area: "Islington", placementId: PLACEMENT, trials: [] }],
  target: TARGET, vat: { mode: "none", rateBp: null }, today: "2027-02-17", loadFailed: false,
};
const ISSUER: InvoicePreview["issuer"] = {
  businessType: "sole_trader", name: "Sophie Taylor", tradingName: "Sophie Taylor", tradingNameSource: "name",
  address: "1 Upper Street\nLondon\nN1 0AA", companyName: null, companyNumber: null, registeredOffice: null, partnershipName: null,
  vat: { mode: "none", rateBp: null, number: null },
};
const preview = (over: Partial<InvoicePreview> = {}): InvoicePreview => ({
  invoiceId: INVOICE, reviewKey: KEY, expectedTotalPence: 16_450,
  totals: { hours: 8, shiftsPence: 15_200, expensesPence: 1_250, vatPence: 0, netShiftsPence: 15_200, totalPence: 16_450 },
  vat: { mode: "none", rateBp: null },
  recipient: { familyName: "Olivia Hartley", emailHint: "olivia@…", area: "Islington" },
  issuer: ISSUER, bank: { accountName: "Sophie Taylor", sortCodeLast2: "33", accountLast4: "4321" },
  needsPaymentDetails: false, needsAddress: false, addressVersion: null, duplicates: [], replaces: null,
  ...over,
});
const DRAFT = {
  kind: "regular_week", targetId: PLACEMENT, periodStart: "2027-02-08", replacesInvoiceId: null,
  lines: [
    { kind: "shift", date: "2027-02-08", hours: 6, ratePence: RATE, description: "" },
    { kind: "shift", date: "2027-02-10", hours: 2, ratePence: 2200, description: "evening" },
    { kind: "expense", expenseType: "activities", amountPence: 1250, description: "" },
  ],
};

beforeEach(() => {
  for (const fn of Object.values(calls)) fn.mockReset();
  calls.previewInvoice.mockResolvedValue({ ok: true, preview: preview() });
  calls.sendInvoice.mockResolvedValue({ ok: true, invoiceId: INVOICE, number: "BB-SophieTaylor-270217-0001", delivery: { family: "sent", nanny: "sent" } });
  calls.saveBusinessSettings.mockResolvedValue({ ok: true });
});
afterEach(cleanup);

async function toReview(props: Partial<NewInvoiceClientProps> = {}) {
  render(<NewInvoiceClient {...BASE} {...props} />);
  await userEvent.click(screen.getByRole("button", { name: "Review" }));
  await screen.findByRole("button", { name: "Back" });
}

describe("the review", () => {
  it("the recipient, who she is (read-only, Change in Settings in a new tab), the masked bank details, the lines, the totals", async () => {
    await toReview();
    expect(screen.getByText("This invoice goes to Olivia Hartley (olivia@…) and a copy to you")).toBeInTheDocument();
    const from = within(screen.getByRole("group", { name: "From" }));
    expect(from.getByText("Sophie Taylor")).toBeInTheDocument();
    expect(from.getByText("1 Upper Street")).toBeInTheDocument();
    expect(from.getByText("N1 0AA")).toBeInTheDocument();
    expect(within(screen.getByRole("group", { name: "Bill to" })).getByText("olivia@…")).toBeInTheDocument();
    expect(screen.queryByRole("group", { name: "Business" })).toBeNull();
    const change = screen.getByRole("link", { name: /Change in Settings/ });
    expect(change).toHaveAttribute("href", "/nanny/settings?s=business");
    expect(change).toHaveAttribute("target", "_blank");
    expect(screen.getByText("sort code ••-••-33, account ending 4321")).toBeInTheDocument();
    expect(screen.getByText("Childcare, week of 8–14 Feb 2027")).toBeInTheDocument();
    expect(screen.getByText("6 h × £18.00")).toBeInTheDocument();
    expect(screen.getByText("evening")).toBeInTheDocument();
    expect(screen.getByText("Activities")).toBeInTheDocument();
    const totals = within(screen.getByRole("region", { name: "Totals" }));
    expect(totals.getByText("£164.50")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull(); // nothing of who she is can be changed here
  });

  it("a limited company with VAT: Business column; the server's VAT line", async () => {
    calls.previewInvoice.mockResolvedValueOnce({ ok: true, preview: preview({
      issuer: { ...ISSUER, businessType: "limited_company", companyName: "Little Steps Ltd", companyNumber: "12345678",
        registeredOffice: "2 Office Row\nLondon\nEC1A 1AA", address: "2 Office Row\nLondon\nEC1A 1AA", vat: { mode: "added", rateBp: 2000, number: "GB123456789" } },
      vat: { mode: "added", rateBp: 2000 },
      totals: { hours: 8, shiftsPence: 15_200, expensesPence: 1_250, vatPence: 3_040, netShiftsPence: 15_200, totalPence: 19_490 },
    }) });
    await toReview();
    const business = within(screen.getByRole("group", { name: "Business" }));
    expect(business.getByText("Little Steps Ltd")).toBeInTheDocument();
    expect(business.getByText("Company no. 12345678")).toBeInTheDocument();
    expect(business.getByText("VAT no. GB 123 4567 89")).toBeInTheDocument();
    expect(within(screen.getByRole("region", { name: "Totals" })).getByText("VAT at 20%")).toBeInTheDocument();
  });

  it("the duplicate warning, and Replaces … for a correction", async () => {
    calls.previewInvoice.mockResolvedValueOnce({ ok: true, preview: preview({
      duplicates: [{ invoiceId: "x", number: "BB-SophieTaylor-270212-0001" }],
      replaces: { invoiceId: "y", number: "BB-SophieTaylor-270211-0001" },
    }) });
    await toReview();
    expect(screen.getByText("You have already invoiced Olivia Hartley for this week (BB-SophieTaylor-270212-0001)")).toBeInTheDocument();
    expect(screen.getByText("Replaces BB-SophieTaylor-270211-0001")).toBeInTheDocument();
  });

  it("Back: the form again, as she left it, focus on Review", async () => {
    await toReview();
    await userEvent.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getAllByRole("group", { name: /^Shift \d+$/ })).toHaveLength(2);
    expect(within(screen.getByRole("group", { name: "Shift 2" })).getByLabelText("Description")).toHaveValue("evening");
    expect(document.activeElement).toBe(screen.getByRole("button", { name: "Review" }));
  });

  it("entering the review moves focus to its heading", async () => {
    await toReview();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "This invoice goes to Olivia Hartley (olivia@…) and a copy to you" }));
  });
});

describe("the first-invoice setup", () => {
  it("only when her bank details are missing: no Send until saved; saved with no version; reviewed again", async () => {
    calls.previewInvoice.mockResolvedValueOnce({ ok: true, preview: preview({ bank: null, needsPaymentDetails: true }) });
    await toReview();
    expect(screen.getByText("Add your bank details to send this invoice.")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Send" })).toBeNull();
    expect(screen.getByLabelText("Name on account")).toHaveValue("Sophie Taylor");
    await userEvent.type(screen.getByLabelText("Sort code"), "11-22-33");
    await userEvent.type(screen.getByLabelText("Account number"), "87654321");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(calls.saveBusinessSettings).toHaveBeenCalledWith({
      bank: { accountName: "Sophie Taylor", sortCode: "11-22-33", accountNumber: "87654321", expectedUpdatedAt: null },
    });
    expect(calls.previewInvoice).toHaveBeenCalledTimes(2);
    expect(await screen.findByRole("button", { name: "Send" })).toBeInTheDocument();
    expect(screen.queryByLabelText("Sort code")).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: /^This invoice goes to/ }));
  });

  it("saved, then the review again fails: the typed sort code and account number don't stay on the page", async () => {
    calls.previewInvoice.mockResolvedValueOnce({ ok: true, preview: preview({ bank: null, needsPaymentDetails: true }) });
    await toReview();
    await userEvent.type(screen.getByLabelText("Sort code"), "11-22-33");
    await userEvent.type(screen.getByLabelText("Account number"), "87654321");
    calls.previewInvoice.mockRejectedValueOnce(new Error("offline"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Something went wrong. Please try again.")).toBeInTheDocument();
    expect(calls.saveBusinessSettings).toHaveBeenCalledTimes(1);
    expect(screen.getByLabelText("Sort code")).toHaveValue("");
    expect(screen.getByLabelText("Account number")).toHaveValue("");
  });

  it("checked first, with the Business page's own messages: nothing saved", async () => {
    calls.previewInvoice.mockResolvedValueOnce({ ok: true, preview: preview({ bank: null, needsPaymentDetails: true }) });
    await toReview();
    await userEvent.type(screen.getByLabelText("Sort code"), "12");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(calls.saveBusinessSettings).not.toHaveBeenCalled();
    expect(screen.getByText("Enter a 6-digit sort code")).toBeInTheDocument();
    expect(screen.getByText("Enter an 8-digit account number")).toBeInTheDocument();
  });

  it("no address on file (rare: X5): asks for one too, saved with her row's version", async () => {
    calls.previewInvoice.mockResolvedValueOnce({ ok: true, preview: preview({ bank: null, needsPaymentDetails: true, needsAddress: true, addressVersion: "v-home" }) });
    await toReview();
    expect(screen.getByText("Add your address to send this invoice.")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Sort code"), "112233");
    await userEvent.type(screen.getByLabelText("Account number"), "87654321");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(screen.getByText("Choose your address")).toBeInTheDocument();
    expect(calls.saveBusinessSettings).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "pick an address" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(calls.saveBusinessSettings).toHaveBeenCalledWith({
      bank: { accountName: "Sophie Taylor", sortCode: "112233", accountNumber: "87654321", expectedUpdatedAt: null },
      address: { line1: "7 New Road", line2: "", town: "London", postcode: "N1 1AA", expectedUpdatedAt: "v-home" },
    });
  });

  it("only the address missing: her bank details stay masked on the review, and only the address is asked", async () => {
    calls.previewInvoice.mockResolvedValueOnce({ ok: true, preview: preview({ needsAddress: true, addressVersion: null }) });
    await toReview();
    expect(screen.getByText("sort code ••-••-33, account ending 4321")).toBeInTheDocument();
    expect(screen.queryByLabelText("Sort code")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "pick an address" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(calls.saveBusinessSettings).toHaveBeenCalledWith({
      address: { line1: "7 New Road", line2: "", town: "London", postcode: "N1 1AA", expectedUpdatedAt: null },
    });
  });

  it("a second invoice doesn't ask again (bank details on file → no setup)", async () => {
    await toReview();
    expect(screen.queryByLabelText("Sort code")).toBeNull();
    expect(screen.getByRole("button", { name: "Send" })).toBeInTheDocument();
  });

  it("a refusal by field shows under the field; stale reviews again with its message", async () => {
    calls.previewInvoice.mockResolvedValueOnce({ ok: true, preview: preview({ bank: null, needsPaymentDetails: true }) });
    calls.saveBusinessSettings.mockResolvedValueOnce({ ok: false, error: "invalid", message: "Please check the details marked below.", fields: { sortCode: "Enter a 6-digit sort code" } });
    await toReview();
    await userEvent.type(screen.getByLabelText("Sort code"), "112233");
    await userEvent.type(screen.getByLabelText("Account number"), "87654321");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter a 6-digit sort code")).toBeInTheDocument();
    calls.saveBusinessSettings.mockResolvedValueOnce({ ok: false, error: "stale", message: "These details were changed elsewhere. The latest are now showing." });
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("These details were changed elsewhere. The latest are now showing.")).toBeInTheDocument();
    expect(calls.previewInvoice).toHaveBeenCalledTimes(2);
  });
});

describe("Send", () => {
  it("returns the review's sealed id, total and key with the draft; sent → her list", async () => {
    await toReview();
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(calls.sendInvoice).toHaveBeenCalledWith({ ...DRAFT, invoiceId: INVOICE, expectedTotalPence: 16_450, reviewKey: KEY });
    expect(calls.push).toHaveBeenCalledWith("/nanny/invoices");
    // on its way to the list: Send doesn't come back (a second click would only meet "already sent")
    const sending = screen.getByRole("button", { name: /Sending/ });
    expect(sending).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(sending);
    expect(calls.sendInvoice).toHaveBeenCalledTimes(1);
  });

  it("a refusal by field goes back to the form with focus on that field", async () => {
    calls.sendInvoice.mockResolvedValueOnce({ ok: false, error: "invalid", message: "Please check the details marked below.", fields: { "lines.1.hours": "Enter the hours worked" } });
    await toReview();
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    const hours = within(await screen.findByRole("group", { name: "Shift 2" })).getByLabelText("Hours");
    await waitFor(() => expect(document.activeElement).toBe(hours));
    expect(hours).toHaveAttribute("aria-invalid", "true");
  });

  it.each(["changed", "no_details", "no_address", "already_failed"])("%s → reviewed again, with the message", async (error) => {
    calls.sendInvoice.mockResolvedValueOnce({ ok: false, error, message: `message for ${error}` });
    await toReview();
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText(`message for ${error}`)).toBeInTheDocument();
    expect(calls.previewInvoice).toHaveBeenCalledTimes(2);
    expect(calls.push).not.toHaveBeenCalled();
  });

  it.each(["in_progress", "already_done", "not_recorded"])("%s → her list, which says so", async (error) => {
    calls.sendInvoice.mockResolvedValueOnce({ ok: false, error, message: "x" });
    await toReview();
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(calls.push).toHaveBeenCalledWith(`/nanny/invoices?notice=${error}`);
  });

  it("anything else → its message on the review; a throw → the general message", async () => {
    calls.sendInvoice.mockResolvedValueOnce({ ok: false, error: "cap", message: "You can send up to 10 invoices a day. Please try again tomorrow." });
    await toReview();
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("You can send up to 10 invoices a day. Please try again tomorrow.")).toBeInTheDocument();
    calls.sendInvoice.mockRejectedValueOnce(new Error("Failed to find Server Action"));
    await userEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(await screen.findByText("Something went wrong. Please try again.")).toBeInTheDocument();
  });

  it("one send at a time", async () => {
    let finish: (v: unknown) => void = () => {};
    calls.sendInvoice.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    await toReview();
    const send = screen.getByRole("button", { name: "Send" });
    await userEvent.click(send);
    await userEvent.click(screen.getByRole("button", { name: /Sending/ }));
    expect(calls.sendInvoice).toHaveBeenCalledTimes(1);
    finish({ ok: true, invoiceId: INVOICE, number: "n", delivery: { family: "sent", nanny: "sent" } });
  });
});
