/**
 * Her bank details for invoices (plan 06 §14.6 b3.3; brief §0a 2, §0.2; plan §9 surface 2): the name on the account,
 * the sort code and the account number. The fields never start with her saved numbers (the browser never has them),
 * every field has `autocomplete="off"`, and the form is cleared once saved — and when closed without saving. A change
 * says we'll email her. `PaymentDetailsFields` is shared with 06b-4's first-invoice setup.
 *
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useState } from "react";
import { PaymentDetailsDialog } from "./PaymentDetailsDialog";
import type { BankView, SaveOutcome } from "./business-view";

afterEach(cleanup);

const BANK: BankView = { accountName: "Sophie Taylor", sortCodeLast2: "33", accountLast4: "4321" };

/** Opens on mount; "Reopen" opens it again on the same instance (the form keys a fresh one per open). */
function Harness({ bank, onSave }: { bank: BankView | null; onSave: (v: unknown) => Promise<SaveOutcome> }) {
  const [open, setOpen] = useState(true);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)}>Reopen</button>
      <PaymentDetailsDialog open={open} onOpenChange={setOpen} bank={bank} onSave={onSave} />
    </>
  );
}

function show(bank: BankView | null, outcome: SaveOutcome = { success: true }) {
  const onSave = vi.fn(async () => outcome);
  render(<Harness bank={bank} onSave={onSave} />);
  return { onSave };
}

const fill = () => {
  fireEvent.change(screen.getByLabelText("Name on the account"), { target: { value: "Sophie Taylor" } });
  fireEvent.change(screen.getByLabelText("Sort code"), { target: { value: "11-22-33" } });
  fireEvent.change(screen.getByLabelText("Account number"), { target: { value: "87654321" } });
};

describe("PaymentDetailsDialog", () => {
  it("first time: 'Add your bank details'; three empty fields with autocomplete off", () => {
    show(null);
    expect(screen.getByRole("dialog", { name: "Add your bank details" })).toBeInTheDocument();
    for (const label of ["Name on the account", "Sort code", "Account number"]) {
      const field = screen.getByLabelText(label);
      expect(field).toHaveValue("");
      expect(field).toHaveAttribute("autocomplete", "off");
      // password managers that ignore autocomplete="off" (security review L3)
      expect(field).toHaveAttribute("data-1p-ignore", "true");
      expect(field).toHaveAttribute("data-lpignore", "true");
      expect(field).toHaveAttribute("data-form-type", "other");
    }
    expect(screen.getByLabelText("Sort code")).toHaveAttribute("inputmode", "numeric");
    // the schema strips spaces and hyphens: a cap here would cut a pasted "12 - 34 - 56" (TS review L)
    expect(screen.getByLabelText("Sort code")).not.toHaveAttribute("maxlength");
    expect(screen.getByLabelText("Account number")).not.toHaveAttribute("maxlength");
    expect(screen.getByLabelText("Account number")).toHaveAttribute("inputmode", "numeric");
    expect(screen.queryByText(/We'll email you/)).toBeNull();
  });

  it("a change: 'Change your bank details', empty fields (never her saved numbers), and the email note", () => {
    show(BANK);
    expect(screen.getByRole("dialog", { name: "Change your bank details" })).toBeInTheDocument();
    expect(screen.getByLabelText("Name on the account")).toHaveValue("");
    expect(screen.getByText("These replace your current details on future invoices. We'll email you to confirm the change.")).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/4321|••/);
  });

  it("saves what she typed, then clears the form", async () => {
    const { onSave } = show(null);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ accountName: "Sophie Taylor", sortCode: "11-22-33", accountNumber: "87654321" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(screen.getByLabelText("Sort code")).toHaveValue("");
    expect(screen.getByLabelText("Account number")).toHaveValue("");
  });

  it("closed without saving: cleared too", async () => {
    show(null);
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Reopen" }));
    expect(screen.getByLabelText("Account number")).toHaveValue("");
  });

  it("a refusal keeps what she typed, marks the field and shows the plain message", async () => {
    show(null, { success: false, error: "Please check the details marked below.", fields: { sortCode: "Enter a 6-digit sort code" } });
    fill();
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter a 6-digit sort code")).toBeInTheDocument();
    expect(screen.getByLabelText("Sort code")).toHaveAttribute("aria-invalid", "true");
    expect(screen.getByLabelText("Account number")).toHaveValue("87654321");
  });
});
