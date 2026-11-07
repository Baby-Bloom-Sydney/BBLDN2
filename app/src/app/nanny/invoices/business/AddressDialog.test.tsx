/**
 * The address her invoices print (plan 06 §14.6 b3.3; brief §0a C): a text area, blank meaning "the address from my
 * verification". Shared with 06b-4's first-invoice setup, which asks for one only when none is on file (`required`).
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AddressDialog } from "./AddressDialog";
import type { SaveOutcome } from "./business-view";

afterEach(cleanup);

function show(props: Partial<Parameters<typeof AddressDialog>[0]> = {}, outcome: SaveOutcome = { success: true }) {
  const onSave = vi.fn(async () => outcome);
  render(
    <AddressDialog
      open
      onOpenChange={vi.fn()}
      title="Address on your invoices"
      description="Leave this blank to use the address from your verification."
      initial=""
      onSave={onSave}
      {...props}
    />,
  );
  return { onSave };
}

describe("AddressDialog", () => {
  it("a text area, opened on what she entered, with the description", () => {
    show({ initial: "9 Home Lane\nLondon" });
    expect(screen.getByRole("dialog", { name: "Address on your invoices" })).toBeInTheDocument();
    const box = screen.getByLabelText("Address");
    expect(box.tagName).toBe("TEXTAREA");
    expect(box).toHaveValue("9 Home Lane\nLondon");
    expect(screen.getByText("Leave this blank to use the address from your verification.")).toBeInTheDocument();
  });

  it("saves what she typed, blank included", async () => {
    const { onSave } = show({ initial: "9 Home Lane" });
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith(""));
  });

  it("required (06b-4's setup): Save waits for something typed", () => {
    show({ required: true });
    expect(screen.getByRole("button", { name: "Save" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("Address"), { target: { value: "9 Home Lane" } });
    expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
  });

  it("a refusal shows the plain message under the box", async () => {
    show({}, { success: false, error: "Please check the details marked below.", fields: { businessAddress: "Use at most 6 lines" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Use at most 6 lines")).toBeInTheDocument();
    expect(screen.getByLabelText("Address")).toHaveAttribute("aria-invalid", "true");
  });
});
