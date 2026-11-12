/**
 * Parent Settings › Account › Contact details: the email (read-only, verified, as today) and the mobile as rows with
 * one Edit; the mobile in place in edit mode; required and a UK mobile (today's rule); one Save with the version she
 * loaded.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const { updateParentAccountSettings, refresh } = vi.hoisted(() => ({ updateParentAccountSettings: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/actions/parent-account-settings", () => ({ updateParentAccountSettings }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { ParentContactDetailsSection, type ParentContactFields } from "./ParentContactDetailsSection";

const VERSION = "2027-02-15T10:00:00.333333+00:00";
const CONTACT: ParentContactFields = { email: "olivia@example.test", mobile_number: "+447700900123", updated_at: VERSION };
const STALE = "These details were changed elsewhere. The latest are now showing.";

beforeEach(() => {
  updateParentAccountSettings.mockReset().mockResolvedValue({ success: true, error: null });
  refresh.mockReset();
});
afterEach(cleanup);

const show = (contact: ParentContactFields = CONTACT) => render(<ParentContactDetailsSection title="Contact details" contact={contact} />);
const row = (label: string) => screen.getByText(label, { selector: "div" }).parentElement as HTMLElement;
const edit = () => fireEvent.click(screen.getByRole("button", { name: "Edit contact details" }));
const type = (value: string) => fireEvent.change(screen.getByLabelText("Mobile number"), { target: { value } });
const save = async () => { await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); }); };

describe("Contact details — view", () => {
  it("the email, verified and read-only; the mobile; one Edit, no row a button", () => {
    show();
    expect(screen.getByRole("heading", { level: 2, name: "Contact details" })).toBeInTheDocument();
    expect(within(row("Email address")).getByText("olivia@example.test")).toBeInTheDocument();
    expect(within(row("Email address").parentElement as HTMLElement).getByText("Verified")).toBeInTheDocument();
    expect(within(row("Mobile number")).getByText("+44 (0) 7700 900 123")).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toEqual([screen.getByRole("button", { name: "Edit contact details" })]);
  });

  it("no mobile on file reads Not set", () => {
    show({ ...CONTACT, mobile_number: "" });
    expect(within(row("Mobile number")).getByText("Not set")).toBeInTheDocument();
  });
});

describe("Contact details — edit", () => {
  it("the mobile in place with focus, marked required; the email stays a read-only row", () => {
    show();
    edit();
    expect(screen.getByLabelText("Mobile number")).toHaveFocus();
    expect(screen.getByLabelText("Mobile number")).toHaveAttribute("aria-required", "true");
    expect(screen.queryByLabelText("Email address")).toBeNull();
    expect(within(row("Email address")).getByText("olivia@example.test")).toBeInTheDocument();
  });

  it("blank → \"Mobile number is required.\"; \"12345\" → \"Enter a valid UK mobile number.\"; nothing sent", async () => {
    show();
    edit();
    type("");
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("Please check the details marked below.");
    expect(screen.getByText("Mobile number is required.")).toBeInTheDocument();
    type("12345");
    await save();
    expect(screen.getByText("Enter a valid UK mobile number.")).toBeInTheDocument();
    expect(screen.getByLabelText("Mobile number")).toHaveFocus();
    expect(updateParentAccountSettings).not.toHaveBeenCalled();
  });

  it("unchanged (the same number typed another way) → back to the rows, no call", async () => {
    show();
    edit();
    type("07700 900123");
    await save();
    expect(updateParentAccountSettings).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Edit contact details" })).toHaveFocus();
  });

  it("a valid number is saved with the version she loaded; back to the rows, focus on Edit", async () => {
    show();
    edit();
    type("07700 900456");
    await save();
    expect(updateParentAccountSettings).toHaveBeenCalledWith({ mobile_number: "07700 900456", expected_updated_at: VERSION });
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Edit contact details" })).toHaveFocus();
  });

  it("stale: back to the rows, showing the latest with its message", async () => {
    updateParentAccountSettings.mockResolvedValueOnce({ success: false, error: STALE, code: "stale" });
    show();
    edit();
    type("07700 900456");
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent(STALE);
    expect(screen.getByRole("button", { name: "Edit contact details" })).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("the server's refusal by field shows under the field", async () => {
    updateParentAccountSettings.mockResolvedValueOnce({
      success: false, error: "Please check the details marked below.", code: "invalid", fields: { mobile: "Enter a valid UK mobile number." },
    });
    show();
    edit();
    type("07700 900456");
    await save();
    expect(screen.getByText("Enter a valid UK mobile number.")).toBeInTheDocument();
    expect(screen.getByLabelText("Mobile number")).toHaveAttribute("aria-invalid", "true");
  });

  it("Cancel discards, focus back on Edit", () => {
    show();
    edit();
    type("07700 900456");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Edit contact details" })).toHaveFocus();
    expect(within(row("Mobile number")).getByText("+44 (0) 7700 900 123")).toBeInTheDocument();
  });
});
