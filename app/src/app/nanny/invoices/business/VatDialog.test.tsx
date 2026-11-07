/**
 * The VAT dialog (plan 06 §14.6 b3.3; brief §0a B): not registered by default. Registered asks for the VAT number
 * (required), "VAT included in my rates" (the default) or "VAT added on top", and the rate — 20% unless she changes
 * it. Native radios. Not registered saves no number or rate. BB-wave1-041126/06b3-build, 2026-11-07.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { VatDialog } from "./VatDialog";
import type { BusinessView, SaveOutcome } from "./business-view";

afterEach(cleanup);

const NONE: BusinessView = {
  businessType: "sole_trader", name: "Sophie Taylor", tradingName: null, address: "1 Upper Street", addressSource: "verification",
  companyName: null, companyNumber: null, registeredOffice: null, partnershipName: null, vatMode: "none", vatNumber: null, vatRateBp: null,
};

function show(view: BusinessView = NONE, outcome: SaveOutcome = { success: true }) {
  const onSave = vi.fn(async () => outcome);
  render(<VatDialog open onOpenChange={vi.fn()} view={view} onSave={onSave} />);
  return { onSave };
}

const radio = (name: string) => screen.getByRole("radio", { name }) as HTMLInputElement;

describe("VatDialog", () => {
  it("not registered by default; nothing else asked", () => {
    show();
    expect(screen.getByRole("dialog", { name: "VAT" })).toBeInTheDocument();
    expect(radio("Not VAT registered").checked).toBe(true);
    expect(radio("VAT registered").checked).toBe(false);
    expect(screen.queryByLabelText("VAT number")).toBeNull();
  });

  it("registered: the number, 'included in my rates' checked by default, and 20% filled in", () => {
    show();
    fireEvent.click(radio("VAT registered"));
    expect(screen.getByLabelText("VAT number")).toHaveValue("");
    expect(radio("VAT included in my rates").checked).toBe(true);
    expect(radio("VAT added on top").checked).toBe(false);
    expect(screen.getByLabelText("VAT rate (%)")).toHaveValue("20");
  });

  it("saves registered, added on top, at the rate she typed", async () => {
    const { onSave } = show();
    fireEvent.click(radio("VAT registered"));
    fireEvent.change(screen.getByLabelText("VAT number"), { target: { value: "GB 123 4567 89" } });
    fireEvent.click(radio("VAT added on top"));
    fireEvent.change(screen.getByLabelText("VAT rate (%)"), { target: { value: "17.5" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ vatMode: "added", vatNumber: "GB 123 4567 89", vatRate: "17.5" }));
  });

  it("not registered saves no number or rate", async () => {
    const { onSave } = show({ ...NONE, vatMode: "included", vatNumber: "GB123456789", vatRateBp: 2000 });
    expect(radio("VAT registered").checked).toBe(true);
    expect(screen.getByLabelText("VAT number")).toHaveValue("GB123456789");
    fireEvent.click(radio("Not VAT registered"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ vatMode: "none", vatNumber: "", vatRate: "" }));
  });

  it("opens on her saved mode and rate", () => {
    show({ ...NONE, vatMode: "added", vatNumber: "GB123456789", vatRateBp: 500 });
    expect(radio("VAT added on top").checked).toBe(true);
    expect(screen.getByLabelText("VAT rate (%)")).toHaveValue("5");
  });

  it("a refused number shows the plain message by the field", async () => {
    show(NONE, { success: false, error: "Please check the details marked below.", fields: { vatNumber: "Enter a UK VAT number, like GB 123 4567 89" } });
    fireEvent.click(radio("VAT registered"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter a UK VAT number, like GB 123 4567 89")).toBeInTheDocument();
    expect(screen.getByLabelText("VAT number")).toHaveAttribute("aria-invalid", "true");
  });
});
