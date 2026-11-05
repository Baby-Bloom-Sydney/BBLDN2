/**
 * The call inside the app is a popup over her Childcare tab (04b rework W12; BAI 2026-11-05: "the version from inside
 * the app should be a popup (without a close button, they would tap outside of the rounded rectangle pop up to close
 * the pop up) not a seperate page or slide"; "this pop up would also display their current booking for ammendments").
 *
 * It opens from the card (in place, no navigation) and from the hub's `call` param (open / booked / gone). No close
 * (X) button; a tap outside or Escape closes it and clears the param. The button row is the primary button alone (no
 * Skip, no Keep my time). With a booking it shows "Your call: …" on top with Change time and Cancel; changing keeps it
 * on top and marks her slot; confirming moves the same booking and shows the new time.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BookedCallView, MyCallView } from "@/lib/calls/parent-view";
import { DAYS, TUE_14, TUE_15, gridDays } from "./slot-picker.fixtures.test-util";

const h = vi.hoisted(() => ({ hold: vi.fn(), confirm: vi.fn(), cancel: vi.fn(), reload: vi.fn(), replace: vi.fn(), search: "t=childcare" }));
vi.mock("@/app/(funnel)/matchmaking/call/actions", () => ({
  holdMyCallSlot: h.hold,
  confirmMyCallHold: h.confirm,
  cancelMyCall: h.cancel,
  reloadMyCallSlots: h.reload,
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: h.replace }),
  usePathname: () => "/parent",
  useSearchParams: () => new URLSearchParams(h.search),
}));

import { ChildcareCall } from "./ChildcareCall";

const BOOKED: BookedCallView = {
  bookingId: "b-1",
  startsAt: TUE_15,
  line: "Your Complimentary matchmaker call is on Tuesday 9 February at 15:00",
  when: "Tuesday 9 February, 15:00",
  yourCall: "Your call: Tuesday 9 February at 15:00",
  changeable: true,
};
const MOVED: BookedCallView = { ...BOOKED, startsAt: TUE_14, when: "Tuesday 9 February, 14:00", yourCall: "Your call: Tuesday 9 February at 14:00" };
const PICK: MyCallView = { kind: "pick", afterNoAnswer: false, days: DAYS, mobile: "07700 900123", needsPosition: false };
const BOOKED_VIEW: MyCallView = { kind: "booked", booking: BOOKED, days: gridDays({ [TUE_15]: false }), mobile: "07700 900123", needsPosition: false };
const HOLD = { holdId: "h-1", startsAt: TUE_14, line: "Your time is being reserved for 5 minutes" };

const popup = () => screen.findByRole("dialog", { name: /Complimentary matchmaker call|You're booked/ });

beforeEach(() => {
  for (const fn of [h.hold, h.confirm, h.cancel, h.reload, h.replace]) fn.mockReset();
  h.search = "t=childcare";
  h.reload.mockResolvedValue({ ok: true, value: PICK });
  h.hold.mockResolvedValue({ ok: true, value: HOLD });
  h.confirm.mockResolvedValue({ ok: true, value: { bookingId: "b-1", moved: true, replay: false, booking: MOVED } });
});
afterEach(() => vi.restoreAllMocks());

describe("ChildcareCall — opening", () => {
  it("call=open: the popup over the tab, the picker, no close (X), and no Skip or Keep my time — Confirm alone", async () => {
    h.search = "t=childcare&call=open";
    render(<ChildcareCall card={null} openWith="open" goneWhen={null} failed={false} />);
    const dialog = await popup();
    expect(dialog.className).toContain("rounded-2xl");
    expect(dialog.className).toContain("max-h-[80dvh]"); // W16 (was 90dvh)
    expect(await within(dialog).findByRole("radio", { name: "Tue 9 Feb" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("link", { name: "Skip for now" })).not.toBeInTheDocument();
    expect(within(dialog).queryByRole("button", { name: "Keep my time" })).not.toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Confirm time" })).toBeInTheDocument();
  });

  it("call=booked: You're booked, her call on top, Change time and Cancel — no onward button", async () => {
    h.reload.mockResolvedValue({ ok: true, value: BOOKED_VIEW });
    render(<ChildcareCall card={null} openWith="booked" goneWhen={null} failed={false} />);
    const dialog = await screen.findByRole("dialog", { name: "You're booked" });
    expect(within(dialog).getByText(BOOKED.yourCall)).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Change time" })).toBeInTheDocument();
    expect(within(dialog).getByRole("button", { name: "Cancel" })).toBeInTheDocument();
    expect(within(dialog).queryByRole("link")).not.toBeInTheDocument();
  });

  it("call=gone: the picker with the taken notice; closing the notice keeps the popup open", async () => {
    const user = userEvent.setup();
    render(<ChildcareCall card={null} openWith="gone" goneWhen="Tuesday 9 February at 14:00" failed={false} />);
    const notice = await screen.findByRole("dialog", { name: "This time has just been booked" });
    expect(notice).toHaveTextContent("Someone else booked Tuesday 9 February at 14:00 a moment ago. Please pick another time.");
    await user.click(within(notice).getByRole("button", { name: "Pick another time" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "This time has just been booked" })).not.toBeInTheDocument());
    expect(await popup()).toBeInTheDocument();
    expect(h.replace).not.toHaveBeenCalled();
  });

  it("the card's Book a time opens it in place (no navigation)", async () => {
    const user = userEvent.setup();
    render(<ChildcareCall card={{ kind: "not_booked", afterNoAnswer: false }} openWith={null} goneWhen={null} failed={false} />);
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Book a time" }));
    expect(await within(await popup()).findByRole("radio", { name: "Tue 9 Feb" })).toBeInTheDocument();
    expect(h.replace).not.toHaveBeenCalled();
  });

  it("the card's Change time opens straight into changing: her booking on top, only the days (W15); her time marked as hers", async () => {
    const user = userEvent.setup();
    h.reload.mockResolvedValue({ ok: true, value: BOOKED_VIEW });
    render(<ChildcareCall card={{ kind: "booked", line: "Tue 9 Feb, 15:00", changeable: true }} openWith={null} goneWhen={null} failed={false} />);
    await user.click(screen.getByRole("button", { name: "Change time" }));
    const dialog = await popup();
    expect(await within(dialog).findByText(BOOKED.yourCall)).toBeInTheDocument();
    expect(within(dialog).getAllByRole("radiogroup")).toHaveLength(1);
    await user.click(within(dialog).getByRole("radio", { name: "Tue 9 Feb" }));
    await user.click(within(dialog).getByRole("radio", { name: /^Afternoon / }));
    expect(within(dialog).getByRole("radio", { name: "Tuesday 9 February, 15:00 — your current time" })).toHaveAttribute("aria-checked", "true");
  });

  it("no param and no card → nothing at all", () => {
    const { container } = render(<ChildcareCall card={null} openWith={null} goneWhen={null} failed={false} />);
    expect(container.innerHTML).toBe("");
  });

  it("a skeleton while her view loads; a failed load → the load-failed line", async () => {
    let finish: (v: unknown) => void = () => {};
    h.reload.mockReturnValueOnce(new Promise((resolve) => (finish = resolve)));
    render(<ChildcareCall card={null} openWith="open" goneWhen={null} failed={false} />);
    expect(await screen.findByTestId("call-popup-loading")).toBeInTheDocument();
    finish({ ok: false, error: "error" });
    expect(await screen.findByText("We couldn't load the times — we'll still call you for your Complimentary matchmaker call")).toBeInTheDocument();
  });
});

describe("ChildcareCall — closing (a tap outside or Escape; the param cleared)", () => {
  it("a tap outside the rounded rectangle closes it and clears call= (router.replace, so a refresh doesn't reopen it)", async () => {
    const user = userEvent.setup();
    h.search = "t=childcare&call=open";
    render(<ChildcareCall card={null} openWith="open" goneWhen={null} failed={false} />);
    await popup();
    const overlay = document.querySelector<HTMLElement>("[data-call-popup-overlay], .bg-black\\/80");
    expect(overlay).not.toBeNull();
    await user.click(overlay as HTMLElement);
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.replace).toHaveBeenCalledWith("/parent?t=childcare", { scroll: false });
  });

  it("Escape closes it too, and clears call= and at=", async () => {
    const user = userEvent.setup();
    h.search = "t=childcare&call=gone&at=2027-02-09T14%3A00%3A00.000Z";
    render(<ChildcareCall card={null} openWith="open" goneWhen={null} failed={false} />);
    await popup();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.replace).toHaveBeenCalledWith("/parent?t=childcare", { scroll: false });
  });

  it("opened from the card: closing leaves the URL alone", async () => {
    const user = userEvent.setup();
    render(<ChildcareCall card={{ kind: "not_booked", afterNoAnswer: false }} openWith={null} goneWhen={null} failed={false} />);
    await user.click(screen.getByRole("button", { name: "Book a time" }));
    await popup();
    await user.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(h.replace).not.toHaveBeenCalled();
  });
});

describe("ChildcareCall — her booking, for changes (BAI 2026-11-05)", () => {
  it("Change time inside the popup: her call stays on top; confirming moves the same booking and shows the new time", async () => {
    const user = userEvent.setup();
    h.reload.mockResolvedValue({ ok: true, value: BOOKED_VIEW });
    render(<ChildcareCall card={null} openWith="booked" goneWhen={null} failed={false} />);
    const dialog = await screen.findByRole("dialog", { name: "You're booked" });
    await user.click(within(dialog).getByRole("button", { name: "Change time" }));
    const picking = await popup();
    expect(within(picking).getByText(BOOKED.yourCall)).toBeInTheDocument();
    await user.click(await within(picking).findByRole("radio", { name: "Tue 9 Feb" }));
    await user.click(within(picking).getByRole("radio", { name: /^Afternoon / }));
    await user.click(within(picking).getByRole("radio", { name: "Tuesday 9 February, 14:00" }));
    await user.click(await within(picking).findByRole("button", { name: "Confirm time" }));
    const booked = await screen.findByRole("dialog", { name: "You're booked" });
    expect(within(booked).getByText(MOVED.yourCall)).toBeInTheDocument();
    expect(within(booked).queryByText(BOOKED.yourCall)).not.toBeInTheDocument();
    expect(h.confirm).toHaveBeenCalledTimes(1);
    expect(h.cancel).not.toHaveBeenCalled();
  });

  it("no position yet: the line and 'Confirm time' to her position form (nothing held), primary alone (W15)", async () => {
    const user = userEvent.setup();
    h.reload.mockResolvedValue({ ok: true, value: { ...PICK, needsPosition: true } });
    render(<ChildcareCall card={null} openWith="open" goneWhen={null} failed={false} />);
    const dialog = await popup();
    await user.click(await within(dialog).findByRole("radio", { name: "Tue 9 Feb" }));
    await user.click(within(dialog).getByRole("radio", { name: /^Afternoon / }));
    await user.click(within(dialog).getByRole("radio", { name: "Tuesday 9 February, 14:00" }));
    expect(h.hold).not.toHaveBeenCalled();
    expect(within(dialog).getByText("Complete your childcare position so that we can confirm your call with your matchmaker.")).toBeInTheDocument();
    expect(within(dialog).getByRole("link", { name: "Confirm time" })).toHaveAttribute(
      "href",
      `/parent/request?callAt=${encodeURIComponent(TUE_14)}`,
    );
    expect(within(dialog).queryByRole("link", { name: "Skip for now" })).not.toBeInTheDocument();
  });
});

describe("the popup leaves a dimmed strip to tap out of, on every side of a phone (W16)", () => {
  it("at most 80dvh tall and 1rem in from each side, still at most max-w-md", async () => {
    h.reload.mockResolvedValue({ ok: true, value: PICK });
    render(<ChildcareCall card={null} openWith="open" goneWhen={null} failed={false} />);
    const dialog = await popup();
    expect(dialog.className).toContain("max-h-[80dvh]");
    expect(dialog.className).not.toContain("90dvh");
    expect(dialog.className).toContain("w-[calc(100%-2rem)]");
    expect(dialog.className).toContain("max-w-md");
    expect(dialog.className.split(/\s+/)).not.toContain("w-full");
  });
});

describe("no 'London time' in the popup or on the card (W14)", () => {
  it("booked popup, picking popup and the card say no 'London'", async () => {
    const user = userEvent.setup();
    h.reload.mockResolvedValue({ ok: true, value: BOOKED_VIEW });
    render(<ChildcareCall card={{ kind: "booked", line: "Tue 9 Feb, 15:00", changeable: true }} openWith={null} goneWhen={null} failed={false} />);
    expect(document.body.innerHTML).not.toMatch(/London/);
    await user.click(screen.getByRole("button", { name: "Change time" }));
    await within(await popup()).findByText(BOOKED.yourCall);
    expect(document.body.innerHTML).not.toMatch(/London/);
  });
});

describe("React re-review fixes (the popup)", () => {
  it("MEDIUM: the taken notice shows once — not again after she books and then changes her time", async () => {
    const user = userEvent.setup();
    h.confirm.mockResolvedValue({ ok: true, value: { bookingId: "b-1", moved: false, replay: false, booking: MOVED } });
    render(<ChildcareCall card={null} openWith="gone" goneWhen="Tuesday 9 February at 14:00" failed={false} />);
    const notice = await screen.findByRole("dialog", { name: "This time has just been booked" });
    await user.click(within(notice).getByRole("button", { name: "Pick another time" }));
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "This time has just been booked" })).not.toBeInTheDocument());
    const dialog = await popup();
    await user.click(await within(dialog).findByRole("radio", { name: "Tue 9 Feb" }));
    await user.click(within(dialog).getByRole("radio", { name: /^Afternoon / }));
    await user.click(within(dialog).getByRole("radio", { name: "Tuesday 9 February, 14:00" }));
    await user.click(await within(dialog).findByRole("button", { name: "Confirm time" }));
    const booked = await screen.findByRole("dialog", { name: "You're booked" });
    h.reload.mockResolvedValue({ ok: true, value: { ...BOOKED_VIEW, booking: MOVED } });
    await user.click(within(booked).getByRole("button", { name: "Change time" }));
    await popup();
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(screen.queryByRole("dialog", { name: "This time has just been booked" })).not.toBeInTheDocument();
  });

  it("LOW: the popup and the notice stop animating under reduced motion (only these two dialogs)", async () => {
    render(<ChildcareCall card={null} openWith="gone" goneWhen="Tuesday 9 February at 14:00" failed={false} />);
    const notice = await screen.findByRole("dialog", { name: "This time has just been booked" });
    expect(notice.className).toContain("motion-reduce:animate-none");
    // The popup sits under the open notice (hidden from the accessibility tree meanwhile): both dialogs, by role.
    await waitFor(() => expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(2));
    for (const dialog of document.querySelectorAll('[role="dialog"]')) expect(dialog.className).toContain("motion-reduce:animate-none");
  });
});

describe("TS review: a booking that failed for any reason but taken (call=open&failed=1)", () => {
  it("the popup opens on the picker with 04b's inline line, not the taken notice", async () => {
    render(<ChildcareCall card={null} openWith="open" goneWhen={null} failed />);
    const dialog = await popup();
    expect(await within(dialog).findByRole("alert")).toHaveTextContent("We couldn't do that — try again");
    expect(screen.queryByRole("dialog", { name: "This time has just been booked" })).not.toBeInTheDocument();
  });
});
