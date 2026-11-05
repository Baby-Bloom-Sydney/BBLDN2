/**
 * The call slide, the client (`/matchmaking/call`; plan B6; brief §0a.1, §3 parent 2–4, §0.3, §0.10, §0.13; 04b rework
 * W3–W5). The seven states — loading, times shown, held, booked, after a no-answer, no times, load failed — in the
 * funnel's shell; change (her booking on top, `?change=1` straight in) and cancel; onward always to the checked
 * `next`, labelled by where it goes. Every label arrives preformatted from the server.
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { groupSlotGridByDay } from "@/lib/calls/group-slots-by-day";
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
const DAYS = groupSlotGridByDay({ dates: ["2027-02-09"], slots: [{ startsAt: TUE_14, endsAt: TUE_14, free: true }] });
const NEXT = "/parent?t=childcare&s=nannies&v=matches";
const MOBILE = "07700 900123";
const BOOKED: BookedCallView = {
  bookingId: "b-1",
  startsAt: TUE_14,
  line: "Your Complimentary matchmaker call is on Tuesday 9 February at 14:00",
  when: "Tuesday 9 February, 14:00",
  yourCall: "Your call: Tuesday 9 February at 14:00",
  changeable: true,
};
const PICK: MyCallView = { kind: "pick", afterNoAnswer: false, days: DAYS, mobile: MOBILE, needsPosition: false };
const BOOKED_VIEW: MyCallView = { kind: "booked", booking: BOOKED, days: DAYS, mobile: MOBILE, needsPosition: false };
const HOLD = { holdId: "h-1", startsAt: TUE_14, line: "We're holding Tuesday 9 February, 14:00 for you until 10:05." };

const page = (initial: MyCallView, next = NEXT, startChanging = false) =>
  render(<CallPageClient initial={initial} nextHref={next} startChanging={startChanging} />);
/** W4: a time-of-day cell, then a time in it (a tap holds at once). */
async function pickTue14(user: ReturnType<typeof userEvent.setup>) {
  await user.click(await screen.findByRole("radio", { name: "Tue 9 Feb" }));
  await user.click(screen.getByRole("radio", { name: /^Afternoon / }));
  await user.click(screen.getByRole("radio", { name: "Tuesday 9 February, 14:00" }));
}
const youreBooked = () => screen.findByRole("heading", { level: 1, name: "You're booked" });

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
    expect(screen.getByText("Pick a time and we'll call you then.")).toBeInTheDocument();
  });
});

