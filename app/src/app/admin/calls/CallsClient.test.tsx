/**
 * The /admin/calls client (plan C3, C4; BB-wave1-041126/04c1-build): the Calls tab, and the row drawer as the
 * `/admin/leads` drawer — `Sheet side="right"`, opened by `?openCall=<parentUserId>` (shareable, refreshable), open
 * at once on a click while the server reads her (a skeleton), closed by a click outside.
 *
 * 04c-2 (BB-wave1-041126/04c2-build): the page is two tabs, Calls · Calendar (the `/admin/users` `Tabs`);
 * `?tab=calendar` opens the Calendar tab, anything else Calls; choosing a tab puts it in the URL (no reload). Each tab
 * says when its own read failed.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));
vi.mock("./actions", () => ({
  holdCallForFamily: vi.fn(),
  confirmCallForFamily: vi.fn(),
  cancelCallForFamily: vi.fn(),
  reloadFamilySlots: vi.fn(),
  recordCallOutcomeAction: vi.fn(),
  saveCallSettingsAction: vi.fn(),
  saveWeeklyHoursAction: vi.fn(),
  addCallBlockAction: vi.fn(),
  removeCallBlockAction: vi.fn(),
  startCallBookingAction: vi.fn(),
}));

import { CallsClient } from "./CallsClient";
import { CALENDAR } from "./calendar-fixtures.test-util";
import { AVA, DASHBOARD, FAY, PANEL } from "./calls-fixtures.test-util";

beforeEach(() => {
  nav.push.mockReset();
  nav.refresh.mockReset();
});

const drawer = () => screen.queryByRole("dialog");

describe("CallsClient", () => {
  it("no ?openCall → the tab, no drawer", () => {
    render(<CallsClient dashboard={DASHBOARD} openCallId={null} panel={null} panelFailed={false} />);
    expect(screen.getByRole("heading", { name: /Today and upcoming/ })).toBeInTheDocument();
    expect(drawer()).toBeNull();
  });

  it("?openCall=<id> with her panel → the drawer is open on her (the leads drawer's Sheet)", () => {
    render(<CallsClient dashboard={DASHBOARD} openCallId={AVA} panel={PANEL} panelFailed={false} />);
    const sheet = drawer();
    expect(sheet).not.toBeNull();
    expect(sheet!.className).toContain("sm:max-w-2xl");
    expect(screen.getByRole("heading", { level: 2, name: "Ava Overdue" })).toBeInTheDocument();
  });

  it("a click on a family opens the drawer at once (a skeleton) and puts ?openCall in the URL", () => {
    render(<CallsClient dashboard={DASHBOARD} openCallId={null} panel={null} panelFailed={false} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Fay Quick" })[0]);
    expect(drawer()).not.toBeNull();
    expect(screen.getByTestId("call-panel-loading")).toBeInTheDocument();
    expect(nav.push).toHaveBeenCalledWith(`/admin/calls?openCall=${FAY}`, { scroll: false });
  });

  it("while another family's panel is still on hand, the skeleton shows — never the wrong family", () => {
    render(<CallsClient dashboard={DASHBOARD} openCallId={AVA} panel={PANEL} panelFailed={false} />);
    // The drawer is modal: close it (Escape), then open the next family before the server has answered.
    fireEvent.keyDown(drawer()!, { key: "Escape" });
    fireEvent.click(screen.getAllByRole("button", { name: "Fay Quick" })[0]);
    expect(screen.getByTestId("call-panel-loading")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { level: 2, name: "Ava Overdue" })).not.toBeInTheDocument();
  });

  it("her panel couldn't be read → one line, in an alert", () => {
    render(<CallsClient dashboard={DASHBOARD} openCallId={AVA} panel={null} panelFailed />);
    expect(screen.getByRole("alert")).toHaveTextContent("This family could not be read — reload to try again.");
  });

  it("the close button sits above the drawer's sticky header (review: it was painted over)", () => {
    render(<CallsClient dashboard={DASHBOARD} openCallId={AVA} panel={PANEL} panelFailed={false} />);
    expect(drawer()!.className).toContain("[&>button]:z-20");
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });

  it("closing puts focus back on the family's name that opened it (review: focus fell to the page)", async () => {
    render(<CallsClient dashboard={DASHBOARD} openCallId={null} panel={null} panelFailed={false} />);
    const opener = screen.getAllByRole("button", { name: "Fay Quick" })[0];
    opener.focus();
    fireEvent.click(opener);
    fireEvent.keyDown(drawer()!, { key: "Escape" });
    // Radix returns focus on unmount after a tick.
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it("focus goes back to her current button even when her row moved section — or nobody focused it on click (review round 2 M5)", async () => {
    const { rerender } = render(<CallsClient dashboard={DASHBOARD} openCallId={null} panel={null} panelFailed={false} />);
    // Safari and Firefox don't focus a clicked button: open without focusing it.
    fireEvent.click(screen.getAllByRole("button", { name: "Fay Quick" })[0]);
    const moved = { ...DASHBOARD, notBooked: DASHBOARD.notBooked.filter((r) => r.parentUserId !== FAY), upcoming: [...DASHBOARD.upcoming, { ...DASHBOARD.notBooked[0], section: "upcoming" as const, key: "c-new" }] };
    rerender(<CallsClient dashboard={moved} openCallId={null} panel={null} panelFailed={false} />);
    fireEvent.keyDown(drawer()!, { key: "Escape" });
    await waitFor(() => expect((document.activeElement as HTMLElement | null)?.dataset.familyId).toBe(FAY));
    expect(document.activeElement?.isConnected).toBe(true);
  });

  it("when she is in two sections, focus goes back to her row in the section she was opened from (re-review M5)", async () => {
    const twice = { ...DASHBOARD, history: [...(DASHBOARD.history ?? []), { key: "e-fay", parentUserId: FAY, when: "Wed 3 Feb, 16:00 (London time)", name: "Fay Quick", what: "No answer", note: "Rang once", by: "Bai Admin", tags: [] }] };
    render(<CallsClient dashboard={twice} openCallId={null} panel={null} panelFailed={false} />);
    const history = screen.getByRole("heading", { level: 2, name: /History/ }).closest("section")!;
    // Opened from History, without focusing the button (Safari, Firefox).
    fireEvent.click(within(history as HTMLElement).getAllByRole("button", { name: "Fay Quick" })[0]);
    fireEvent.keyDown(drawer()!, { key: "Escape" });
    await waitFor(() => expect((document.activeElement as HTMLElement | null)?.dataset.familyId).toBe(FAY));
    expect(document.activeElement?.closest("section")).toBe(history);
  });

  it("if her name is no longer on the page, focus goes to the heading of the section she was opened from (M5)", async () => {
    const { rerender } = render(<CallsClient dashboard={DASHBOARD} openCallId={null} panel={null} panelFailed={false} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Fay Quick" })[0]);
    rerender(<CallsClient dashboard={{ ...DASHBOARD, notBooked: DASHBOARD.notBooked.filter((r) => r.parentUserId !== FAY) }} openCallId={null} panel={null} panelFailed={false} />);
    fireEvent.keyDown(drawer()!, { key: "Escape" });
    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole("heading", { level: 2, name: /Not booked — to call/ })));
  });

  it("the loading and failed drawers leave room for the close button at 320px (review round 2 M7)", () => {
    const { unmount } = render(<CallsClient dashboard={DASHBOARD} openCallId={null} panel={null} panelFailed={false} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Fay Quick" })[0]);
    expect(screen.getByTestId("call-panel-loading").className).toContain("pr-12");
    unmount();
    render(<CallsClient dashboard={DASHBOARD} openCallId={AVA} panel={null} panelFailed />);
    expect(screen.getByRole("alert").parentElement!.className).toContain("pr-12");
  });

  it("the loading drawer says so to a screen reader", () => {
    render(<CallsClient dashboard={DASHBOARD} openCallId={null} panel={null} panelFailed={false} />);
    fireEvent.click(screen.getAllByRole("button", { name: "Fay Quick" })[0]);
    expect(screen.getByTestId("call-panel-loading")).toHaveAttribute("role", "status");
    expect(screen.getByTestId("call-panel-loading")).toHaveTextContent("Loading…");
  });

  it("Escape closes the drawer and drops ?openCall", () => {
    render(<CallsClient dashboard={DASHBOARD} openCallId={AVA} panel={PANEL} panelFailed={false} />);
    fireEvent.keyDown(drawer()!, { key: "Escape" });
    expect(drawer()).toBeNull();
    expect(nav.push).toHaveBeenCalledWith("/admin/calls", { scroll: false });
  });
});

describe("CallsClient — the two tabs (04c-2)", () => {
  const tab = (name: string) => screen.getByRole("tab", { name });

  it("Calls · Calendar; with no ?tab, Calls is open", () => {
    render(<CallsClient dashboard={DASHBOARD} calendar={CALENDAR} openCallId={null} panel={null} panelFailed={false} />);
    expect(screen.getAllByRole("tab").map((t) => t.textContent)).toEqual(["Calls", "Calendar"]);
    expect(tab("Calls")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: /Today and upcoming/ })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Next 7 days (London time)" })).toBeNull();
  });

  it("?tab=calendar opens the Calendar tab", () => {
    render(<CallsClient dashboard={DASHBOARD} calendar={CALENDAR} tab="calendar" openCallId={null} panel={null} panelFailed={false} />);
    expect(tab("Calendar")).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { level: 2, name: "Next 7 days (London time)" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: /Today and upcoming/ })).toBeNull();
  });

  it("choosing a tab shows it and puts it in the URL without a reload; back to Calls drops ?tab", () => {
    const replace = vi.spyOn(window.history, "replaceState");
    render(<CallsClient dashboard={DASHBOARD} calendar={CALENDAR} openCallId={null} panel={null} panelFailed={false} />);
    fireEvent.mouseDown(tab("Calendar"), { button: 0 });
    expect(screen.getByRole("heading", { level: 2, name: "Next 7 days (London time)" })).toBeInTheDocument();
    expect(replace).toHaveBeenLastCalledWith(null, "", "/admin/calls?tab=calendar");
    fireEvent.mouseDown(tab("Calls"), { button: 0 });
    expect(replace).toHaveBeenLastCalledWith(null, "", "/admin/calls");
    expect(nav.push).not.toHaveBeenCalled();
    replace.mockRestore();
  });

  it("the calls couldn't be read → the Calls tab says so; the Calendar tab still works", () => {
    render(<CallsClient dashboard={null} calendar={CALENDAR} openCallId={null} panel={null} panelFailed={false} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The calls could not be read — reload to try again.");
    fireEvent.mouseDown(tab("Calendar"), { button: 0 });
    expect(screen.getByRole("heading", { level: 2, name: "Next 7 days (London time)" })).toBeInTheDocument();
  });

  it("the calendar couldn't be read → the Calendar tab says so", () => {
    render(<CallsClient dashboard={DASHBOARD} calendar={null} tab="calendar" openCallId={null} panel={null} panelFailed={false} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The calendar could not be read — reload to try again.");
  });
});
