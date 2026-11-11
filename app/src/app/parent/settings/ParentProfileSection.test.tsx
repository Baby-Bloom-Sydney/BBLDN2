/**
 * Parent Settings › Profile: four plain rows and one Edit; in edit mode her name, date of birth and address in place;
 * one Save with the version she loaded. Today's rules only: a date of birth empty on file and left untouched is never
 * sent; a pick keeps the town and postcode only, never a street line.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";

const { updateParentAccountSettings, refresh, push } = vi.hoisted(() => ({
  updateParentAccountSettings: vi.fn(),
  refresh: vi.fn(),
  push: vi.fn(),
}));
vi.mock("@/lib/actions/parent-account-settings", () => ({ updateParentAccountSettings }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh, push }) }));

import { ParentProfileSection, type ParentProfileFields } from "./ParentProfileSection";

const VERSION = "2027-02-15T10:00:00.333333+00:00";
const OLIVIA: ParentProfileFields = {
  first_name: "Olivia", last_name: "Hartley", date_of_birth: "", suburb: "Clapham", postcode: "SW4", updated_at: VERSION,
};
const CHECK_MARKED = "Please check the details marked below.";
const STALE = "These details were changed elsewhere. The latest are now showing.";
const GAVE_UP = "We couldn't save that. Please try again.";

beforeEach(() => {
  updateParentAccountSettings.mockReset().mockResolvedValue({ success: true, error: null });
  refresh.mockReset();
  push.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => [] })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

const show = (profile: ParentProfileFields = OLIVIA) => render(<ParentProfileSection title="Profile" profile={profile} />);
const row = (label: string) => screen.getByText(label, { selector: "div" }).parentElement as HTMLElement;
const edit = () => fireEvent.click(screen.getByRole("button", { name: "Edit profile" }));
const type = (label: string, value: string) => fireEvent.change(screen.getByLabelText(label), { target: { value } });
const save = async () => { await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Save" })); }); };

describe("Profile — view", () => {
  it("four plain rows and one Edit; no row is a button", () => {
    show();
    expect(screen.getByRole("heading", { level: 2, name: "Profile" })).toBeInTheDocument();
    expect(screen.getAllByRole("button")).toEqual([screen.getByRole("button", { name: "Edit profile" })]);
    expect(within(row("Full legal name")).getByText("Olivia Hartley")).toBeInTheDocument();
    expect(within(row("Date of birth")).getByText("Not set")).toBeInTheDocument();
    expect(within(row("Area")).getByText("Clapham")).toBeInTheDocument();
    expect(within(row("Postcode")).getByText("SW4")).toBeInTheDocument();
    expect(row("Full legal name").closest("button")).toBeNull();
  });

  it("a date of birth on file is shown as today", () => {
    show({ ...OLIVIA, date_of_birth: "1994-03-02" });
    expect(within(row("Date of birth")).getByText("2 March 1994")).toBeInTheDocument();
  });
});

describe("Profile — edit", () => {
  it("First name, Last name, Date of birth and Address in place; focus on First name; Cancel and Save replace Edit", () => {
    show();
    edit();
    expect(screen.getByLabelText("First name")).toHaveFocus();
    expect(screen.getByLabelText("First name")).toHaveValue("Olivia");
    expect(screen.getByLabelText("Last name")).toHaveValue("Hartley");
    expect(screen.getByLabelText("Date of birth")).toHaveValue("");
    const address = screen.getByLabelText(/^Address/);
    const current = document.getElementById(`${address.id}-current`) as HTMLElement;
    expect(current).toHaveTextContent("ClaphamSW4");
    expect(screen.getByText("London only")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Edit profile" })).toBeNull();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
  });

  it("names are marked required; a date of birth only when one is on file; the address is not", () => {
    show();
    edit();
    expect(screen.getByLabelText("First name")).toHaveAttribute("aria-required", "true");
    expect(screen.getByLabelText("Last name")).toHaveAttribute("aria-required", "true");
    expect(screen.getByLabelText("Date of birth")).not.toHaveAttribute("aria-required");
    expect(screen.getByLabelText(/^Address/)).not.toHaveAttribute("aria-required");
    cleanup();
    show({ ...OLIVIA, date_of_birth: "1994-03-02" });
    edit();
    expect(screen.getByLabelText("Date of birth")).toHaveAttribute("aria-required", "true");
  });

  it("Cancel discards what she typed and puts focus back on Edit", () => {
    show();
    edit();
    type("First name", "Liv");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Edit profile" })).toHaveFocus();
    expect(within(row("Full legal name")).getByText("Olivia Hartley")).toBeInTheDocument();
    edit();
    expect(screen.getByLabelText("First name")).toHaveValue("Olivia");
  });

  it("nothing changed: Save goes back to the rows without a call", async () => {
    show();
    edit();
    type("First name", " Olivia ");
    await save();
    expect(updateParentAccountSettings).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Edit profile" })).toHaveFocus();
  });
});

describe("Profile — today's rules", () => {
  it("a cleared last name: the alert, the message under the field, focus on it; nothing sent, nothing she typed lost", async () => {
    show();
    edit();
    type("First name", "Liv");
    type("Last name", "");
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent(CHECK_MARKED);
    const last = screen.getByLabelText("Last name");
    expect(last).toHaveFocus();
    expect(last).toHaveAttribute("aria-invalid", "true");
    expect(document.getElementById(last.getAttribute("aria-describedby") ?? "")).toHaveTextContent("Enter your last name");
    expect(screen.getByLabelText("First name")).toHaveValue("Liv");
    expect(updateParentAccountSettings).not.toHaveBeenCalled();
  });

  it("a cleared first name, and a cleared date of birth on file, each with its message", async () => {
    show({ ...OLIVIA, date_of_birth: "1994-03-02" });
    edit();
    type("First name", " ");
    type("Date of birth", "");
    await save();
    expect(screen.getByText("Enter your first name")).toBeInTheDocument();
    expect(screen.getByText("Enter your date of birth")).toBeInTheDocument();
    expect(updateParentAccountSettings).not.toHaveBeenCalled();
  });

  it("a date of birth empty on file and untouched is never sent, and nothing is refused", async () => {
    show();
    edit();
    type("Last name", "Hartley-Reed");
    await save();
    expect(updateParentAccountSettings).toHaveBeenCalledWith({ last_name: "Hartley-Reed", expected_updated_at: VERSION });
  });

  it("a date of birth given for the first time is sent", async () => {
    show();
    edit();
    type("Date of birth", "1994-03-02");
    await save();
    expect(updateParentAccountSettings).toHaveBeenCalledWith({ date_of_birth: "1994-03-02", expected_updated_at: VERSION });
  });
});

describe("Profile — Save", () => {
  it("a pick keeps the town and postcode only; one Save sends the changed keys and the version; back to the rows", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    vi.stubGlobal("fetch", vi.fn(async (url: string) => ({
      ok: true,
      json: async () => (url.startsWith("/api/london-districts")
        ? [{ district: "N1", prefix: "N1", label: "Islington" }]
        : [{ sla: "7 NEW ROAD, LONDON N1 1AA", pid: "a", score: 1 }]),
    })));
    show();
    edit();
    type("Last name", "Hartley-Reed");
    const box = screen.getByLabelText(/^Address/);
    box.focus();
    fireEvent.change(box, { target: { value: "7 new road" } });
    await act(async () => { await vi.advanceTimersByTimeAsync(300); });
    fireEvent.click(screen.getByRole("button", { name: "7 New Road, London N1 1aa" }));
    await act(async () => { await vi.advanceTimersByTimeAsync(10); });
    const current = document.getElementById(`${box.id}-current`) as HTMLElement;
    expect(current).toHaveTextContent("LondonN1 1AA");
    expect(current).not.toHaveTextContent("New Road");
    await save();
    expect(updateParentAccountSettings).toHaveBeenCalledWith({
      last_name: "Hartley-Reed", suburb: "London", postcode: "N1 1AA", expected_updated_at: VERSION,
    });
    expect(refresh).toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Edit profile" })).toHaveFocus();
  });

  it("the server's refusal by field shows under its field, still editing", async () => {
    updateParentAccountSettings.mockResolvedValueOnce({ success: false, error: CHECK_MARKED, code: "invalid", fields: { lastName: "Enter your last name" } });
    show();
    edit();
    type("Last name", "H");
    await save();
    expect(screen.getByText("Enter your last name")).toBeInTheDocument();
    expect(screen.getByLabelText("Last name")).toHaveValue("H");
  });

  it("stale: back to the rows, showing the latest with its message", async () => {
    updateParentAccountSettings.mockResolvedValueOnce({ success: false, error: STALE, code: "stale" });
    show();
    edit();
    type("Last name", "Hartley-Reed");
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent(STALE);
    expect(screen.getByRole("button", { name: "Edit profile" })).toBeInTheDocument();
    expect(refresh).toHaveBeenCalled();
  });

  it("offline (the save throws): the give-up message, still editing", async () => {
    updateParentAccountSettings.mockRejectedValueOnce(new Error("Failed to fetch"));
    show();
    edit();
    type("Last name", "Hartley-Reed");
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent(GAVE_UP);
    expect(screen.getByLabelText("Last name")).toHaveValue("Hartley-Reed");
  });

  it("no answer within 30 s: the give-up message, still editing", async () => {
    vi.useFakeTimers();
    updateParentAccountSettings.mockReturnValueOnce(new Promise(() => undefined));
    show();
    edit();
    type("Last name", "Hartley-Reed");
    act(() => { fireEvent.click(screen.getByRole("button", { name: "Save" })); });
    await act(async () => { await vi.advanceTimersByTimeAsync(30_000); });
    expect(screen.getByRole("alert")).toHaveTextContent(GAVE_UP);
    expect(screen.getByLabelText("Last name")).toHaveValue("Hartley-Reed");
  });

  it("signed out mid-edit: the plain sign-in message, still editing", async () => {
    updateParentAccountSettings.mockResolvedValueOnce({ success: false, error: "Please sign in again, then try once more." });
    show();
    edit();
    type("Last name", "Hartley-Reed");
    await save();
    expect(screen.getByRole("alert")).toHaveTextContent("Please sign in again, then try once more.");
    expect(screen.getByLabelText("Last name")).toBeInTheDocument();
  });
});

describe("Profile — leaving with changes", () => {
  const withLink = () => render(
    <>
      <a href="/parent/settings?s=linked-children">Linked children</a>
      <ParentProfileSection title="Profile" profile={OLIVIA} />
    </>,
  );

  it("a link asks \"Discard your changes?\"; Keep editing stays", async () => {
    withLink();
    edit();
    type("First name", "Liv");
    await act(async () => { fireEvent.click(screen.getByRole("link", { name: "Linked children" })); });
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("Discard your changes?")).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Keep editing" })).toHaveFocus();
    await act(async () => { fireEvent.click(within(dialog).getByRole("button", { name: "Keep editing" })); });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByLabelText("First name")).toHaveValue("Liv");
    expect(push).not.toHaveBeenCalled();
  });

  it("Discard drops the changes and goes where she clicked", async () => {
    withLink();
    edit();
    type("First name", "Liv");
    await act(async () => { fireEvent.click(screen.getByRole("link", { name: "Linked children" })); });
    await act(async () => { fireEvent.click(screen.getByRole("button", { name: "Discard" })); });
    expect(push).toHaveBeenCalledWith("/parent/settings?s=linked-children");
    expect(screen.getByRole("button", { name: "Edit profile" })).toBeInTheDocument();
  });

  it("no change, no question", async () => {
    withLink();
    edit();
    await act(async () => { fireEvent.click(screen.getByRole("link", { name: "Linked children" })); });
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
