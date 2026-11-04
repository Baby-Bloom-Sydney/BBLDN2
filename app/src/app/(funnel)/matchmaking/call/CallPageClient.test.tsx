/**
 * /parent/call, the client (plan B6; brief §3 parent 2–4, §0.3, §0.10, §0.13). The seven states — loading, times
 * shown, held, booked, after a no-answer, no times, load failed — plus change, cancel, and "Go to my matches" always
 * going to the checked `next`. Every label arrives preformatted from the server (London time).
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { groupSlotsByDay } from "@/lib/calls/group-slots-by-day";
import type { BookedCallView, MyCallView } from "@/lib/calls/parent-view";

const h = vi.hoisted(() => ({ hold: vi.fn(), confirm: vi.fn(), cancel: vi.fn(), reload: vi.fn() }));
vi.mock("./actions", () => ({
  holdMyCallSlot: h.hold,
  confirmMyCallHold: h.confirm,
  cancelMyCall: h.cancel,
  reloadMyCallSlots: h.reload,
}));

import { CallPageClient } from "./CallPageClient";

const TUE_14 = "2027-02-09T14:00:00.000Z";
const DAYS = groupSlotsByDay([{ startsAt: TUE_14, endsAt: TUE_14 }]);
const NEXT = "/parent?t=childcare&s=nannies&v=matches";
const BOOKED: BookedCallView = {
  bookingId: "b-1",
  startsAt: TUE_14,
  line: "Your Complimentary matchmaker call is on Tuesday 9 February at 14:00 (London time)",
  changeable: true,
};
const PICK: MyCallView = { kind: "pick", afterNoAnswer: false, days: DAYS };
const HOLD = { holdId: "h-1", startsAt: TUE_14, line: "We're holding Tuesday 9 February, 14:00 (London time) for you until 10:05." };

const page = (initial: MyCallView) => render(<CallPageClient initial={initial} nextHref={NEXT} />);
/** W4: a time-of-day cell, then a time in it (a tap holds at once). */
async function pickTue14(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("radio", { name: "Tuesday 9 February, Afternoon (London time)" }));
  await user.click(screen.getByRole("radio", { name: "Tuesday 9 February, 14:00 (London time)" }));
}
const matchesLink = () => screen.getByRole("link", { name: "Go to my matches" });

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  h.hold.mockResolvedValue({ ok: true, value: HOLD });
  h.confirm.mockResolvedValue({ ok: true, value: { bookingId: "h-1", moved: false, replay: false, booking: BOOKED } });
  h.reload.mockResolvedValue({ ok: true, value: PICK });
});
afterEach(() => vi.restoreAllMocks());

