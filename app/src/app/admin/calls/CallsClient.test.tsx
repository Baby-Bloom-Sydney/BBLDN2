/**
 * The /admin/calls client (plan C3, C4; BB-wave1-041126/04c1-build): the Calls tab, and the row drawer as the
 * `/admin/leads` drawer — `Sheet side="right"`, opened by `?openCall=<parentUserId>` (shareable, refreshable), open
 * at once on a click while the server reads her (a skeleton), closed by a click outside.
 */
import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ push: vi.fn(), refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));
vi.mock("./actions", () => ({
  holdCallForFamily: vi.fn(),
  confirmCallForFamily: vi.fn(),
  cancelCallForFamily: vi.fn(),
  reloadFamilySlots: vi.fn(),
  recordCallOutcomeAction: vi.fn(),
}));

import { CallsClient } from "./CallsClient";
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

  it("Escape closes the drawer and drops ?openCall", () => {
    render(<CallsClient dashboard={DASHBOARD} openCallId={AVA} panel={PANEL} panelFailed={false} />);
    fireEvent.keyDown(drawer()!, { key: "Escape" });
    expect(drawer()).toBeNull();
    expect(nav.push).toHaveBeenCalledWith("/admin/calls", { scroll: false });
  });
});
