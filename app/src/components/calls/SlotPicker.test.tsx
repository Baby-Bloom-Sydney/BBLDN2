/**
 * SlotPicker (plan B6; brief §2 picker semantics, §3 parent 2–3; 04b rework W4). Since BAI 2026-11-05 it is the
 * meet-and-greet picker's look (`ScheduleTimeGrid`): dates × time-of-day cells, then "Select a time", the green panel
 * and the two-button row. 04b's intents carried over:
 *  - radiogroups (one per day row, one for the time box); every option named in full with "(London time)";
 *  - arrow keys move between open cells/times and never hold; a tap (or Space) on a free time holds it at once;
 *  - Confirm takes focus only once nothing is in flight; Confirm writes with the hold;
 *  - a refusal never sticks (throws settle); a failed confirm reloads (a lost reply may have booked);
 *  - the no-times and load-failed states with Retry; a skeleton while the list reloads; reduced motion respected.
 * New (BAI 2026-11-05): unavailable days and times are greyed and can't be chosen, never hidden; a time taken by
 * someone else opens the "This time has just been booked" notice while the list refreshes.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { actionsWith, DAYS, gridDays, HOLD, TUE_09, TUE_14, TUE_1430, TUE_15, WED_09 } from "./slot-picker.fixtures.test-util";
import { SlotPicker } from "./SlotPicker";

const cell = (legend: string, bracket: string) => screen.getByRole("radio", { name: `${legend}, ${bracket} (London time)` });
const tueAfternoon = () => cell("Tuesday 9 February", "Afternoon");
const time = (name: string) => screen.getByRole("radio", { name });
const tue14 = () => time("Tuesday 9 February, 14:00 (London time)");
const confirmButton = () => screen.getByRole("button", { name: "Confirm time" });
const NOTICE = "Someone else booked Tuesday 9 February at 14:00 a moment ago. Please pick another time.";

async function holdTue14(user: ReturnType<typeof userEvent.setup>) {
  await user.click(tueAfternoon());
  await user.click(tue14());
}

describe("SlotPicker — the grid, in the meet-and-greet picker's look", () => {
  it("the Calendar header, one radiogroup per date, four time-of-day cells each, Confirm disabled", () => {
    render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Your matchmaker's availability (London time)" })).toBeInTheDocument();
    const rows = screen.getAllByRole("radiogroup");
    expect(rows.map((r) => r.getAttribute("aria-label"))).toEqual(["Tuesday 9 February", "Wednesday 10 February", "Thursday 11 February"]);
    expect(within(rows[0]).getAllByRole("radio").map((r) => r.getAttribute("aria-label"))).toEqual([
      "Tuesday 9 February, Morning (London time)",
      "Tuesday 9 February, Midday (London time)",
      "Tuesday 9 February, Afternoon (London time)",
      "Tuesday 9 February, Evening (London time)",
    ]);
    expect(within(rows[0]).getByText("Tue")).toBeInTheDocument();
    expect(within(rows[0]).getByText("9 Feb")).toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
    expect(screen.queryByRole("link", { name: "Skip for now" })).not.toBeInTheDocument();
  });

  it("an open cell is violet; a bracket with no free time is greyed and disabled", () => {
    render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />);
    expect(tueAfternoon()).toBeEnabled();
    expect(tueAfternoon().className).toContain("bg-violet-50");
    const midday = cell("Tuesday 9 February", "Midday");
    expect(midday).toBeDisabled();
    expect(midday.className).toContain("bg-slate-50 text-slate-200 border-slate-100 cursor-not-allowed");
  });

  it("a day with no free time is shown, fully greyed: label slate-300, every cell disabled", () => {
    render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />);
    const thursday = screen.getByRole("radiogroup", { name: "Thursday 11 February" });
    for (const c of within(thursday).getAllByRole("radio")) expect(c).toBeDisabled();
    expect(within(thursday).getByText("Thu").className).toContain("text-slate-300");
  });

  it("a cell opens 'Select a time' with every slot in it — the ones not free greyed, disabled and aria-disabled", async () => {
    const user = userEvent.setup();
    const actions = actionsWith();
    render(<SlotPicker days={DAYS} actions={actions} onConfirmed={vi.fn()} />);
    await user.click(tueAfternoon());
    expect(tueAfternoon()).toHaveAttribute("aria-checked", "true");
    expect(tueAfternoon()).toHaveTextContent("✓");
    const box = screen.getByRole("radiogroup", { name: "Select a time" });
    expect(within(box).getAllByRole("radio").map((r) => r.textContent)).toEqual(["14:00", "14:30", "15:00"]);
    const t15 = time("Tuesday 9 February, 15:00 (London time)");
    expect(t15).toBeDisabled();
    expect(t15).toHaveAttribute("aria-disabled", "true");
    expect(t15.className).toContain("bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed");
    await user.click(t15);
    expect(actions.hold).not.toHaveBeenCalled();
    expect(screen.getByText("14:00").closest("time")).toHaveAttribute("dateTime", TUE_14);
  });

  it("respects prefers-reduced-motion", async () => {
    const user = userEvent.setup();
    render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />);
    expect(tueAfternoon().className).toContain("motion-reduce:transition-none");
    await user.click(tueAfternoon());
    expect(tue14().className).toContain("motion-reduce:transition-none");
  });

  it("a single day (03's pre-book) is one row", () => {
    const one = gridDays().slice(0, 1);
    render(<SlotPicker days={one} actions={actionsWith()} onConfirmed={vi.fn()} />);
    expect(screen.getAllByRole("radiogroup")).toHaveLength(1);
  });

  it("Skip for now is the left button when given a link onward", () => {
    render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} skipHref="/parent?t=childcare" />);
    expect(screen.getByRole("link", { name: "Skip for now" })).toHaveAttribute("href", "/parent?t=childcare");
  });
});

describe("SlotPicker — keyboard", () => {
  it("arrows move between open cells only (greyed skipped, a greyed day never landed on), and never choose", async () => {
    const user = userEvent.setup();
    render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />);
    const morning = cell("Tuesday 9 February", "Morning");
    morning.focus();
    await user.keyboard("{ArrowRight}");
    expect(tueAfternoon()).toHaveFocus();
    expect(tueAfternoon()).toHaveAttribute("aria-checked", "false");
    morning.focus();
    await user.keyboard("{ArrowDown}");
    expect(cell("Wednesday 10 February", "Morning")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(cell("Wednesday 10 February", "Morning")).toHaveFocus();
  });

  it("in the time box arrows skip a greyed time and never hold; Space holds the focused one", async () => {
    const user = userEvent.setup();
    const actions = actionsWith();
    render(<SlotPicker days={DAYS} actions={actions} onConfirmed={vi.fn()} />);
    await user.click(tueAfternoon());
    tue14().focus();
    await user.keyboard("{ArrowRight}");
    expect(time("Tuesday 9 February, 14:30 (London time)")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(tue14()).toHaveFocus();
    expect(actions.hold).not.toHaveBeenCalled();
    await user.keyboard(" ");
    expect(actions.hold).toHaveBeenCalledWith(TUE_14);
  });

  it("each row is one tab stop (Tab moves between days, as 04b's did)", () => {
    render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />);
    const stops = screen.getAllByRole("radio").filter((r) => r.getAttribute("tabindex") === "0");
    expect(stops.map((r) => r.getAttribute("aria-label"))).toEqual(["Tuesday 9 February, Morning (London time)", "Wednesday 10 February, Morning (London time)"]);
  });
});

describe("SlotPicker — hold and confirm", () => {
  it("a tap on a free time holds it at once: the green panel names it with the hold line, Confirm takes focus", async () => {
    const user = userEvent.setup();
    const actions = actionsWith();
    const onConfirmed = vi.fn();
    render(<SlotPicker days={DAYS} actions={actions} onConfirmed={onConfirmed} />);
    await holdTue14(user);
    expect(actions.hold).toHaveBeenCalledWith(TUE_14);
    expect(await screen.findByText("Tuesday 9 February at 14:00")).toBeInTheDocument();
    expect(screen.getByText(HOLD.line)).toBeInTheDocument();
    expect(tue14()).toHaveAttribute("aria-checked", "true");
    await waitFor(() => expect(confirmButton()).toHaveFocus());
    await user.click(confirmButton());
    expect(actions.confirm).toHaveBeenCalledWith(expect.objectContaining({ startsAt: TUE_14 }));
    expect(onConfirmed).toHaveBeenCalledWith("booked");
  });

  it("while confirming: 'Confirming...' and nothing else can be pressed", async () => {
    const user = userEvent.setup();
    let finish: (v: { ok: true; value: string }) => void = () => {};
    const actions = actionsWith({ confirm: vi.fn(() => new Promise<{ ok: true; value: string }>((resolve) => (finish = resolve))) });
    render(<SlotPicker days={DAYS} actions={actions} onConfirmed={vi.fn()} />);
    await holdTue14(user);
    await user.click(await screen.findByRole("button", { name: "Confirm time" }));
    expect(screen.getByRole("button", { name: "Confirming..." })).toBeDisabled();
    expect(time("Tuesday 9 February, 14:30 (London time)")).toBeDisabled();
    finish({ ok: true, value: "booked" });
    await waitFor(() => expect(screen.queryByText("Confirming...")).not.toBeInTheDocument());
  });

  it("tapping another time holds that one (her own hold is replaced by the server, nothing released first)", async () => {
    const user = userEvent.setup();
    const actions = actionsWith();
    render(<SlotPicker days={DAYS} actions={actions} onConfirmed={vi.fn()} />);
    await holdTue14(user);
    await screen.findByText("Tuesday 9 February at 14:00");
    await user.click(time("Tuesday 9 February, 14:30 (London time)"));
    expect(actions.hold).toHaveBeenLastCalledWith(TUE_1430);
    expect(await screen.findByText("Tuesday 9 February at 14:30")).toBeInTheDocument();
    expect(actions.hold).toHaveBeenCalledTimes(2);
  });

  it("changing: her booked time's cell opens with her time chosen until she picks another; Keep my time", async () => {
    const user = userEvent.setup();
    const keep = vi.fn();
    const days = gridDays({ [TUE_15]: false });
    render(<SlotPicker days={days} actions={actionsWith()} onConfirmed={vi.fn()} current={TUE_15} onKeepTime={keep} />);
    expect(tueAfternoon()).toHaveAttribute("aria-checked", "true");
    expect(time("Tuesday 9 February, 15:00 (London time)")).toHaveAttribute("aria-checked", "true");
    await user.click(tue14());
    expect(time("Tuesday 9 February, 15:00 (London time)")).toHaveAttribute("aria-checked", "false");
    await user.click(screen.getByRole("button", { name: "Keep my time" }));
    expect(keep).toHaveBeenCalled();
  });
});

describe("SlotPicker — taken by someone else: the notice (BAI 2026-11-05)", () => {
  it("a taken hold: the notice (its button focused), the list refreshes, the time is greyed; no inline alert", async () => {
    const user = userEvent.setup();
    const actions = actionsWith({ hold: vi.fn(async () => ({ ok: false as const, error: "taken" })) });
    render(<SlotPicker days={DAYS} actions={actions} onConfirmed={vi.fn()} />);
    await holdTue14(user);
    const notice = await screen.findByRole("dialog", { name: "This time has just been booked" });
    expect(notice).toHaveTextContent(NOTICE);
    expect(within(notice).queryByRole("button", { name: "Close" })).not.toBeInTheDocument();
    await waitFor(() => expect(within(notice).getByRole("button", { name: "Pick another time" })).toHaveFocus());
    expect(actions.reload).toHaveBeenCalled();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    await user.click(within(notice).getByRole("button", { name: "Pick another time" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(screen.getByRole("radio", { name: /14:00 \(London time\) — no longer available/ })).toBeDisabled();
    await waitFor(() => expect(document.activeElement?.getAttribute("role")).toBe("radio"));
  });

  it("a taken confirm: the notice, and the list refreshes", async () => {
    const user = userEvent.setup();
    const actions = actionsWith({ confirm: vi.fn(async () => ({ ok: false as const, error: "taken" })) });
    render(<SlotPicker days={DAYS} actions={actions} onConfirmed={vi.fn()} />);
    await holdTue14(user);
    await user.click(await screen.findByRole("button", { name: "Confirm time" }));
    expect(await screen.findByRole("dialog", { name: "This time has just been booked" })).toHaveTextContent(NOTICE);
    expect(actions.reload).toHaveBeenCalled();
  });

  it("a held time that ran out and was taken: the notice too", async () => {
    const user = userEvent.setup();
    const actions = actionsWith({
      confirm: vi.fn(async () => ({ ok: false as const, error: "hold_expired" })),
      reload: vi.fn(async () => gridDays({ [TUE_14]: false })),
    });
    render(<SlotPicker days={DAYS} actions={actions} onConfirmed={vi.fn()} />);
    await holdTue14(user);
    await user.click(await screen.findByRole("button", { name: "Confirm time" }));
    expect(await screen.findByRole("dialog", { name: "This time has just been booked" })).toBeInTheDocument();
  });

  it("opened with a notice (a time chosen elsewhere has just gone)", async () => {
    render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} initialNotice="Tuesday 9 February at 14:00" />);
    expect(await screen.findByRole("dialog", { name: "This time has just been booked" })).toHaveTextContent(NOTICE);
  });
});

describe("SlotPicker — other refusals keep 04b's inline alert", () => {
  it("a hold that ran out but is still free: 'Your hold ran out — pick again', focused, refreshed", async () => {
    const user = userEvent.setup();
    const actions = actionsWith({
      confirm: vi.fn(async () => ({ ok: false as const, error: "hold_expired" })),
      reload: vi.fn(async () => gridDays()),
    });
    render(<SlotPicker days={DAYS} actions={actions} onConfirmed={vi.fn()} />);
    await holdTue14(user);
    await user.click(await screen.findByRole("button", { name: "Confirm time" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Your hold ran out — pick again");
    await waitFor(() => expect(alert).toHaveFocus());
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(actions.reload).toHaveBeenCalled();
  });

  it.each([
    ["rate_limited", "Too many changes — try again in a while"],
    ["error", "We couldn't do that — try again"],
  ])("%s → '%s'", async (error, message) => {
    const user = userEvent.setup();
    render(<SlotPicker days={DAYS} actions={actionsWith({ hold: vi.fn(async () => ({ ok: false as const, error })) })} onConfirmed={vi.fn()} />);
    await holdTue14(user);
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("an invalid refusal (a stale list) refreshes the list", async () => {
    const user = userEvent.setup();
    const actions = actionsWith({ hold: vi.fn(async () => ({ ok: false as const, error: "invalid" })) });
    render(<SlotPicker days={DAYS} actions={actions} onConfirmed={vi.fn()} />);
    await holdTue14(user);
    await screen.findByRole("alert");
    expect(actions.reload).toHaveBeenCalled();
  });
});

describe("SlotPicker — no times, failed, loading", () => {
  it("no free time in the whole window: the no-times line and Retry, no grid", async () => {
    const user = userEvent.setup();
    const actions = actionsWith();
    const none = gridDays({ [TUE_09]: false, [TUE_14]: false, [TUE_1430]: false, [WED_09]: false });
    render(<SlotPicker days={none} actions={actions} onConfirmed={vi.fn()} />);
    expect(screen.getByText("No times free right now — we'll still call you for your Complimentary matchmaker call.")).toBeInTheDocument();
    expect(screen.queryByRole("radiogroup")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(actions.reload).toHaveBeenCalled();
  });

  it("failed to load: the load-failed line and Retry", () => {
    render(<SlotPicker days={null} actions={actionsWith()} onConfirmed={vi.fn()} />);
    expect(screen.getByText("We couldn't load the times — we'll still call you for your Complimentary matchmaker call")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });

  it("a skeleton while the list reloads, then the days", async () => {
    const user = userEvent.setup();
    let finish: () => void = () => {};
    const actions = actionsWith({ reload: vi.fn(() => new Promise<void>((resolve) => (finish = resolve))) });
    render(<SlotPicker days={null} actions={actions} onConfirmed={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByTestId("slot-picker-loading")).toBeInTheDocument();
    expect(screen.getByRole("region", { busy: true })).toBeInTheDocument();
    finish();
    await waitFor(() => expect(screen.queryByTestId("slot-picker-loading")).not.toBeInTheDocument());
  });

  it("a chosen cell that is no longer open is greyed after a refresh", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />);
    await user.click(cell("Tuesday 9 February", "Morning"));
    expect(screen.getByRole("radiogroup", { name: "Select a time" })).toBeInTheDocument();
    rerender(<SlotPicker days={gridDays({ [TUE_09]: false })} actions={actionsWith()} onConfirmed={vi.fn()} />);
    expect(cell("Tuesday 9 February", "Morning")).toBeDisabled();
  });
});

describe("SlotPicker — reuse (04c on-behalf, 03 pre-book)", () => {
  it("two pickers on one page share no element ids", async () => {
    const user = userEvent.setup();
    render(
      <>
        <SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />
        <SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />
      </>,
    );
    const [first, second] = screen.getAllByRole("radio", { name: "Tuesday 9 February, Afternoon (London time)" });
    await user.click(first);
    await user.click(second);
    const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    const headings = screen.getAllByRole("region").map((r) => r.getAttribute("aria-labelledby"));
    expect(new Set(headings).size).toBe(2);
  });
});

describe("SlotPicker — a rejected action never sticks (review F1, F2)", () => {
  const boom = () => Promise.reject(new Error("network"));
  const idle = () => {
    expect(screen.getByRole("region")).toHaveAttribute("aria-busy", "false");
    expect(screen.queryByTestId("slot-picker-loading")).not.toBeInTheDocument();
  };

  it("a rejecting hold: 'We couldn't do that — try again', the times enabled, nothing busy", async () => {
    const user = userEvent.setup();
    render(<SlotPicker days={DAYS} actions={actionsWith({ hold: vi.fn(boom) })} onConfirmed={vi.fn()} />);
    await holdTue14(user);
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't do that — try again");
    expect(tue14()).toBeEnabled();
    idle();
  });

  it("a confirm that fails in transit refreshes the list once, so a booking that was written shows (re-review)", async () => {
    const user = userEvent.setup();
    const actions = actionsWith({ confirm: vi.fn(boom) });
    render(<SlotPicker days={DAYS} actions={actions} onConfirmed={vi.fn()} />);
    await holdTue14(user);
    await user.click(await screen.findByRole("button", { name: "Confirm time" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't do that — try again");
    expect(actions.reload).toHaveBeenCalledTimes(1);
    idle();
  });

  it("a rejecting reload: no skeleton left, the load-failed line with Retry", async () => {
    const user = userEvent.setup();
    render(<SlotPicker days={null} actions={actionsWith({ reload: vi.fn(boom) })} onConfirmed={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("We couldn't load the times — we'll still call you for your Complimentary matchmaker call")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    idle();
  });
});

describe("SlotPicker — a parent with no position yet (W11, BAI 2026-11-05)", () => {
  const gate = { href: (startsAt: string) => `/parent/request?callAt=${encodeURIComponent(startsAt)}` };

  it("a tap selects the time but never holds; the panel asks her to complete her position; the button goes there", async () => {
    const user = userEvent.setup();
    const actions = actionsWith();
    render(<SlotPicker days={DAYS} actions={actions} onConfirmed={vi.fn()} gate={gate} skipHref="/parent?t=childcare" />);
    expect(screen.getByRole("button", { name: "Complete my childcare position" })).toBeDisabled();
    await holdTue14(user);
    expect(actions.hold).not.toHaveBeenCalled();
    expect(tue14()).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText("Tuesday 9 February at 14:00")).toBeInTheDocument();
    expect(screen.getByText("Complete your childcare position so that we can confirm your call with your matchmaker.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Complete my childcare position" })).toHaveAttribute("href", `/parent/request?callAt=${encodeURIComponent(TUE_14)}`);
    expect(screen.queryByRole("button", { name: "Confirm time" })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Skip for now" })).toBeInTheDocument();
  });

  it("a greyed time still can't be chosen", async () => {
    const user = userEvent.setup();
    render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} gate={gate} />);
    await user.click(tueAfternoon());
    await user.click(time("Tuesday 9 February, 15:00 (London time)"));
    expect(screen.queryByRole("link", { name: "Complete my childcare position" })).not.toBeInTheDocument();
  });
});
