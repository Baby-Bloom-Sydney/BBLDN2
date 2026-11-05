/**
 * Book, move or cancel a family's call on her behalf, in the row drawer (plan C4; brief §3 admin 4, §0.11;
 * BB-wave1-041126/04c1-build). The same `SlotPicker` as hers, with the admin actions and the admin words ("Book
 * this time" / "Move to this time", "Held for N minutes", the London heading). Cancel asks first. She is emailed
 * by the server either way.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({
  holdCallForFamily: vi.fn(),
  confirmCallForFamily: vi.fn(),
  cancelCallForFamily: vi.fn(),
  reloadFamilySlots: vi.fn(),
  recordCallOutcomeAction: vi.fn(),
}));
vi.mock("./actions", () => actions);

import { OnBehalfPicker } from "./OnBehalfPicker";
import { AVA, BOOKING, PANEL, PANEL_DAYS } from "./calls-fixtures.test-util";

const TUE_14 = "2027-02-09T14:00:00.000Z";
const HOLD = { holdId: "h0400000-0000-4000-8000-000000000001", startsAt: TUE_14, line: "Held for 5 minutes" };
type User = ReturnType<typeof userEvent.setup>;

async function pickTue14(user: User) {
  await user.click(screen.getByRole("button", { name: "Tue 9 Feb" }));
  await user.click(screen.getByRole("button", { name: /^Afternoon / }));
  await user.click(screen.getByRole("button", { name: "Tuesday 9 February, 14:00" }));
}

beforeEach(() => {
  for (const fn of Object.values(actions)) fn.mockReset();
  actions.holdCallForFamily.mockResolvedValue({ ok: true, value: HOLD });
  actions.confirmCallForFamily.mockResolvedValue({ ok: true, value: { bookingId: BOOKING, moved: false } });
  actions.cancelCallForFamily.mockResolvedValue({ ok: true, value: { bookingId: BOOKING } });
  actions.reloadFamilySlots.mockResolvedValue({ ok: true, value: PANEL_DAYS });
});

describe("OnBehalfPicker — not booked", () => {
  it("'Not booked' and 'Book a matchmaker call' → the picker in admin words → Book this time", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(<OnBehalfPicker parentUserId={AVA} booking={null} days={PANEL_DAYS} onChanged={onChanged} />);
    expect(screen.getByText("Not booked")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Book a matchmaker call" }));
    expect(screen.getByRole("heading", { name: "Matchmaker's availability (London time)" })).toBeInTheDocument();
    await pickTue14(user);
    expect(actions.holdCallForFamily).toHaveBeenCalledWith({ parentUserId: AVA, startsAt: TUE_14 });
    expect(await screen.findByText("Held for 5 minutes")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Book this time" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(actions.confirmCallForFamily).toHaveBeenCalledWith({ parentUserId: AVA, holdId: HOLD.holdId, idempotencyKey: HOLD.holdId });
    expect(screen.getByRole("status")).toHaveTextContent("Booked — the family is emailed.");
    expect(screen.queryByRole("heading", { name: "Matchmaker's availability (London time)" })).not.toBeInTheDocument();
  });

  it("Back closes the picker without a write", async () => {
    const user = userEvent.setup();
    render(<OnBehalfPicker parentUserId={AVA} booking={null} days={PANEL_DAYS} onChanged={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Book a matchmaker call" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: "Book a matchmaker call" })).toBeInTheDocument();
    expect(actions.confirmCallForFamily).not.toHaveBeenCalled();
  });

  it("a time taken meanwhile → the taken notice and a fresh list (the picker's own behaviour)", async () => {
    const user = userEvent.setup();
    actions.holdCallForFamily.mockResolvedValue({ ok: false, error: "taken" });
    render(<OnBehalfPicker parentUserId={AVA} booking={null} days={PANEL_DAYS} onChanged={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Book a matchmaker call" }));
    await pickTue14(user);
    expect(await screen.findByText("This time has just been booked")).toBeInTheDocument();
    await waitFor(() => expect(actions.reloadFamilySlots).toHaveBeenCalledWith({ parentUserId: AVA }));
  });

  it("a refusal that isn't about the time (not an admin any more) → the picker's generic line", async () => {
    const user = userEvent.setup();
    actions.holdCallForFamily.mockResolvedValue({ ok: false, error: "not_authorized" });
    render(<OnBehalfPicker parentUserId={AVA} booking={null} days={PANEL_DAYS} onChanged={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Book a matchmaker call" }));
    await pickTue14(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't do that — try again");
  });

  it("days that couldn't be read → load-failed with Retry", async () => {
    const user = userEvent.setup();
    render(<OnBehalfPicker parentUserId={AVA} booking={null} days={null} onChanged={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Book a matchmaker call" }));
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(actions.reloadFamilySlots).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: "Tue 9 Feb" })).toBeInTheDocument();
  });
});

describe("OnBehalfPicker — fresh props after the page refreshes", () => {
  it("new days from the server replace the old ones", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<OnBehalfPicker parentUserId={AVA} booking={null} days={PANEL_DAYS} onChanged={vi.fn()} />);
    rerender(<OnBehalfPicker parentUserId={AVA} booking={null} days={PANEL_DAYS.slice(1)} onChanged={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Book a matchmaker call" }));
    expect(screen.queryByRole("button", { name: "Tue 9 Feb" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Wed 10 Feb" })).toBeInTheDocument();
  });
});

describe("OnBehalfPicker — booked", () => {
  it("her time in London words, with Move and Cancel booking", () => {
    render(<OnBehalfPicker parentUserId={AVA} booking={PANEL.booking} days={PANEL_DAYS} onChanged={vi.fn()} />);
    expect(screen.getByText("Mon 8 Feb, 10:00 (London time)")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Move" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel booking" })).toBeInTheDocument();
  });

  it("Move → 'Move to this time'; confirming moves it", async () => {
    const user = userEvent.setup();
    actions.confirmCallForFamily.mockResolvedValue({ ok: true, value: { bookingId: BOOKING, moved: true } });
    const onChanged = vi.fn();
    render(<OnBehalfPicker parentUserId={AVA} booking={PANEL.booking} days={PANEL_DAYS} onChanged={onChanged} />);
    await user.click(screen.getByRole("button", { name: "Move" }));
    await pickTue14(user);
    await user.click(await screen.findByRole("button", { name: "Move to this time" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(screen.getByRole("status")).toHaveTextContent("Moved — the family is emailed.");
  });

  it("Cancel booking asks first; Keep it does nothing", async () => {
    const user = userEvent.setup();
    render(<OnBehalfPicker parentUserId={AVA} booking={PANEL.booking} days={PANEL_DAYS} onChanged={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Cancel booking" }));
    expect(screen.getByText("Cancel this matchmaker call? The family is emailed.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep it" }));
    expect(actions.cancelCallForFamily).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "Cancel booking" })).toBeInTheDocument();
  });

  it("Yes, cancel it → cancelled as the admin; she is back under Not booked", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(<OnBehalfPicker parentUserId={AVA} booking={PANEL.booking} days={PANEL_DAYS} onChanged={onChanged} />);
    await user.click(screen.getByRole("button", { name: "Cancel booking" }));
    await user.click(screen.getByRole("button", { name: "Yes, cancel it" }));
    await waitFor(() => expect(onChanged).toHaveBeenCalled());
    expect(actions.cancelCallForFamily).toHaveBeenCalledWith({ parentUserId: AVA, bookingId: BOOKING });
    expect(screen.getByRole("status")).toHaveTextContent("Cancelled — the family is back under Not booked.");
  });

  it("a refused cancel → one line in an alert; nothing refreshed", async () => {
    const user = userEvent.setup();
    actions.cancelCallForFamily.mockResolvedValue({ ok: false, error: "not_found" });
    const onChanged = vi.fn();
    render(<OnBehalfPicker parentUserId={AVA} booking={PANEL.booking} days={PANEL_DAYS} onChanged={onChanged} />);
    await user.click(screen.getByRole("button", { name: "Cancel booking" }));
    await user.click(screen.getByRole("button", { name: "Yes, cancel it" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That call has changed — reload to see it.");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("a cohort pre-book (brief 03's): Cancel booking, but no Move — the first-call picker would add a second booking, not move it", () => {
    render(<OnBehalfPicker parentUserId={AVA} booking={{ ...PANEL.booking!, purpose: "cohort_prebook" }} days={PANEL_DAYS} onChanged={vi.fn()} />);
    expect(screen.getByText("Cohort pre-book")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Move" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel booking" })).toBeInTheDocument();
  });

  it("the cancel question goes when her booking changes under it (review: 'Yes' would act on a stale booking)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<OnBehalfPicker parentUserId={AVA} booking={PANEL.booking} days={PANEL_DAYS} onChanged={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Cancel booking" }));
    rerender(<OnBehalfPicker parentUserId={AVA} booking={null} days={PANEL_DAYS} onChanged={vi.fn()} />);
    expect(screen.queryByText("Cancel this matchmaker call? The family is emailed.")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Book a matchmaker call" })).toBeInTheDocument();
  });

  it("focus follows the steps: Back on the picker, Keep it on the question, the status line after a write", async () => {
    const user = userEvent.setup();
    render(<OnBehalfPicker parentUserId={AVA} booking={PANEL.booking} days={PANEL_DAYS} onChanged={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Move" }));
    expect(screen.getByRole("button", { name: "Back" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(screen.getByRole("button", { name: "Cancel booking" }));
    expect(screen.getByRole("button", { name: "Keep it" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Yes, cancel it" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveFocus());
  });

  it("a refused cancel's line is cleared once she leaves the question", async () => {
    const user = userEvent.setup();
    actions.cancelCallForFamily.mockResolvedValue({ ok: false, error: "error" });
    render(<OnBehalfPicker parentUserId={AVA} booking={PANEL.booking} days={PANEL_DAYS} onChanged={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Cancel booking" }));
    await user.click(screen.getByRole("button", { name: "Yes, cancel it" }));
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("after a write, the buttons wait for the page's fresh props (code review: a stale 'Cancel' showed for a moment)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<OnBehalfPicker parentUserId={AVA} booking={PANEL.booking} days={PANEL_DAYS} onChanged={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Cancel booking" }));
    await user.click(screen.getByRole("button", { name: "Yes, cancel it" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Cancelled"));
    expect(screen.getByRole("button", { name: "Cancel booking" })).toBeDisabled();
    rerender(<OnBehalfPicker parentUserId={AVA} booking={null} days={[...PANEL_DAYS]} onChanged={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Book a matchmaker call" })).toBeEnabled();
  });

  it("a double click on 'Yes, cancel it' sends one cancel (review round 2 M3)", async () => {
    const user = userEvent.setup();
    let release: (v: unknown) => void = () => {};
    actions.cancelCallForFamily.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    render(<OnBehalfPicker parentUserId={AVA} booking={PANEL.booking} days={PANEL_DAYS} onChanged={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Cancel booking" }));
    const yes = screen.getByRole("button", { name: "Yes, cancel it" }); // the same element twice, as a real double click
    fireEvent.click(yes);
    fireEvent.click(yes);
    expect(actions.cancelCallForFamily).toHaveBeenCalledTimes(1);
    release({ ok: true, value: { bookingId: BOOKING } });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Cancelled"));
  });

  it("the buttons come back when her booking changes, even if the grid stays unreadable (review round 2 M4)", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<OnBehalfPicker parentUserId={AVA} booking={PANEL.booking} days={null} onChanged={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Cancel booking" }));
    await user.click(screen.getByRole("button", { name: "Yes, cancel it" }));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Cancelled"));
    rerender(<OnBehalfPicker parentUserId={AVA} booking={null} days={null} onChanged={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Book a matchmaker call" })).toBeEnabled();
  });

  it("the cancel question is read with its answers, and leaving it returns focus to Cancel booking (review round 2 M6)", async () => {
    const user = userEvent.setup();
    render(<OnBehalfPicker parentUserId={AVA} booking={PANEL.booking} days={PANEL_DAYS} onChanged={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Cancel booking" }));
    expect(screen.getByRole("button", { name: "Keep it" })).toHaveAccessibleDescription("Cancel this matchmaker call? The family is emailed.");
    expect(screen.getByRole("button", { name: "Yes, cancel it" })).toHaveAccessibleDescription("Cancel this matchmaker call? The family is emailed.");
    await user.click(screen.getByRole("button", { name: "Keep it" }));
    expect(screen.getByRole("button", { name: "Cancel booking" })).toHaveFocus();
  });

  it("Back returns focus to the button that opened the picker — Move, or Book (M6)", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<OnBehalfPicker parentUserId={AVA} booking={PANEL.booking} days={PANEL_DAYS} onChanged={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Move" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: "Move" })).toHaveFocus();
    unmount();
    render(<OnBehalfPicker parentUserId={AVA} booking={null} days={PANEL_DAYS} onChanged={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Book a matchmaker call" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("button", { name: "Book a matchmaker call" })).toHaveFocus();
  });

  it("a call that has started: no Move, no Cancel (record the outcome instead)", () => {
    render(<OnBehalfPicker parentUserId={AVA} booking={{ ...PANEL.booking!, changeable: false }} days={PANEL_DAYS} onChanged={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Move" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel booking" })).not.toBeInTheDocument();
  });
});
