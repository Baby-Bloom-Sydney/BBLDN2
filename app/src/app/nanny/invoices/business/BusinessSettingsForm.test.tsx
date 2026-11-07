/**
 * The Settings Business section (plan 06 §14.6 b3.3; brief §0a B, C; acceptance A2, A3, A4's Settings share).
 * - **Zero setup** (A2): "Sole trader", "Sophie Taylor (your name)", her verification address marked "(from your
 *   verification)", "Not VAT registered", bank details "Not added yet" — each default shown with its source.
 * - **A limited company** prints its registered office as its one address (BAI 2026-11-07): the screen says so and
 *   shows no other address row. A trading name she enters replaces the business's name.
 * - Every save goes through the shared schema first (a refusal shows the plain message, the action isn't called),
 *   then the action, then a refresh; a double submit calls the action once; a refusal shows the action's message.
 * - "Changes apply to future invoices. Invoices you've sent stay as they were."
 *
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";

const h = vi.hoisted(() => ({ refresh: vi.fn(), saveBusinessDetails: vi.fn(), savePaymentDetails: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }));
vi.mock("@/lib/invoices/actions/save-business-details", () => ({ saveBusinessDetails: h.saveBusinessDetails }));
vi.mock("@/lib/invoices/actions/save-payment-details", () => ({ savePaymentDetails: h.savePaymentDetails }));

import { BusinessSettingsForm } from "./BusinessSettingsForm";
import type { BankView, BusinessView } from "./business-view";

const DEFAULTS: BusinessView = {
  businessType: "sole_trader", name: "Sophie Taylor", tradingName: null, address: "1 Upper Street\nLondon\nN1 0AA",
  addressSource: "verification", companyName: null, companyNumber: null, registeredOffice: null, partnershipName: null,
  vatMode: "none", vatNumber: null, vatRateBp: null,
};
const LTD: BusinessView = {
  ...DEFAULTS, businessType: "limited_company", tradingName: "Little Steps", companyName: "Taylor Childcare Ltd",
  companyNumber: "SC123456", registeredOffice: "2 Office Row\nLondon\nEC1A 1AA", vatMode: "added", vatNumber: "GB123456789", vatRateBp: 2000,
};
const BANK: BankView = { accountName: "Sophie Taylor", sortCodeLast2: "33", accountLast4: "4321" };

beforeEach(() => {
  h.refresh.mockReset();
  h.saveBusinessDetails.mockReset().mockResolvedValue({ ok: true, changed: true });
  h.savePaymentDetails.mockReset().mockResolvedValue({ ok: true, masks: { sortCodeLast2: "33", accountLast4: "4321" } });
});
afterEach(cleanup);

const row = (label: string) => screen.getByText(label, { selector: "div.text-xs" }).closest("button, div.flex") as HTMLElement;
const show = (business: BusinessView = DEFAULTS, bank: BankView | null = null) => render(<BusinessSettingsForm business={business} bank={bank} />);

describe("BusinessSettingsForm — what it shows", () => {
  it("zero setup: every default, with its source (A2)", () => {
    show();
    expect(within(row("Business type")).getByText("Sole trader")).toBeInTheDocument();
    expect(within(row("Trading name")).getByText("Sophie Taylor")).toBeInTheDocument();
    expect(within(row("Trading name")).getByText("(your name)")).toBeInTheDocument();
    expect(within(row("Address on invoices")).getByText(/1 Upper Street\s+London\s+N1 0AA/)).toBeInTheDocument();
    expect(within(row("Address on invoices")).getByText("(from your verification)")).toBeInTheDocument();
    expect(within(row("VAT")).getByText("Not VAT registered")).toBeInTheDocument();
    expect(within(row("Bank details")).getByText("Not added yet")).toBeInTheDocument();
    expect(screen.getByText("Changes apply to future invoices. Invoices you've sent stay as they were.")).toBeInTheDocument();
  });

  it("a limited company with VAT added on top: the registered office is its one address; the trading name replaces its name", () => {
    show(LTD, BANK);
    expect(within(row("Business type")).getByText("Limited company")).toBeInTheDocument();
    expect(within(row("Company")).getByText("Taylor Childcare Ltd")).toBeInTheDocument();
    expect(within(row("Company")).getByText("Company no. SC123456")).toBeInTheDocument();
    expect(within(row("Registered office")).getByText(/2 Office Row\s+London\s+EC1A 1AA/)).toBeInTheDocument();
    expect(within(row("Registered office")).getByText("Your invoices show this as your address.")).toBeInTheDocument();
    expect(screen.queryByText("Address on invoices")).toBeNull();
    expect(within(row("Trading name")).getByText("Little Steps")).toBeInTheDocument();
    expect(within(row("Trading name")).getByText("Printed instead of the company's name.")).toBeInTheDocument();
    expect(within(row("VAT")).getByText("VAT added on top · 20%")).toBeInTheDocument();
    expect(within(row("VAT")).getByText("VAT no. GB 123 4567 89")).toBeInTheDocument();
    expect(within(row("Bank details")).getByText("Sophie Taylor · sort code ••-••-33, account ending 4321")).toBeInTheDocument();
  });

  it("a company with no trading name says its registered name is used; a partnership shows its name", () => {
    show({ ...LTD, tradingName: null });
    expect(within(row("Trading name")).getByText("None — your invoices use the company's name")).toBeInTheDocument();
    cleanup();
    show({ ...DEFAULTS, businessType: "partnership", partnershipName: "Taylor & Hart" });
    expect(within(row("Partnership name")).getByText("Taylor & Hart")).toBeInTheDocument();
    expect(within(row("Trading name")).getByText("None — your invoices use the partnership's name")).toBeInTheDocument();
    expect(row("Address on invoices")).toBeTruthy();
  });

  it("the longer notes wrap instead of being cut off on a narrow screen (the row's value cell truncates)", () => {
    show({ ...LTD, tradingName: null });
    expect(screen.getByText("None — your invoices use the company's name")).toHaveClass("whitespace-normal");
    cleanup();
    show({ ...DEFAULTS, name: null, address: null, addressSource: null });
    expect(screen.getByText("Not on file — add the address for your invoices")).toHaveClass("whitespace-normal");
    expect(screen.getByText("Not set — add a name for your invoices")).toHaveClass("whitespace-normal");
  });

  it("an address she entered has no source note; none on file asks for one; no printable name asks for one", () => {
    show({ ...DEFAULTS, address: "9 Home Lane", addressSource: "business" });
    expect(screen.queryByText("(from your verification)")).toBeNull();
    cleanup();
    show({ ...DEFAULTS, name: null, address: null, addressSource: null });
    expect(within(row("Address on invoices")).getByText("Not on file — add the address for your invoices")).toBeInTheDocument();
    expect(within(row("Trading name")).getByText("Not set — add a name for your invoices")).toBeInTheDocument();
  });

  it("closing a dialog (Escape, Cancel or a save) gives focus back to the row that opened it", async () => {
    show(LTD, BANK);
    for (const label of ["Business type", "Trading name", "VAT", "Bank details"]) {
      const button = row(label);
      button.focus();
      fireEvent.click(button);
      expect(screen.getByRole("dialog")).toBeInTheDocument();
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      await waitFor(() => expect(document.activeElement).toBe(button));
    }
    const vat = row("VAT");
    fireEvent.click(vat);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(document.activeElement).toBe(vat));
    const trading = row("Trading name");
    fireEvent.click(trading);
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.refresh).toHaveBeenCalled());
    await waitFor(() => expect(document.activeElement).toBe(trading));
  });

  it("every row opens its dialog", () => {
    show(LTD, BANK);
    for (const [label, dialog] of [
      ["Business type", "Business type"], ["Company", "Business type"], ["Registered office", "Business type"],
      ["Trading name", "Trading name"], ["VAT", "VAT"], ["Bank details", "Change your bank details"],
    ] as const) {
      fireEvent.click(row(label));
      expect(screen.getByRole("dialog", { name: dialog })).toBeInTheDocument();
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    }
  });
});

describe("BusinessSettingsForm — saving", () => {
  it("a business save sends her details with the dialog's change on top, then refreshes", async () => {
    show();
    fireEvent.click(row("Trading name"));
    fireEvent.change(screen.getByLabelText("Trading name (optional)"), { target: { value: "Little Steps" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(1));
    expect(h.saveBusinessDetails).toHaveBeenCalledWith({
      businessType: "sole_trader", tradingName: "Little Steps", businessAddress: "", companyName: "", companyNumber: "",
      registeredOffice: "", partnershipName: "", vatMode: "none", vatNumber: "", vatRate: "",
    });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("the address row saves the address (blank keeps her verification address)", async () => {
    show();
    fireEvent.click(row("Address on invoices"));
    expect(screen.getByLabelText("Address")).toHaveValue("");
    expect(screen.getByText("Leave this blank to use the address from your verification.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "9 Home Lane\nLondon" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.saveBusinessDetails).toHaveBeenCalledWith(expect.objectContaining({ businessAddress: "9 Home Lane\nLondon" })));
  });

  it("the schema refuses first: plain messages by the fields, and the action is never called (A3)", async () => {
    show();
    fireEvent.click(row("Business type"));
    fireEvent.click(screen.getByRole("radio", { name: "Limited company" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter the company's registered name")).toBeInTheDocument();
    expect(screen.getByText("Enter the company number — 8 characters, like 12345678 or SC123456")).toBeInTheDocument();
    expect(screen.getByText("Enter the registered office address")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Please check the details marked below.");
    expect(h.saveBusinessDetails).not.toHaveBeenCalled();
  });

  it("VAT registered with no number is refused in the form (A3)", async () => {
    show();
    fireEvent.click(row("VAT"));
    fireEvent.click(screen.getByRole("radio", { name: "VAT registered" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter a UK VAT number, like GB 123 4567 89")).toBeInTheDocument();
    expect(h.saveBusinessDetails).not.toHaveBeenCalled();
  });

  it("the action's refusal shows its plain message; nothing refreshes", async () => {
    h.saveBusinessDetails.mockResolvedValueOnce({ ok: false, error: "busy", message: "Your details are being saved elsewhere — try again in a moment." });
    show();
    fireEvent.click(row("Trading name"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your details are being saved elsewhere — try again in a moment.");
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("a double submit calls the action once", async () => {
    let finish: (v: unknown) => void = () => undefined;
    h.saveBusinessDetails.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
    show();
    fireEvent.click(row("Trading name"));
    const form = screen.getByRole("button", { name: "Save" }).closest("form") as HTMLFormElement;
    fireEvent.submit(form);
    fireEvent.submit(form);
    await waitFor(() => expect(h.saveBusinessDetails).toHaveBeenCalledTimes(1));
    finish({ ok: true, changed: true });
    await waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(1));
    expect(h.saveBusinessDetails).toHaveBeenCalledTimes(1);
  });
});

describe("BusinessSettingsForm — bank details", () => {
  it("adds them: the fields go to the action as typed, then a refresh", async () => {
    show();
    fireEvent.click(row("Bank details"));
    fireEvent.change(screen.getByLabelText("Name on the account"), { target: { value: "Sophie Taylor" } });
    fireEvent.change(screen.getByLabelText("Sort code"), { target: { value: "11-22-33" } });
    fireEvent.change(screen.getByLabelText("Account number"), { target: { value: "87654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(1));
    expect(h.savePaymentDetails).toHaveBeenCalledWith({ accountName: "Sophie Taylor", sortCode: "11-22-33", accountNumber: "87654321" });
  });

  it("a short sort code is refused in the form; the action is never called", async () => {
    show();
    fireEvent.click(row("Bank details"));
    fireEvent.change(screen.getByLabelText("Name on the account"), { target: { value: "Sophie Taylor" } });
    fireEvent.change(screen.getByLabelText("Sort code"), { target: { value: "11223" } });
    fireEvent.change(screen.getByLabelText("Account number"), { target: { value: "87654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter a 6-digit sort code")).toBeInTheDocument();
    expect(h.savePaymentDetails).not.toHaveBeenCalled();
  });

  it("the action's refusal shows its message", async () => {
    h.savePaymentDetails.mockResolvedValueOnce({ ok: false, error: "nanny_inactive", message: "Your account isn't active, so this can't be saved. Please contact us." });
    show(DEFAULTS, BANK);
    fireEvent.click(row("Bank details"));
    fireEvent.change(screen.getByLabelText("Name on the account"), { target: { value: "Sophie Taylor" } });
    fireEvent.change(screen.getByLabelText("Sort code"), { target: { value: "112233" } });
    fireEvent.change(screen.getByLabelText("Account number"), { target: { value: "87654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your account isn't active");
  });
});
