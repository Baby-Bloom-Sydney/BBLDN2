/**
 * The business type dialog (plan 06 §14.6 b3.3; brief §0a B; BAI 2026-11-07): native radios for sole trader (the
 * default), limited company and partnership. A limited company asks for its name, number and registered office — and
 * says the registered office is the one address her invoices print, so no second address is asked. A partnership
 * asks for its name. It saves only the fields it owns; refusals show the schema's plain message by the field.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BusinessTypeDialog } from "./BusinessTypeDialog";
import type { BusinessView, SaveOutcome } from "./business-view";

afterEach(cleanup);

const SOLE: BusinessView = {
  businessType: "sole_trader", name: "Sophie Taylor", tradingName: null, address: "1 Upper Street\nLondon\nN1 0AA",
  addressSource: "verification", companyName: null, companyNumber: null, registeredOffice: null, partnershipName: null,
  vatMode: "none", vatNumber: null, vatRateBp: null,
};

function show(view: BusinessView = SOLE, outcome: SaveOutcome = { success: true }) {
  const onSave = vi.fn(async () => outcome);
  const onOpenChange = vi.fn();
  render(<BusinessTypeDialog open onOpenChange={onOpenChange} view={view} onSave={onSave} />);
  return { onSave, onOpenChange };
}

const radio = (name: string) => screen.getByRole("radio", { name: new RegExp(`^${name}`) }) as HTMLInputElement;

describe("BusinessTypeDialog", () => {
  it("three native radios, sole trader checked by default; no company fields", () => {
    show();
    expect(screen.getByRole("dialog", { name: "Business type" })).toBeInTheDocument();
    expect(radio("Sole trader").checked).toBe(true);
    expect(radio("Limited company").checked).toBe(false);
    expect(radio("Partnership").checked).toBe(false);
    for (const r of [radio("Sole trader"), radio("Limited company"), radio("Partnership")]) expect(r.type).toBe("radio");
    expect(screen.queryByLabelText("Company name")).toBeNull();
    expect(document.querySelector('[role="radiogroup"]')).toBeNull();
  });

  it("limited company: its name, number and registered office (a text area), and the one-address line", () => {
    show();
    fireEvent.click(radio("Limited company"));
    expect(screen.getByLabelText("Company name")).toBeInTheDocument();
    expect(screen.getByLabelText("Company number")).toBeInTheDocument();
    expect(screen.getByLabelText("Registered office").tagName).toBe("TEXTAREA");
    expect(screen.getByText("Your invoices show the registered office as your address, so you don't need to add another one.")).toBeInTheDocument();
    expect(screen.queryByLabelText("Partnership name")).toBeNull();
  });

  it("saves the limited company's fields as typed (the action normalises them)", async () => {
    const { onSave } = show();
    fireEvent.click(radio("Limited company"));
    fireEvent.change(screen.getByLabelText("Company name"), { target: { value: "Taylor Childcare Ltd" } });
    fireEvent.change(screen.getByLabelText("Company number"), { target: { value: "sc 123 456" } });
    fireEvent.change(screen.getByLabelText("Registered office"), { target: { value: "2 Office Row\nLondon\nEC1A 1AA" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledTimes(1));
    expect(onSave).toHaveBeenCalledWith({
      businessType: "limited_company", companyName: "Taylor Childcare Ltd", companyNumber: "sc 123 456",
      registeredOffice: "2 Office Row\nLondon\nEC1A 1AA", partnershipName: "",
    });
  });

  it("partnership: asks for its name only", async () => {
    const { onSave } = show();
    fireEvent.click(radio("Partnership"));
    expect(screen.queryByLabelText("Company name")).toBeNull();
    fireEvent.change(screen.getByLabelText("Partnership name"), { target: { value: "Taylor & Hart" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(expect.objectContaining({ businessType: "partnership", partnershipName: "Taylor & Hart" })));
  });

  it("opens on what she has saved", () => {
    show({ ...SOLE, businessType: "limited_company", companyName: "Taylor Childcare Ltd", companyNumber: "SC123456", registeredOffice: "2 Office Row" });
    expect(radio("Limited company").checked).toBe(true);
    expect(screen.getByLabelText("Company name")).toHaveValue("Taylor Childcare Ltd");
    expect(screen.getByLabelText("Company number")).toHaveValue("SC123456");
    expect(screen.getByLabelText("Registered office")).toHaveValue("2 Office Row");
  });

  it("a refusal: the plain message by each field, the field marked invalid, the dialog stays open", async () => {
    const { onOpenChange } = show(SOLE, {
      success: false,
      error: "Please check the details marked below.",
      fields: { companyName: "Enter the company's registered name", companyNumber: "Enter the company number — 8 characters, like 12345678 or SC123456" },
    });
    fireEvent.click(radio("Limited company"));
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter the company's registered name")).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Please check the details marked below.");
    const name = screen.getByLabelText("Company name");
    expect(name).toHaveAttribute("aria-invalid", "true");
    expect(name.getAttribute("aria-describedby")).toContain(screen.getByText("Enter the company's registered name").id);
    expect(screen.getByLabelText("Registered office")).not.toHaveAttribute("aria-invalid", "true");
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    // focus goes to the first refused field, so its message is read out (React review L2)
    await waitFor(() => expect(document.activeElement).toBe(name));
  });

  it("the registered office box is 16 px on a phone, so iOS doesn't zoom the dialog (React review M5)", () => {
    show();
    fireEvent.click(radio("Limited company"));
    expect(screen.getByLabelText("Registered office")).toHaveClass("text-base", "md:text-sm");
  });

  it("saved → closes", async () => {
    const { onOpenChange } = show();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onOpenChange).toHaveBeenCalledWith(false));
  });
});
