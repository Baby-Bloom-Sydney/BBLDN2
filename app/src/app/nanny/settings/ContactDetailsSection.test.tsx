/**
 * Settings › Account › Contact details (ledger B06 §9.1 R1, R4, R6): email (read-only) and mobile as rows with one
 * Edit; the mobile in place in edit mode; required, a UK mobile (today's rule); no explanatory text.
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const { updateNannyAccountSettings, refresh } = vi.hoisted(() => ({ updateNannyAccountSettings: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/actions/nanny-account-settings", () => ({ updateNannyAccountSettings }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { ContactDetailsSection } from "./ContactDetailsSection";

const VERSION = "2027-02-15T10:00:00.333333+00:00";
const CONTACT = { email: "sophie@example.test", mobile_number: "+447700900123", updated_at: VERSION };

beforeEach(() => {
  updateNannyAccountSettings.mockReset().mockResolvedValue({ success: true, error: null });
  refresh.mockReset();
});
afterEach(cleanup);

const row = (label: string) => screen.getByText(label, { selector: "div" }).parentElement as HTMLElement;
const save = async () => { await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); }); };

describe("Contact details", () => {
  it("view: the email (verified) and the mobile; one Edit; no explanatory text", () => {
    render(<ContactDetailsSection title="Contact details" contact={CONTACT} />);
    expect(screen.getByRole("heading", { level: 2, name: "Contact details" })).toBeInTheDocument();
    expect(within(row("Email address")).getByText("sophie@example.test")).toBeInTheDocument();
    expect(within(row("Mobile number")).getByText("+44 (0) 7700 900 123")).toBeInTheDocument();
    expect(screen.queryByText(/rely on this/)).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(1);
  });

  it("edit: the mobile in place, the email stays read-only; a change is saved with its version", async () => {
    render(<ContactDetailsSection title="Contact details" contact={CONTACT} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit contact details" }));
    expect(screen.getByLabelText("Mobile number")).toHaveFocus();
    expect(screen.queryByLabelText("Email address")).toBeNull();
    fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "07700 900456" } });
    await save();
    expect(updateNannyAccountSettings).toHaveBeenCalledWith({ mobile_number: "07700 900456", expected_updated_at: VERSION });
    expect(screen.getByRole("button", { name: "Edit contact details" })).toHaveFocus();
  });

  it("required and a UK mobile; refused under the field, nothing sent", async () => {
    render(<ContactDetailsSection title="Contact details" contact={CONTACT} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit contact details" }));
    fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "" } });
    await save();
    expect(screen.getByText("Mobile number is required.")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "0207 946 0000" } });
    await save();
    expect(screen.getByText("Enter a valid UK mobile number.")).toBeInTheDocument();
    expect(updateNannyAccountSettings).not.toHaveBeenCalled();
  });

  it("the mobile is marked required; its error clears as she types (review round 1)", async () => {
    render(<ContactDetailsSection title="Contact details" contact={CONTACT} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit contact details" }));
    expect(screen.getByLabelText("Mobile number")).toHaveAttribute("aria-required", "true");
    fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "" } });
    await save();
    expect(screen.getByLabelText("Mobile number")).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "07" } });
    expect(screen.getByLabelText("Mobile number")).not.toHaveAttribute("aria-invalid");
  });

  it("the same number typed another way is no change", async () => {
    render(<ContactDetailsSection title="Contact details" contact={CONTACT} />);
    fireEvent.click(screen.getByRole("button", { name: "Edit contact details" }));
    fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value: "07700 900123" } });
    await save();
    expect(updateNannyAccountSettings).not.toHaveBeenCalled();
  });
});