describe("the seven states", () => {
  it("times shown: the picker, and Skip for now → next", () => {
    page(PICK);
    expect(screen.getByRole("radio", { name: "Tue 9 Feb" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Skip for now" })).toHaveAttribute("href", NEXT);
  });

  it("held, then booked: confirm uses the hold id as its idempotency key; You're booked, the time, her number, onward", async () => {
    const user = userEvent.setup();
    page(PICK);
    await pickTue14(user);
    expect(await screen.findByText(HOLD.line)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm time" }));
    expect(h.confirm).toHaveBeenCalledWith("h-1", "h-1");
    expect(await youreBooked()).toBeInTheDocument();
    expect(screen.getByText("Tuesday 9 February, 14:00")).toBeInTheDocument();
    expect(screen.queryByText(/London/)).not.toBeInTheDocument();
    expect(screen.getByText(`We'll call you on ${MOBILE}.`)).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(`Done — ${BOOKED.line}.`);
    expect(screen.getByRole("link", { name: "Go to my matches" })).toHaveAttribute("href", NEXT);
  });

  it("booked: the tick, You're booked, one primary button onward, Change time and Cancel as text links", async () => {
    page(BOOKED_VIEW);
    expect(await youreBooked()).toBeInTheDocument();
    const onward = screen.getByRole("link", { name: "Go to my matches" });
    expect(onward.className).toContain("bg-violet-500");
    expect(screen.getByRole("button", { name: "Change time" }).className).toContain("text-slate-500");
    expect(screen.getByRole("button", { name: "Cancel" }).className).toContain("text-slate-500");
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("booked with no number on file: no 'We'll call you on' line", async () => {
    page({ ...BOOKED_VIEW, mobile: null });
    await youreBooked();
    expect(screen.queryByText(/We'll call you on/)).not.toBeInTheDocument();
  });

  it("booked, at or after the start: the booking and no buttons but onward", async () => {
    page({ kind: "booked", booking: { ...BOOKED, changeable: false }, days: DAYS, mobile: MOBILE, needsPosition: false });
    expect(await youreBooked()).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Change time" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Cancel" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Go to my matches" })).toBeInTheDocument();
  });

  it("after a no-answer: 'We tried to call you — pick another time', with the picker", () => {
    page({ kind: "pick", afterNoAnswer: true, days: DAYS, mobile: null, needsPosition: false });
    expect(screen.getByText("We tried to call you — pick another time")).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Tue 9 Feb" })).toBeInTheDocument();
  });

  it("no times: the §0.13 line, and Skip for now", () => {
    page({ kind: "pick", afterNoAnswer: false, days: [], mobile: null, needsPosition: false });
    expect(screen.getByText("No times free right now — we'll still call you for your Complimentary matchmaker call.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Skip for now" })).toBeInTheDocument();
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
    expect(await screen.findByRole("radio", { name: "Tue 9 Feb" })).toBeInTheDocument();
  });

  it("a reload that finds her booked (another tab) shows the booking", async () => {
    const user = userEvent.setup();
    h.reload.mockResolvedValueOnce({ ok: true, value: BOOKED_VIEW });
    page({ kind: "load_failed" });
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await youreBooked()).toBeInTheDocument();
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

describe("onward, labelled by where it goes (W5)", () => {
  it.each([
    [NEXT, "Go to my matches"],
    ["/parent?t=childcare", "Go to my childcare"],
    ["/parent", "Go to my dashboard"],
  ])("next %s → '%s'", async (next, label) => {
    page(BOOKED_VIEW, next);
    expect(await screen.findByRole("link", { name: label })).toHaveAttribute("href", next);
  });
});

describe("change and cancel", () => {
  it("Change time: her booking stays on top, the picker underneath; Keep my time goes back", async () => {
    const user = userEvent.setup();
    h.reload.mockResolvedValueOnce({ ok: true, value: BOOKED_VIEW });
    page({ ...BOOKED_VIEW, days: null });
    await user.click(screen.getByRole("button", { name: "Change time" }));
    expect(await screen.findByRole("radio", { name: "Tue 9 Feb" })).toBeInTheDocument();
    expect(screen.getByText(BOOKED.yourCall)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Keep my time" }));
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(await youreBooked()).toBeInTheDocument();
  });

  it("?change=1 opens straight into picking a new time for her booking: only the days, nothing chosen (W15)", async () => {
    page(BOOKED_VIEW, NEXT, true);
    expect(screen.getByText(BOOKED.yourCall)).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "Tue 9 Feb" })).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByRole("radiogroup", { name: "Time of day" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Keep my time" })).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "Skip for now" })).not.toBeInTheDocument();
    expect(h.reload).not.toHaveBeenCalled();
  });

  it("?change=1 with no booking: just picking", () => {
    page(PICK, NEXT, true);
    expect(screen.getByRole("link", { name: "Skip for now" })).toBeInTheDocument();
  });

  it("Cancel asks first; Keep it keeps it; Yes, cancel it cancels and shows the fresh view", async () => {
    const user = userEvent.setup();
    h.cancel.mockResolvedValueOnce({ ok: true, value: PICK });
    page(BOOKED_VIEW);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Keep it" }));
    expect(h.cancel).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Yes, cancel it" }));
    expect(h.cancel).toHaveBeenCalledWith("b-1");
    expect(await screen.findByRole("radio", { name: "Tue 9 Feb" })).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent("Your call is cancelled");
  });

  it.each([
    ["rate_limited", "Too many changes — try again in a while"],
    ["error", "We couldn't do that — try again"],
  ])("a refused cancel (%s): the booking stays, the alert takes focus", async (error, message) => {
    const user = userEvent.setup();
    h.cancel.mockResolvedValueOnce({ ok: false, error });
    page(BOOKED_VIEW);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Yes, cancel it" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(message);
    expect(alert).toHaveFocus();
    expect(screen.getByText("Tuesday 9 February, 14:00")).toBeInTheDocument();
  });

  it("a move: the same booking moves, and the booked slide shows the new time", async () => {
    const user = userEvent.setup();
    // Her old time (16:00) is not in the list (it is hers, so not free); she moves to 14:00.
    const OLD: BookedCallView = { ...BOOKED, startsAt: "2027-02-09T16:00:00.000Z", when: "Tuesday 9 February, 16:00", yourCall: "Your call: old" };
    h.reload.mockResolvedValueOnce({ ok: true, value: { ...BOOKED_VIEW, booking: OLD } });
    h.confirm.mockResolvedValueOnce({ ok: true, value: { bookingId: "b-1", moved: true, replay: false, booking: BOOKED } });
    page({ ...BOOKED_VIEW, booking: OLD });
    await user.click(screen.getByRole("button", { name: "Change time" }));
    await pickTue14(user);
    await user.click(await screen.findByRole("button", { name: "Confirm time" }));
    expect(await youreBooked()).toBeInTheDocument();
    expect(screen.getByText("Tuesday 9 February, 14:00")).toBeInTheDocument();
    expect(screen.queryByText("Tuesday 9 February, 16:00")).not.toBeInTheDocument();
  });
});

describe("a rejected or refused action never sticks (review F1, F2)", () => {
  const boom = () => Promise.reject(new Error("network"));

  it("Change time rejecting: no skeleton, the booking stays on top, the picker says the times couldn't load", async () => {
    const user = userEvent.setup();
    h.reload.mockImplementationOnce(boom);
    page(BOOKED_VIEW);
    await user.click(screen.getByRole("button", { name: "Change time" }));
    expect(await screen.findByText("We couldn't load the times — we'll still call you for your Complimentary matchmaker call")).toBeInTheDocument();
    expect(screen.queryByTestId("call-page-loading")).not.toBeInTheDocument();
    expect(screen.getByText(BOOKED.yourCall)).toBeInTheDocument();
  });

  it("Change time refused: the same — the booking stays, the days are gone, Retry offered", async () => {
    const user = userEvent.setup();
    h.reload.mockResolvedValueOnce({ ok: false, error: "error" });
    page(BOOKED_VIEW);
    await user.click(screen.getByRole("button", { name: "Change time" }));
    expect(await screen.findByRole("button", { name: "Retry" })).toBeEnabled();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    expect(screen.getByText(BOOKED.yourCall)).toBeInTheDocument();
  });

  it("a refused reload while picking: the load-failed line replaces the stale days", async () => {
    const user = userEvent.setup();
    h.hold.mockResolvedValueOnce({ ok: false, error: "invalid" });
    h.reload.mockResolvedValueOnce({ ok: false, error: "error" });
    page(PICK);
    await pickTue14(user);
    expect(await screen.findByText("We couldn't load the times — we'll still call you for your Complimentary matchmaker call")).toBeInTheDocument();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
  });

  it("Cancel rejecting: the alert, the booking and its links stay, nothing pending", async () => {
    const user = userEvent.setup();
    h.cancel.mockImplementationOnce(boom);
    page(BOOKED_VIEW);
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await user.click(screen.getByRole("button", { name: "Yes, cancel it" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't do that — try again");
    expect(screen.getByRole("button", { name: "Change time" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Cancel" })).toBeEnabled();
  });
});

describe("a parent with no position yet (W11: the quick-match sign-up, the card, the email link)", () => {
  it("picking a time holds nothing; 'Complete my childcare position' carries the time to her position form", async () => {
    const user = userEvent.setup();
    page({ ...PICK, needsPosition: true }, "/parent?t=childcare");
    await pickTue14(user);
    expect(h.hold).not.toHaveBeenCalled();
    expect(screen.getByText("Complete your childcare position so that we can confirm your call with your matchmaker.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Complete my childcare position" })).toHaveAttribute("href", `/parent/request?callAt=${encodeURIComponent(TUE_14)}`);
    expect(screen.getByRole("link", { name: "Skip for now" })).toHaveAttribute("href", "/parent?t=childcare");
  });
});

describe("review fixes: one live region, and focus after the state changes", () => {
  it("the status region is one node for the panel's life (booking and cancelling announce into it)", async () => {
    const user = userEvent.setup();
    page(PICK);
    const region = screen.getByRole("status", { name: "" });
    await pickTue14(user);
    await user.click(await screen.findByRole("button", { name: "Confirm time" }));
    await youreBooked();
    expect(screen.getAllByRole("status").includes(region)).toBe(true);
    expect(region).toHaveTextContent(`Done — ${BOOKED.line}.`);
  });

  it("after booking, focus moves to 'You're booked' (Confirm is gone)", async () => {
    const user = userEvent.setup();
    page(PICK);
    await pickTue14(user);
    await user.click(await screen.findByRole("button", { name: "Confirm time" }));
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "You're booked" })).toHaveFocus());
  });

  it("a second refused cancel with the same line still takes focus (the line clears when a cancel starts)", async () => {
    const user = userEvent.setup();
    h.cancel.mockResolvedValue({ ok: false, error: "error" });
    page(BOOKED_VIEW);
    for (let n = 0; n < 2; n += 1) {
      await user.click(screen.getByRole("button", { name: "Cancel" }));
      await user.click(screen.getByRole("button", { name: "Yes, cancel it" }));
      await waitFor(() => expect(screen.getByRole("alert")).toHaveFocus());
      (document.activeElement as HTMLElement).blur();
    }
    expect(h.cancel).toHaveBeenCalledTimes(2);
  });
});

describe("no 'London time' shown to her anywhere on the slide (W14, BAI: \"this is just a given\")", () => {
  it.each([
    ["picking", PICK],
    ["booked", BOOKED_VIEW],
    ["changing", BOOKED_VIEW],
  ])("%s: no 'London' in the text or the accessible names", async (state, view) => {
    const user = userEvent.setup();
    page(view, NEXT, state === "changing");
    if (state === "picking") await pickTue14(user);
    await screen.findAllByRole("heading");
    expect(document.body.innerHTML).not.toMatch(/London/);
  });
});
