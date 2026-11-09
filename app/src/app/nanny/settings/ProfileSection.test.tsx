/**
 * Settings › Profile (ledger B06 §9.1 R1, R2, R4): plain rows and one Edit; in edit mode her name, date of birth and
 * address in place (the name and date of birth stay locked once identity verification is done); one Save with the
 * version she loaded. Her address is the one record Business shows too.
 *
 * BB-wave1-041126/06b3-rework, 2026-11-09.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const { updateNannyAccountSettings, refresh } = vi.hoisted(() => ({ updateNannyAccountSettings: vi.fn(), refresh: vi.fn() }));
vi.mock("@/lib/actions/nanny-account-settings", () => ({ updateNannyAccountSettings }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push: vi.fn() }) }));

import { ProfileSection, type ProfileFields } from "./ProfileSection";

const VERSION = "2027-02-15T10:00:00.333333+00:00";
const ADDRESS_VERSION = "2027-02-15T10:00:00.666666+00:00";
const PROFILE: ProfileFields = {
  first_name: "Sophie", last_name: "Taylor", date_of_birth: "1995-03-12",
  address_line1: "1 Upper Street", address_line2: "", suburb: "London", postcode: "N1 0AA", updated_at: VERSION,
  address_updated_at: ADDRESS_VERSION,
};

beforeEach(() => {
  updateNannyAccountSettings.mockReset().mockResolvedValue({ success: true, error: null });
  refresh.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [] })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = (profile: ProfileFields = PROFILE, verified = false) =>
  render(<ProfileSection title="Profile" profile={profile} identityVerified={verified} />);
const row = (label: string) => screen.getByText(label, { selector: "div" }).parentElement as HTMLElement;
const save = async () => { await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); }); };

describe("Profile — view", () => {
  it("plain rows and one Edit; the address in full, no Area or Postcode rows", () => {
    show();
    expect(screen.getByRole("heading", { level: 2, name: "Profile" })).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toEqual([screen.getByRole("button", { name: "Edit profile" })]);
    expect(within(row("Full legal name")).getByText("Sophie Taylor")).toBeInTheDocument();
    expect(within(row("Date of birth")).getByText("12 March 1995")).toBeInTheDocument();
    expect(within(row("Address")).getByText("1 Upper Street")).toBeInTheDocument();
    expect(within(row("Address")).getByText("London")).toBeInTheDocument();
    expect(within(row("Address")).getByText("N1 0AA")).toBeInTheDocument();
    expect(screen.queryByText("Area")).toBeNull();
    expect(screen.queryByText("Postcode")).toBeNull();
  });

  it("no address on file reads Not added", () => {
    show({ ...PROFILE, address_line1: "", suburb: "", postcode: "" });
    expect(within(row("Address")).getByText("Not added")).toBeInTheDocument();
  });
});

describe("Profile — edit and Save", () => {
  it("every field in place; a change is saved with the version she loaded; back to view, focus on Edit", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    expect(screen.getByLabelText("First name")).toHaveFocus();
    expect(screen.getByLabelText("Date of birth")).toHaveValue("1995-03-12");
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "Taylor-Brown" } });
    await save();
    // both rows she loaded go with it: her profile's version and her home address's (security H1: one atomic save)
    expect(updateNannyAccountSettings).toHaveBeenCalledWith({
      last_name: "Taylor-Brown", expected_updated_at: VERSION, expected_address_updated_at: ADDRESS_VERSION,
    });
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Edit profile" })).toHaveFocus();
  });

  it("never saved empty: each refusal under its field, focus on the first; nothing sent", async () => {
    show({ ...PROFILE, address_line1: "", suburb: "", postcode: "" });
    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: " " } });
    fireEvent.change(screen.getByLabelText("Date of birth"), { target: { value: "" } });
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("Please check the details marked below.");
    expect(screen.getByText("Enter your first name")).toBeInTheDocument();
    expect(screen.getByText("Enter your date of birth")).toBeInTheDocument();
    expect(screen.getByText("Choose your address")).toBeInTheDocument();
    expect(screen.getByLabelText("First name")).toHaveFocus();
    expect(updateNannyAccountSettings).not.toHaveBeenCalled();
  });

  it("the alert goes once every marked field is fixed (coordinator, round 2)", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: " " } });
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("Please check the details marked below.");
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Sophie" } });
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("identity verified: name and date of birth stay locked rows; only the address can change", async () => {
    show(PROFILE, true);
    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    expect(screen.queryByLabelText("First name")).toBeNull();
    expect(screen.queryByLabelText("Date of birth")).toBeNull();
    expect(within(row("Full legal name").parentElement as HTMLElement).getByText("Verified")).toBeInTheDocument();
    expect(screen.getByLabelText(/^Address/)).toHaveFocus();
    await save();
    expect(updateNannyAccountSettings).not.toHaveBeenCalled();
  });

  it("the server's answers: fields by field; stale shows the latest with its message", async () => {
    updateNannyAccountSettings.mockResolvedValueOnce({ success: false, error: "Please check the details marked below.", code: "invalid", fields: { lastName: "Enter your last name" } });
    show();
    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    fireEvent.change(screen.getByLabelText("Last name"), { target: { value: "T" } });
    await save();
    expect(screen.getByText("Enter your last name")).toBeInTheDocument();
    updateNannyAccountSettings.mockResolvedValueOnce({ success: false, error: "These details were changed elsewhere. The latest are now showing.", code: "stale" });
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("These details were changed elsewhere. The latest are now showing.");
  });

  it("a locked refusal or a failure: its message, still editing", async () => {
    updateNannyAccountSettings.mockResolvedValueOnce({ success: false, error: "Your name and date of birth can't be changed after identity verification.", code: "locked" });
    show();
    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "Sophia" } });
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("can't be changed after identity verification");
    expect(screen.getByLabelText("First name")).toHaveValue("Sophia");
  });

  it("required fields are marked; an error clears as she fixes its field; the rows wrap long values (review round 1)", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    for (const label of ["First name", "Last name", "Date of birth"]) expect(screen.getByLabelText(label)).toHaveAttribute("aria-required", "true");
    expect(screen.getByLabelText(/^Address/)).toHaveAttribute("aria-required", "true");
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "" } });
    await save();
    expect(screen.getByLabelText("First name")).toHaveAttribute("aria-invalid", "true");
    fireEvent.change(screen.getByLabelText("First name"), { target: { value: "S" } });
    expect(screen.getByLabelText("First name")).not.toHaveAttribute("aria-invalid");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Sophie Taylor").parentElement?.className).toMatch(/break-words/);
  });

  it("unchanged: Save goes back to the rows without a call", async () => {
    show();
    fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
    await save();
    expect(updateNannyAccountSettings).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Edit profile" })).toBeInTheDocument();
  });
});
