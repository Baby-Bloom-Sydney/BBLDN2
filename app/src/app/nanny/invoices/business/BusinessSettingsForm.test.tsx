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
/** An element whose whole text (its children's included) is exactly `text`: the bank line nests its masks. */
const wholeText = (text: string) => (_: string, el: Element | null) => el?.tagName === "SPAN" && el.textContent === text;
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
    expect(within(row("Bank details")).getByText(wholeText("Sophie Taylor · sort code ••-••-33, account ending 4321"))).toBeInTheDocument();
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
    cleanup();
    show(DEFAULTS, BANK);
    expect(screen.getByText(wholeText("Sophie Taylor · sort code ••-••-33, account ending 4321"))).toHaveClass("whitespace-normal");
    // …but never inside a mask
    expect(screen.getByText(wholeText("sort code ••-••-33,"))).toHaveClass("whitespace-nowrap");
    expect(screen.getByText("account ending 4321")).toHaveClass("whitespace-nowrap");
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

describe("BusinessSettingsForm — review round 1", () => {
  it("an action that throws (offline, a stale deploy) shows the general message; nothing refreshes (TS H1, React M2)", async () => {
    h.saveBusinessDetails.mockRejectedValueOnce(new TypeError("Failed to fetch"));
    show();
    fireEvent.click(row("Trading name"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't save that. Please try again.");
    cleanup();
    h.savePaymentDetails.mockRejectedValueOnce(new Error("Failed to find Server Action"));
    show();
    fireEvent.click(row("Bank details"));
    fireEvent.change(screen.getByLabelText("Name on the account"), { target: { value: "Sophie Taylor" } });
    fireEvent.change(screen.getByLabelText("Sort code"), { target: { value: "112233" } });
    fireEvent.change(screen.getByLabelText("Account number"), { target: { value: "87654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't save that. Please try again.");
    expect(h.refresh).not.toHaveBeenCalled();
  });

  it("while a save is in flight the dialog can't be closed, and a changed second submit is told to wait (React M1, TS M1)", async () => {
    let finish: (v: unknown) => void = () => undefined;
    h.saveBusinessDetails.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
    show();
    fireEvent.click(row("Trading name"));
    fireEvent.change(screen.getByLabelText("Trading name (optional)"), { target: { value: "Little Steps" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.saveBusinessDetails).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("dialog", { name: "Trading name" })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Trading name (optional)"), { target: { value: "Little Steps Ltd" } });
    fireEvent.submit(screen.getByRole("button", { name: "Save" }).closest("form") as HTMLFormElement);
    expect(await screen.findByText("Still saving — try again in a moment.")).toBeInTheDocument();
    expect(h.saveBusinessDetails).toHaveBeenCalledTimes(1);
    finish({ ok: true, changed: true });
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("a refused close mid-save keeps what she typed in the bank form (code review L1)", async () => {
    let finish: (v: unknown) => void = () => undefined;
    h.savePaymentDetails.mockImplementationOnce(() => new Promise((r) => { finish = r; }));
    show();
    fireEvent.click(row("Bank details"));
    fireEvent.change(screen.getByLabelText("Name on the account"), { target: { value: "Sophie Taylor" } });
    fireEvent.change(screen.getByLabelText("Sort code"), { target: { value: "112233" } });
    fireEvent.change(screen.getByLabelText("Account number"), { target: { value: "87654321" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.savePaymentDetails).toHaveBeenCalledTimes(1));
    fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
    expect(screen.getByLabelText("Account number")).toHaveValue("87654321");
    finish({ ok: false, error: "error", message: "We couldn't save that. Please try again." });
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't save that.");
    expect(screen.getByLabelText("Sort code")).toHaveValue("112233");
  });

  it("a save that never answers gives up after 30 seconds: the general message, and the dialog can close (code review L2)", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      h.saveBusinessDetails.mockImplementationOnce(() => new Promise(() => undefined));
      show();
      fireEvent.click(row("Trading name"));
      fireEvent.click(screen.getByRole("button", { name: "Save" }));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(screen.getByRole("alert")).toHaveTextContent("We couldn't save that. Please try again.");
      fireEvent.keyDown(screen.getByRole("dialog"), { key: "Escape" });
      await vi.advanceTimersByTimeAsync(1_000);
      expect(screen.queryByRole("dialog")).toBeNull();
    } finally {
      vi.useRealTimers();
    }
  });

  it("when the row that opened a dialog is gone after the refresh, focus goes to 'Business type' (React M3)", async () => {
    const { rerender } = show(LTD, BANK);
    const company = row("Company");
    company.focus();
    fireEvent.click(company);
    fireEvent.click(screen.getByRole("radio", { name: "Sole trader" }));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(h.refresh).toHaveBeenCalled());
    const soleTrader = { ...LTD, businessType: "sole_trader" as const, companyName: null, companyNumber: null, registeredOffice: null };
    rerender(<BusinessSettingsForm business={soleTrader} bank={BANK} />);
    await waitFor(() => expect(document.activeElement).toBe(row("Business type")));
    // once only: a later refresh with focus elsewhere never pulls it back (verification L3)
    (document.activeElement as HTMLElement).blur();
    rerender(<BusinessSettingsForm business={{ ...soleTrader, tradingName: "Little Steps" }} bank={BANK} />);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(document.activeElement).toBe(document.body);
  });

  it("notes that matter read at AA contrast: slate-500, not the rows' slate-400 captions (React M4)", () => {
    show(LTD, BANK);
    for (const text of ["Company no. SC123456", "Your invoices show this as your address.", "VAT no. GB 123 4567 89",
      "Printed instead of the company's name.", "Printed in full on your invoices, so families can pay you. On screen we only show the last digits."]) {
      expect(screen.getByText(text)).toHaveClass("text-slate-500");
    }
  });

  it("a screen reader hears the bank line in words, not bullets (React L3)", () => {
    show(DEFAULTS, BANK);
    expect(screen.getByText("Sophie Taylor, sort code ending 33, account ending 4321")).toHaveClass("sr-only");
    expect(screen.getByText(wholeText("Sophie Taylor · sort code ••-••-33, account ending 4321"))).toHaveAttribute("aria-hidden", "true");
  });

  it("a refusal in a field the open dialog doesn't show names it in the alert, not 'marked below' (React L2, TS L)", async () => {
    show({ ...DEFAULTS, vatMode: "added", vatNumber: "GB12", vatRateBp: 2000 });
    fireEvent.click(row("Trading name"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Enter a UK VAT number, like GB 123 4567 89");
    expect(h.saveBusinessDetails).not.toHaveBeenCalled();
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