describe("the funnel slide (04b rework W3)", () => {
  it("picking: the funnel shell — the full progress bar, the heading and subtitle, the picker at the bottom", () => {
    page(PICK);
    expect(screen.getByTestId("funnel-progress")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Your Complimentary matchmaker call" })).toBeInTheDocument();
    expect(screen.getByText("Pick a time and we'll call you then. All times are London time.")).toBeInTheDocument();
  });
});

describe("the seven states", () => {
  it("times shown: the picker, and Go to my matches → next", () => {
    page(PICK);
    expect(screen.getByRole("radiogroup", { name: "Tuesday 9 February" })).toBeInTheDocument();
    expect(matchesLink()).toHaveAttribute("href", NEXT);
  });

  it("held, then booked: confirm uses the hold id as its idempotency key; the booked line and an announcement", async () => {
    const user = userEvent.setup();
    page(PICK);
    await pickTue14(user);
    expect(await screen.findByText(HOLD.line)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm time" }));
    expect(h.confirm).toHaveBeenCalledWith("h-1", "h-1");
    expect(await screen.findByText(BOOKED.line)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(`Done — ${BOOKED.line}.`);
    expect(matchesLink()).toHaveAttribute("href", NEXT);
  });

  it("booked: the line, Change time and Cancel", () => {
    page({ kind: "booked", booking: BOOKED, days: DAYS });
    expect(screen.getByText(BOOKED.line)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change time" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("booked, at or after the start: the booking and no buttons", () => {
    page({ kind: "booked", booking: { ...BOOKED, changeable: false }, days: DAYS });
    expect(screen.getByText(BOOKED.line)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change time" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(matchesLink()).toBeInTheDocument();
  });

  it("after a no-answer: 'We tried to call you — pick another time', with the picker", () => {
    page({ kind: "pick", afterNoAnswer: true, days: DAYS });
    expect(screen.getByText("We tried to call you — pick another time")).toBeInTheDocument();
    expect(screen.getByRole("radiogroup", { name: "Tuesday 9 February" })).toBeInTheDocument();
  });

  it("no times: the §0.13 line", () => {
    page({ kind: "pick", afterNoAnswer: false, days: [] });
    expect(screen.getByText("No times free right now — we'll still call you for your Complimentary matchmaker call.")).toBeInTheDocument();
    expect(matchesLink()).toBeInTheDocument();
  });

  it("load failed → Retry reloads; loading shows a skeleton until the view arrives", async () => {
    const user = userEvent.setup();
    let finish: (v: unknown) => void = () => {};
    h.reload.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    page({ kind: "load_failed" });
    expect(screen.getByText("We couldn't load the times — we'll still call you for your Complimentary matchmaker call")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByTestId("slot-picker-loading")).toBeInTheDocument();
    finish({ ok: true, value: PICK });
    expect(await screen.findByRole("radiogroup", { name: "Tuesday 9 February" })).toBeInTheDocument();
  });

  it("a reload that finds her booked (another tab) shows the booking", async () => {
    const user = userEvent.setup();
    h.reload.mockResolvedValueOnce({ ok: true, value: { kind: "booked", booking: BOOKED, days: DAYS } });
    page({ kind: "load_failed" });
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText(BOOKED.line)).toBeInTheDocument();
  });

  it("a reload refused stays on load failed", async () => {
    const user = userEvent.setup();
    h.reload.mockResolvedValueOnce({ ok: false, error: "error" });
    page({ kind: "load_failed" });
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(h.reload).toHaveBeenCalled());
    expect(await screen.findByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("change and cancel", () => {
  it("Change time: reloads, shows the picker beside her current time; Keep my time goes back", async () => {
    const user = userEvent.setup();
    h.reload.mockResolvedValueOnce({ ok: true, value: { kind: "booked", booking: BOOKED, days: DAYS } });
    page({ kind: "booked", booking: BOOKED, days: null });
    await user.click(screen.getByRole("button", { name: "Change time" }));
    expect(await screen.findByRole("radiogroup", { name: "Tuesday 9 February" })).toBeInTheDocument();
    expect(screen.getByText(BOOKED.line)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep my time" }));
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change time" })).toBeInTheDocument();
  });

  it("Cancel asks first; Keep it keeps it; Yes, cancel it cancels and shows the fresh view", async () => {
    const user = userEvent.setup();
    h.cancel.mockResolvedValueOnce({ ok: true, value: PICK });
    page({ kind: "booked", booking: BOOKED, days: DAYS });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Keep it" }));
    expect(h.cancel).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Yes, cancel it" }));
    expect(h.cancel).toHaveBeenCalledWith("b-1");
    expect(await screen.findByRole("radiogroup", { name: "Tuesday 9 February" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Your call is cancelled");
  });

  it.each([
    ["rate_limited", "Too many changes — try again in a while"],
    ["error", "We couldn't do that — try again"],
  ])("a refused cancel (%s): the booking stays, the alert takes focus", async (error, message) => {
    const user = userEvent.setup();
    h.cancel.mockResolvedValueOnce({ ok: false, error });
    page({ kind: "booked", booking: BOOKED, days: DAYS });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Yes, cancel it" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    expect(alert).toHaveFocus();
    expect(screen.getByText(BOOKED.line)).toBeInTheDocument();
  });

  it("a move: the confirmed booking replaces the old line", async () => {
    const user = userEvent.setup();
    const moved = { ...BOOKED, line: "Your Complimentary matchmaker call is on Tuesday 9 February at 14:00 (London time)" };
    // Her old time (16:00) is not in the list (it is hers, so not free); she moves to 14:00.
    const OLD = { ...BOOKED, line: "old line", startsAt: "2027-02-09T16:00:00.000Z" };
    h.reload.mockResolvedValueOnce({ ok: true, value: { kind: "booked", booking: OLD, days: DAYS } });
    h.confirm.mockResolvedValueOnce({ ok: true, value: { bookingId: "b-1", moved: true, replay: false, booking: moved } });
    page({ kind: "booked", booking: OLD, days: DAYS });
    await user.click(screen.getByRole("button", { name: "Change time" }));
    await pickTue14(user);
    await user.click(await screen.findByRole("button", { name: "Confirm time" }));
    expect(await screen.findByText(moved.line)).toBeInTheDocument();
    expect(screen.queryByText("old line")).not.toBeInTheDocument();
  });
});

describe("a rejected or refused action never sticks (review F1, F2)", () => {
  const boom = () => Promise.reject(new Error("network"));

  it("Change time rejecting: no skeleton, the booking stays, the picker says the times couldn't load", async () => {
    const user = userEvent.setup();
    h.reload.mockImplementationOnce(boom);
    page({ kind: "booked", booking: BOOKED, days: DAYS });
    await user.click(screen.getByRole("button", { name: "Change time" }));
    expect(await screen.findByText("We couldn't load the times — we'll still call you for your Complimentary matchmaker call")).toBeInTheDocument();
    expect(screen.queryByTestId("call-page-loading")).not.toBeInTheDocument();
    expect(screen.getByText(BOOKED.line)).toBeInTheDocument();
  });

  it("Change time refused: the same — the booking stays, the days are gone, Retry offered", async () => {
    const user = userEvent.setup();
    h.reload.mockResolvedValueOnce({ ok: false, error: "error" });
    page({ kind: "booked", booking: BOOKED, days: DAYS });
    await user.click(screen.getByRole("button", { name: "Change time" }));
    expect(await screen.findByRole("button", { name: "Retry" })).toBeEnabled();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByText(BOOKED.line)).toBeInTheDocument();
  });

  it("a refused reload while picking: the load-failed line replaces the stale days", async () => {
    const user = userEvent.setup();
    h.hold.mockResolvedValueOnce({ ok: false, error: "taken" });
    h.reload.mockResolvedValueOnce({ ok: false, error: "error" });
    page(PICK);
    await pickTue14(user);
    expect(await screen.findByText("We couldn't load the times — we'll still call you for your Complimentary matchmaker call")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("Cancel rejecting: the alert, the booking and its buttons stay, nothing pending", async () => {
    const user = userEvent.setup();
    h.cancel.mockImplementationOnce(boom);
    page({ kind: "booked", booking: BOOKED, days: DAYS });
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Yes, cancel it" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't do that — try again");
    expect(screen.getByRole("button", { name: "Change time" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });
});
