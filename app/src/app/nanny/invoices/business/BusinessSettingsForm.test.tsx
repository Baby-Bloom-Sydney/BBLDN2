/**
 * The Settings Business page (ledger B06 §9.1 R1–R5; brief 06 §0b): plain rows with one Edit button for the whole
 * page; in edit mode every field in place and one Save through `saveBusinessSettings`.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07; rewritten for edit mode by BB-wave1-041126/06b3-rework, 2026-11-09.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const { saveBusinessSettings, refresh, push } = vi.hoisted(() => ({ saveBusinessSettings: vi.fn(), refresh: vi.fn(), push: vi.fn() }));
vi.mock("@/lib/invoices/actions/save-business-settings", () => ({ saveBusinessSettings }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push }) }));

import { BusinessSettingsForm } from "./BusinessSettingsForm";
import type { BankView, BusinessView, Versions } from "./business-view";

const SOLE: BusinessView = {
  businessType: "sole_trader", name: "Sophie Taylor", tradingName: null, companyName: null, companyNumber: null,
  registeredOffice: null, partnershipName: null, vatMode: "none", vatNumber: null,
};
const LTD: BusinessView = {
  ...SOLE, businessType: "limited_company", tradingName: "Little Steps", companyName: "Taylor Childcare Ltd",
  companyNumber: "12345678", registeredOffice: "2 Office Row\nLondon EC1A 1AA", vatMode: "added", vatNumber: "GB123456789",
};
const HOME = { line1: "1 Upper Street", line2: "", town: "London", postcode: "N1 0AA" };
const BANK: BankView = { accountName: "Sophie Taylor", sortCode: "112233", accountNumber: "87654321" };
const VERSIONS: Versions = { business: null, bank: null, home: "2027-02-15T10:00:00.333333+00:00" };

beforeEach(() => {
  saveBusinessSettings.mockReset().mockResolvedValue({ ok: true });
  refresh.mockReset();
  push.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [] })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function show(business: BusinessView = SOLE, bank: BankView | null = null, home: typeof HOME | null = HOME) {
  return render(<BusinessSettingsForm business={business} bank={bank} home={home} versions={VERSIONS} />);
}
const row = (label: string) => screen.getByText(label, { selector: "div" }).parentElement as HTMLElement;
const edit = () => fireEvent.click(screen.getByRole("button", { name: "Edit business" }));
const save = async () => { await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); }); };

describe("view (R5)", () => {
  it("zero setup: plain rows, one Edit, no notes", () => {
    show();
    expect(screen.getByRole("heading", { level: 2, name: "Business" })).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    expect(within(row("Business type")).getByText("Sole trader")).toBeInTheDocument();
    expect(within(row("Trading name")).getByText("None")).toBeInTheDocument();
    expect(within(row("Address")).getByText("1 Upper Street")).toBeInTheDocument();
    expect(within(row("Address")).getByText("N1 0AA")).toBeInTheDocument();
    expect(within(row("VAT registered")).getByText("No")).toBeInTheDocument();
    expect(screen.getByText("Not added")).toBeInTheDocument();
    for (const gone of [/On your invoices/, /How you appear/, /future invoices/, /your name\)/, /verification/, /last digits/]) {
      expect(screen.queryByText(gone)).toBeNull();
    }
  });

  it("a limited company with VAT added and bank details: its fields, no address row, full bank details", () => {
    show(LTD, BANK);
    expect(within(row("Company name")).getByText("Taylor Childcare Ltd")).toBeInTheDocument();
    expect(within(row("Company number")).getByText("12345678")).toBeInTheDocument();
    expect(within(row("Registered office")).getByText(/2 Office Row/)).toBeInTheDocument();
    expect(within(row("Trading name")).getByText("Little Steps")).toBeInTheDocument();
    expect(screen.queryByText("Address", { selector: "div" })).toBeNull();
    expect(within(row("VAT registered")).getByText("Yes")).toBeInTheDocument();
    expect(within(row("VAT number")).getByText("GB 123 4567 89")).toBeInTheDocument();
    expect(within(row("VAT charged")).getByText("Added to rates")).toBeInTheDocument();
    expect(within(row("Name on account")).getByText("Sophie Taylor")).toBeInTheDocument();
    expect(within(row("Sort code")).getByText("11-22-33")).toBeInTheDocument();
    expect(within(row("Account number")).getByText("87654321")).toBeInTheDocument();
  });

  it("a partnership shows its name; no address on file reads Not added", () => {
    show({ ...SOLE, businessType: "partnership", partnershipName: "Taylor & Shah" }, null, null);
    expect(within(row("Partnership name")).getByText("Taylor & Shah")).toBeInTheDocument();
    expect(within(row("Address")).getByText("Not added")).toBeInTheDocument();
  });
});

describe("edit (R1, R3, R5)", () => {
  it("every field in place, pre-filled; Trading name plain; VAT Yes shows the number and how it's charged, Included first with a grey (Recommended); no rate", () => {
    show();
    edit();
    expect(screen.getByRole("radio", { name: "Sole trader" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Sole trader" })).toHaveFocus();
    expect(screen.getByLabelText("Trading name")).toHaveValue("");
    expect(screen.queryByText(/optional/i)).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    expect(screen.getByLabelText("VAT number")).toBeInTheDocument();
    const included = screen.getByRole("radio", { name: "Included in rates (Recommended)" });
    expect(included).toBeChecked();
    expect(screen.getByText("(Recommended)")).toHaveClass("text-slate-500");
    expect(screen.getByRole("radio", { name: "Added to rates" })).not.toBeChecked();
    expect(screen.queryByLabelText(/rate \(%\)/i)).toBeNull();
    expect(screen.getByLabelText("Name on account")).toHaveValue("Sophie Taylor");
    expect(screen.getByLabelText("Sort code")).toHaveValue("");
  });

  it("a limited company reveals its three fields and drops the address; Name on account follows the company name", () => {
    show();
    edit();
    fireEvent.click(screen.getByRole("radio", { name: "Limited company" }));
    expect(screen.queryByLabelText(/^Address/)).toBeNull();
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Taylor Ltd" } });
    expect(screen.getByLabelText("Company number")).toBeInTheDocument();
    expect(screen.getByLabelText("Registered office")).toBeInTheDocument();
    expect(screen.getByLabelText("Name on account")).toHaveValue("Taylor Ltd");
  });

  it("a partnership: its name; a company's number and office typed; VAT added; her own Name on account and account number", async () => {
    show();
    edit();
    fireEvent.click(screen.getByRole("radio", { name: "Partnership" }));
    fireEvent.change(screen.getByLabelText("Partnership name"), { target: { value: "Taylor & Shah" } });
    expect(screen.getByLabelText("Name on account")).toHaveValue("Taylor & Shah");
    fireEvent.click(screen.getByRole("radio", { name: "Limited company" }));
    fireEvent.change(screen.getByLabelText("Company number"), { target: { value: "12345678" } });
    fireEvent.change(screen.getByLabelText("Registered office"), { target: { value: "2 Office Row" } });
    fireEvent.click(screen.getByRole("radio", { name: "Sole trader" }));
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    fireEvent.click(screen.getByRole("radio", { name: "Added to rates" }));
    fireEvent.change(screen.getByLabelText("VAT number"), { target: { value: "GB 123 4567 89" } });
    fireEvent.click(screen.getByRole("radio", { name: "No" }));
    expect(screen.queryByLabelText("VAT number")).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    expect(screen.getByLabelText("VAT number")).toHaveValue("GB 123 4567 89");
    fireEvent.change(screen.getByLabelText("Name on account"), { target: { value: "S Taylor" } });
    fireEvent.change(screen.getByLabelText("Sort code"), { target: { value: "11-22-33" } });
    fireEvent.change(screen.getByLabelText("Account number"), { target: { value: "87654321" } });
    await save();
    expect(saveBusinessSettings).toHaveBeenCalledWith({
      business: {
        businessType: "sole_trader", tradingName: "", companyName: "", companyNumber: "", registeredOffice: "", partnershipName: "",
        vatMode: "added", vatNumber: "GB 123 4567 89", expectedUpdatedAt: null,
      },
      bank: { accountName: "S Taylor", sortCode: "11-22-33", accountNumber: "87654321", expectedUpdatedAt: null },
    });
  });

  it("saved bank details are pre-filled in full", () => {
    show(SOLE, BANK);
    edit();
    expect(screen.getByLabelText("Name on account")).toHaveValue("Sophie Taylor");
    expect(screen.getByLabelText("Sort code")).toHaveValue("11-22-33");
    expect(screen.getByLabelText("Account number")).toHaveValue("87654321");
  });
});

describe("Save (R1, R4, R5)", () => {
  it("checks the whole page first: a limited company without its fields is refused by field; nothing sent; focus on the first", async () => {
    show();
    edit();
    fireEvent.click(screen.getByRole("radio", { name: "Limited company" }));
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("Please check the details marked below.");
    expect(screen.getByText("Enter the company's registered name")).toBeInTheDocument();
    expect(screen.getByLabelText("Company name")).toHaveFocus();
    expect(saveBusinessSettings).not.toHaveBeenCalled();
  });

  it("the alert goes once every marked field is filled (coordinator, round 2: walk shot 2)", async () => {
    show();
    edit();
    fireEvent.click(screen.getByRole("radio", { name: "Limited company" }));
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("Please check the details marked below.");
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Taylor Childcare Ltd" } });
    fireEvent.change(screen.getByLabelText("Company number"), { target: { value: "12345678" } });
    expect(screen.getByRole("alert")).toHaveTextContent("Please check the details marked below.");
    fireEvent.change(screen.getByLabelText("Registered office"), { target: { value: "2 Office Row" } });
    fireEvent.change(screen.getByLabelText("VAT number"), { target: { value: "GB 123 4567 89" } });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(screen.queryByText("Enter the company's registered name")).toBeNull();
  });

  it("an address is required for a sole trader", async () => {
    show(SOLE, null, null);
    edit();
    await save();
    expect(screen.getByText("Choose your address")).toBeInTheDocument();
    expect(saveBusinessSettings).not.toHaveBeenCalled();
  });

  it("VAT registered needs its number", async () => {
    show();
    edit();
    fireEvent.click(screen.getByRole("radio", { name: "Yes" }));
    await save();
    expect(screen.getByText("Enter a UK VAT number, like GB 123 4567 89")).toBeInTheDocument();
  });

  it("bank details once a number is typed: all three", async () => {
    show();
    edit();
    fireEvent.change(screen.getByLabelText("Sort code"), { target: { value: "11-22-33" } });
    await save();
    expect(screen.getByText("Enter an 8-digit account number")).toBeInTheDocument();
  });

  it("sends only what changed, with the versions; then back to the rows, refreshed, focus on Edit", async () => {
    show();
    edit();
    fireEvent.change(screen.getByLabelText("Trading name"), { target: { value: "Little Steps" } });
    await save();
    expect(saveBusinessSettings).toHaveBeenCalledWith({
      business: {
        businessType: "sole_trader", tradingName: "Little Steps", companyName: "", companyNumber: "", registeredOffice: "",
        partnershipName: "", vatMode: "none", vatNumber: "", expectedUpdatedAt: null,
      },
    });
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Edit business" })).toHaveFocus();
  });

  it("nothing changed: back to the rows without a call", async () => {
    show();
    edit();
    await save();
    expect(saveBusinessSettings).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Edit business" })).toBeInTheDocument();
  });

  it("the server's refusal by field marks the field; stale shows the latest with its message", async () => {
    saveBusinessSettings.mockResolvedValueOnce({ ok: false, error: "invalid", message: "Please check the details marked below.", fields: { tradingName: "Enter your own name or business name." } });
    show();
    edit();
    fireEvent.change(screen.getByLabelText("Trading name"), { target: { value: "x" } });
    await save();
    expect(screen.getByText("Enter your own name or business name.")).toBeInTheDocument();
    saveBusinessSettings.mockResolvedValueOnce({ ok: false, error: "stale", message: "These details were changed elsewhere. The latest are now showing." });
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("These details were changed elsewhere. The latest are now showing.");
    expect(screen.getByRole("button", { name: "Edit business" })).toBeInTheDocument();
  });

  it("a refusal after part of the page was saved: the retry sends only the rest, with the new version, never 'stale' for her own change", async () => {
    saveBusinessSettings.mockResolvedValueOnce({
      ok: false, error: "busy", message: "Your details are being saved elsewhere — try again in a moment.", saved: { business: "2027-02-15T11:00:00.1+00:00" },
    });
    show();
    edit();
    fireEvent.change(screen.getByLabelText("Trading name"), { target: { value: "Little Steps" } });
    fireEvent.change(screen.getByLabelText("Sort code"), { target: { value: "11-22-33" } });
    fireEvent.change(screen.getByLabelText("Account number"), { target: { value: "87654321" } });
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("being saved elsewhere");
    await save();
    expect(saveBusinessSettings).toHaveBeenLastCalledWith({
      bank: { accountName: "Sophie Taylor", sortCode: "11-22-33", accountNumber: "87654321", expectedUpdatedAt: null },
    });
  });

  it("a refusal naming no field on the page shows its message, not 'marked below' with nothing marked", async () => {
    saveBusinessSettings.mockResolvedValueOnce({ ok: false, error: "invalid", message: "Please check the details marked below.", fields: { vatRate: "Enter a VAT rate" } });
    show();
    edit();
    fireEvent.change(screen.getByLabelText("Trading name"), { target: { value: "x" } });
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("Enter a VAT rate");
  });

  it("while saving, the fields are locked; an error clears as she fixes its field; required fields are marked", async () => {
    let resolve: (v: unknown) => void = () => undefined;
    saveBusinessSettings.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
    show();
    edit();
    fireEvent.change(screen.getByLabelText("Trading name"), { target: { value: "x" } });
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    expect(screen.getByLabelText("Trading name")).toBeDisabled();
    await act(async () => { resolve({ ok: false, error: "invalid", message: "x", fields: { tradingName: "Enter your own name or business name." } }); });
    expect(screen.getByLabelText("Trading name")).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(screen.getByLabelText("Trading name"), { target: { value: "y" } });
    expect(screen.getByLabelText("Trading name")).not.toHaveAttribute("aria-invalid");
    fireEvent.click(screen.getByRole("radio", { name: "Limited company" }));
    for (const label of ["Company name", "Company number", "Registered office"]) expect(screen.getByLabelText(label)).toHaveAttribute("aria-required", "true");
    expect(screen.getByLabelText("Trading name")).not.toHaveAttribute("aria-required");
  });

  it("any other refusal: its message, still editing", async () => {
    saveBusinessSettings.mockResolvedValueOnce({ ok: false, error: "nanny_inactive", message: "Your account isn't active, so this can't be saved. Please contact us." });
    show();
    edit();
    fireEvent.change(screen.getByLabelText("Trading name"), { target: { value: "x" } });
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("Your account isn't active");
    expect(screen.getByLabelText("Trading name")).toHaveValue("x");
  });

  it("Cancel discards what she typed", () => {
    show();
    edit();
    fireEvent.change(screen.getByLabelText("Trading name"), { target: { value: "x" } });
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(within(row("Trading name")).getByText("None")).toBeInTheDocument();
    edit();
    expect(screen.getByLabelText("Trading name")).toHaveValue("");
  });
});
