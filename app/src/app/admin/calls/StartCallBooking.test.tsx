/**
 * "Start call booking" (plan §12 R11, §13; brief 14's switch-on step): it can't be undone, so it asks first; "Not yet"
 * changes nothing. Once started, only the date it started shows — no button to press again.
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ refresh: vi.fn() }));
const actions = vi.hoisted(() => ({ startCallBookingAction: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => nav }));
vi.mock("./actions", () => actions);

import { StartCallBooking } from "./StartCallBooking";

beforeEach(() => {
  nav.refresh.mockReset();
  actions.startCallBookingAction.mockReset();
  actions.startCallBookingAction.mockResolvedValue({ ok: true, value: { startedOn: "6 November 2026", startedNow: true } });
});

const start = () => screen.getByRole("button", { name: "Start call booking" });
const dialog = () => screen.getByRole("dialog", { name: "Start call booking?" });

describe("StartCallBooking", () => {
  it("not started: says no parent is offered the call yet, and offers the button", () => {
    render(<StartCallBooking startedOn={null} />);
    expect(screen.getByText("Call booking hasn't started: no parent is offered a matchmaker call yet.")).toBeInTheDocument();
    expect(start()).toBeEnabled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("the button asks first, saying it can't be undone; Not yet closes it and changes nothing", async () => {
    render(<StartCallBooking startedOn={null} />);
    fireEvent.click(start());
    expect(within(dialog()).getByText(/This can't be undone\./)).toBeInTheDocument();
    fireEvent.click(within(dialog()).getByRole("button", { name: "Not yet" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(actions.startCallBookingAction).not.toHaveBeenCalled();
    expect(start()).toBeInTheDocument();
  });

  it("Yes → started once; then only the date shows, and there's nothing to press again", async () => {
    render(<StartCallBooking startedOn={null} />);
    fireEvent.click(start());
    const yes = within(dialog()).getByRole("button", { name: "Yes, start call booking" });
    fireEvent.click(yes);
    fireEvent.click(yes);
    await waitFor(() => expect(screen.getByText("Call booking started on 6 November 2026.")).toBeInTheDocument());
    expect(actions.startCallBookingAction).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByRole("button", { name: "Start call booking" })).toBeNull();
    expect(nav.refresh).toHaveBeenCalled();
  });

  it("refused → the line inside the dialog, which stays open; still not started", async () => {
    actions.startCallBookingAction.mockResolvedValue({ ok: false, error: "error" });
    render(<StartCallBooking startedOn={null} />);
    fireEvent.click(start());
    fireEvent.click(within(dialog()).getByRole("button", { name: "Yes, start call booking" }));
    await waitFor(() => expect(within(dialog()).getByRole("alert")).toHaveTextContent("That didn't save — try again."));
    expect(screen.queryByText(/Call booking started on/)).toBeNull();
  });

  it("already started: only the date, no button", () => {
    render(<StartCallBooking startedOn="1 February 2027" />);
    expect(screen.getByText("Call booking started on 1 February 2027.")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
