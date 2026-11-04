/**
 * SlotPicker (plan B6; brief §2 picker semantics, §3 parent 2–3; 04b rework W4, W14). Since BAI 2026-11-05 (W14) it
 * reveals one step at a time: the day tiles; once a day is chosen, four time-of-day tiles; once one is chosen, its
 * times. Each is a selector she can unselect, which hides the later steps. 04b's intents carried over:
 *  - each step is its own radiogroup; arrow keys move within it, skip what is closed, and never choose;
 *  - a tap (or Space) on a free time holds it at once; Confirm takes focus only once nothing is in flight;
 *  - a refusal never sticks (throws settle); a failed confirm reloads (a lost reply may have booked);
 *  - the no-times and load-failed states with Retry; a skeleton while the list reloads; reduced motion respected.
 * Unavailable days, times of day and times are greyed and can't be chosen, never hidden; a time taken by someone else
 * opens the "This time has just been booked" notice while the list refreshes. Nothing says "London time" (W14).
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { actionsWith, DAYS, gridDays, HOLD, TUE_09, TUE_14, TUE_1430, TUE_15, WED_09 } from "./slot-picker.fixtures.test-util";
import { SlotPicker } from "./SlotPicker";

const day = (name: string) => screen.getByRole("radio", { name });
const tue = () => day("Tue 9 Feb");
const bracket = (label: string) => screen.getByRole("radio", { name: new RegExp(`^${label} `) });
const time = (name: string) => screen.getByRole("radio", { name });
const tue14 = () => time("Tuesday 9 February, 14:00");
const confirmButton = () => screen.getByRole("button", { name: "Confirm time" });
const NOTICE = "Someone else booked Tuesday 9 February at 14:00 a moment ago. Please pick another time.";
type User = ReturnType<typeof userEvent.setup>;

async function toAfternoon(user: User) {
  await user.click(tue());
  await user.click(bracket("Afternoon"));
}
async function holdTue14(user: User) {
  await toAfternoon(user);
  await user.click(tue14());
}

describe("SlotPicker — step 1: the days only", () => {
  it("the header, then day tiles alone ('Tue' over '9 Feb'); no times of day, no times; Confirm disabled", () => {
    render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Your matchmaker's availability" })).toBeInTheDocument();
    const days = screen.getByRole("radiogroup", { name: "Your matchmaker's availability" });
    expect(within(days).getAllByRole("radio").map((r) => r.textContent)).toEqual(["Tue 9 Feb", "Wed 10 Feb", "Thu 11 Feb"]);
    expect(screen.queryByText("Time of day")).not.toBeInTheDocument();
    expect(screen.queryByText("Select a time")).not.toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
  });

  it("a day with no free time is greyed and disabled; an open day is violet; four across, seven from 640px", () => {
    render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />);
    expect(day("Thu 11 Feb")).toBeDisabled();
    expect(day("Thu 11 Feb").className).toContain("bg-slate-50 text-slate-200 border-slate-100 cursor-not-allowed");
    expect(tue().className).toContain("bg-violet-50 text-violet-600 border-violet-200");
    expect(screen.getByRole("radiogroup", { name: "Your matchmaker's availability" }).className).toContain("grid-cols-4 gap-2 sm:grid-cols-7");
  });

  it("a single day (03's pre-book) is one tile", () => {
    render(<SlotPicker days={gridDays().slice(0, 1)} actions={actionsWith()} onConfirmed={vi.fn()} />);
    expect(within(screen.getByRole("radiogroup")).getAllByRole("radio")).toHaveLength(1);
  });
});

describe("SlotPicker — step 2 and step 3 appear in turn", () => {
  it("a day → four time-of-day tiles with their hours; one with no free time is greyed", async () => {
    const user = userEvent.setup();
    render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />);
    await user.click(tue());
    expect(tue()).toHaveAttribute("aria-checked", "true");
    const brackets = screen.getByRole("radiogroup", { name: "Time of day" });
    expect(within(brackets).getAllByRole("radio").map((r) => r.textContent)).toEqual([
      "Morning 08:00 – 11:00",
      "Midday 11:00 – 14:00",
      "Afternoon 14:00 – 17:00",
      "Evening 17:00 – 20:00",
    ]);
    expect(bracket("Midday")).toBeDisabled();
    expect(bracket("Afternoon")).toBeEnabled();
    expect(screen.queryByText("Select a time")).not.toBeInTheDocument();
  });

  it("a time of day → 'Select a time' with every slot in it — those not free greyed, disabled and aria-disabled", async () => {
    const user = userEvent.setup();
    const actions = actionsWith();
    render(<SlotPicker days={DAYS} actions={actions} onConfirmed={vi.fn()} />);
    await toAfternoon(user);
    const box = screen.getByRole("radiogroup", { name: "Select a time" });
    expect(within(box).getAllByRole("radio").map((r) => r.textContent)).toEqual(["14:00", "14:30", "15:00"]);
    const t15 = time("Tuesday 9 February, 15:00");
    expect(t15).toBeDisabled();
    expect(t15).toHaveAttribute("aria-disabled", "true");
    expect(t15.className).toContain("bg-slate-50 text-slate-300 border-slate-100 cursor-not-allowed");
    await user.click(t15);
    expect(actions.hold).not.toHaveBeenCalled();
    expect(screen.getByText("14:00").closest("time")).toHaveAttribute("dateTime", TUE_14);
  });

  it("each new step fades and slides in (motion-safe only); tiles stop moving under reduced motion", async () => {
    const user = userEvent.setup();
    const { container } = render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />);
    await toAfternoon(user);
    const reveals = container.querySelectorAll("[data-reveal]");
    expect(reveals).toHaveLength(2);
    for (const r of reveals) expect(r.className).toContain("motion-safe:animate-in");
    expect(tue().className).toContain("motion-reduce:transition-none");
    expect(tue14().className).toContain("motion-reduce:transition-none");
  });
});

describe("SlotPicker — unselecting hides what comes after (W14)", () => {
  it("tapping the chosen day again unselects it and hides the times of day and the times", async () => {
    const user = userEvent.setup();
    render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />);
    await toAfternoon(user);
    await user.click(tue());
    expect(tue()).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByText("Time of day")).not.toBeInTheDocument();
    expect(screen.queryByText("Select a time")).not.toBeInTheDocument();
  });

  it("tapping the chosen time of day again hides the times", async () => {
    const user = userEvent.setup();
    render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />);
    await toAfternoon(user);
    await user.click(bracket("Afternoon"));
    expect(bracket("Afternoon")).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByText("Select a time")).not.toBeInTheDocument();
  });

  it("tapping the held time again clears it (Confirm disabled, no green panel); nothing is released", async () => {
    const user = userEvent.setup();
    const actions = actionsWith();
    render(<SlotPicker days={DAYS} actions={actions} onConfirmed={vi.fn()} />);
    await holdTue14(user);
    await screen.findByText(HOLD.line);
    await user.click(tue14());
    expect(tue14()).toHaveAttribute("aria-checked", "false");
    expect(screen.queryByText(HOLD.line)).not.toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
    expect(actions.hold).toHaveBeenCalledTimes(1);
  });

  it("changing the day clears the time of day, the time and the hold", async () => {
    const user = userEvent.setup();
    render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />);
    await holdTue14(user);
    await screen.findByText(HOLD.line);
    await user.click(day("Wed 10 Feb"));
    expect(screen.getByRole("radiogroup", { name: "Time of day" })).toBeInTheDocument();
    expect(within(screen.getByRole("radiogroup", { name: "Time of day" })).queryByRole("radio", { checked: true })).toBeNull();
    expect(screen.queryByText("Select a time")).not.toBeInTheDocument();
    expect(confirmButton()).toBeDisabled();
  });

  it("changing the time of day clears the time", async () => {
    const user = userEvent.setup();
    render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />);
    await holdTue14(user);
    await screen.findByText(HOLD.line);
    await user.click(bracket("Morning"));
    expect(within(screen.getByRole("radiogroup", { name: "Select a time" })).queryByRole("radio", { checked: true })).toBeNull();
    expect(confirmButton()).toBeDisabled();
  });
});

describe("SlotPicker — keyboard, step by step", () => {
  it("days: arrows move between open days only and never choose", async () => {
    const user = userEvent.setup();
    render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />);
    tue().focus();
    await user.keyboard("{ArrowRight}");
    expect(day("Wed 10 Feb")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(tue()).toHaveFocus();
    expect(tue()).toHaveAttribute("aria-checked", "false");
  });

  it("times of day: arrows skip a greyed one; Space chooses", async () => {
    const user = userEvent.setup();
    render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />);
    await user.click(tue());
    bracket("Morning").focus();
    await user.keyboard("{ArrowRight}");
    expect(bracket("Afternoon")).toHaveFocus();
    await user.keyboard(" ");
    expect(bracket("Afternoon")).toHaveAttribute("aria-checked", "true");
  });

  it("times: arrows skip a greyed time and never hold; Space holds the focused one", async () => {
    const user = userEvent.setup();
    const actions = actionsWith();
    render(<SlotPicker days={DAYS} actions={actions} onConfirmed={vi.fn()} />);
    await toAfternoon(user);
    tue14().focus();
    await user.keyboard("{ArrowRight}");
    expect(time("Tuesday 9 February, 14:30")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(tue14()).toHaveFocus();
    expect(actions.hold).not.toHaveBeenCalled();
    await user.keyboard(" ");
    expect(actions.hold).toHaveBeenCalledWith(TUE_14);
  });

  it("each step is one tab stop", async () => {
    const user = userEvent.setup();
    render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />);
    await toAfternoon(user);
    const stops = screen.getAllByRole("radio").filter((r) => r.getAttribute("tabindex") === "0");
    expect(stops.map((r) => r.textContent)).toEqual(["Tue 9 Feb", "Afternoon 14:00 – 17:00", "14:00"]);
  });

  it("arrow keys with Alt, Ctrl or Meta are left to the browser (e.g. Alt+Left is Back)", () => {
    render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />);
    tue().focus();
    for (const modifier of [{ altKey: true }, { ctrlKey: true }, { metaKey: true }]) {
      expect(fireEvent.keyDown(tue(), { key: "ArrowRight", ...modifier })).toBe(true);
      expect(tue()).toHaveFocus();
    }
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
    expect(time("Tuesday 9 February, 14:30")).toBeDisabled();
    finish({ ok: true, value: "booked" });
    await waitFor(() => expect(screen.queryByText("Confirming...")).not.toBeInTheDocument());
  });

  it("tapping another time holds that one (the server replaces her own hold; nothing released first)", async () => {
    const user = userEvent.setup();
    const actions = actionsWith();
    render(<SlotPicker days={DAYS} actions={actions} onConfirmed={vi.fn()} />);
    await holdTue14(user);
    await screen.findByText("Tuesday 9 February at 14:00");
    await user.click(time("Tuesday 9 February, 14:30"));
    expect(actions.hold).toHaveBeenLastCalledWith(TUE_1430);
    expect(await screen.findByText("Tuesday 9 February at 14:30")).toBeInTheDocument();
  });

  it("changing: her booking's day and time of day open chosen, her time marked as hers; any step can change", async () => {
    const user = userEvent.setup();
    const keep = vi.fn();
    render(<SlotPicker days={gridDays({ [TUE_15]: false })} actions={actionsWith()} onConfirmed={vi.fn()} current={TUE_15} onKeepTime={keep} />);
    expect(tue()).toHaveAttribute("aria-checked", "true");
    expect(bracket("Afternoon")).toHaveAttribute("aria-checked", "true");
    const hers = time("Tuesday 9 February, 15:00 — your current time");
    expect(hers).toHaveAttribute("aria-checked", "true");
    expect(hers.className).toContain("bg-violet-600");
    await user.click(tue14());
    expect(hers).toHaveAttribute("aria-checked", "false");
    await user.click(day("Wed 10 Feb"));
    expect(day("Wed 10 Feb")).toHaveAttribute("aria-checked", "true");
    await user.click(screen.getByRole("button", { name: "Keep my time" }));
    expect(keep).toHaveBeenCalled();
  });

  it("Skip for now is the left button when given a link onward", () => {
    render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} skipHref="/parent?t=childcare" />);
    expect(screen.getByRole("link", { name: "Skip for now" })).toHaveAttribute("href", "/parent?t=childcare");
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
    expect(screen.getByRole("radio", { name: /14:00 — no longer available/ })).toBeDisabled();
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

  it("a time seen taken is free again when a fresh list says so (reconciled on reload)", async () => {
    const user = userEvent.setup();
    const actions = actionsWith({ hold: vi.fn(async () => ({ ok: false as const, error: "taken" })), reload: vi.fn(async () => gridDays()) });
    render(<SlotPicker days={DAYS} actions={actions} onConfirmed={vi.fn()} />);
    await holdTue14(user);
    const notice = await screen.findByRole("dialog", { name: "This time has just been booked" });
    await user.click(within(notice).getByRole("button", { name: "Pick another time" }));
    await waitFor(() => expect(tue14()).toBeEnabled());
  });
});

describe("SlotPicker — other refusals keep 04b's inline alert", () => {
  it("a hold that ran out but is still free: 'Your hold ran out — pick again', focused, refreshed", async () => {
    const user = userEvent.setup();
    const actions = actionsWith({ confirm: vi.fn(async () => ({ ok: false as const, error: "hold_expired" })), reload: vi.fn(async () => gridDays()) });
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
  it("no free time at all: the no-times line and Retry, no steps", async () => {
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
    expect(screen.getByTestId("slot-picker-body")).toHaveAttribute("aria-busy", "true");
    finish();
    await waitFor(() => expect(screen.queryByTestId("slot-picker-loading")).not.toBeInTheDocument());
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
    for (const tile of screen.getAllByRole("radio", { name: "Tue 9 Feb" })) await user.click(tile);
    for (const tile of screen.getAllByRole("radio", { name: /^Afternoon / })) await user.click(tile);
    const ids = [...document.querySelectorAll("[id]")].map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(screen.getAllByRole("region").map((r) => r.getAttribute("aria-labelledby"))).size).toBe(2);
  });
});

describe("SlotPicker — a rejected action never sticks (review F1, F2)", () => {
  const boom = () => Promise.reject(new Error("network"));
  const idle = () => {
    expect(screen.getByTestId("slot-picker-body")).toHaveAttribute("aria-busy", "false");
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

describe("SlotPicker — a parent with no position yet (W11)", () => {
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
  });

  it("unselecting the time takes the button away again", async () => {
    const user = userEvent.setup();
    render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} gate={gate} />);
    await holdTue14(user);
    await user.click(tue14());
    expect(screen.queryByRole("link", { name: "Complete my childcare position" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Complete my childcare position" })).toBeDisabled();
  });
});

describe("SlotPicker — layout (walk and coordinator review)", () => {
  it("the heading's words are one text run beside the icon", () => {
    render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />);
    const heading = screen.getByRole("heading", { name: "Your matchmaker's availability" });
    expect([...heading.children].filter((el) => el.tagName !== "svg")).toHaveLength(1);
  });

  it("the button row wraps rather than clipping a long label", () => {
    render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} gate={{ href: (at) => at }} skipHref="/parent" />);
    expect((screen.getByRole("link", { name: "Skip for now" }).parentElement as HTMLElement).className).toContain("flex-wrap");
    const complete = screen.getByRole("button", { name: "Complete my childcare position" });
    expect(complete.className).toContain("whitespace-normal");
    expect(complete.className).toContain("h-auto");
  });
});

describe("SlotPicker — scrolling: each new step, then the panel and the buttons, come into view", () => {
  const scrolled = vi.fn();
  // jsdom has no matchMedia or scrollIntoView: stand them in.
  const reduced = (matches: boolean) => {
    window.matchMedia = vi.fn(
      (query: string) => ({ matches: query.includes("reduce") && matches, media: query, addEventListener: vi.fn(), removeEventListener: vi.fn() }) as unknown as MediaQueryList,
    );
  };
  beforeEach(() => {
    scrolled.mockReset();
    Element.prototype.scrollIntoView = scrolled;
  });

  it("the time of day and the times scroll in as they appear; a held time brings the actions in, smoothly", async () => {
    const user = userEvent.setup();
    reduced(false);
    render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />);
    await user.click(tue());
    expect(scrolled).toHaveBeenLastCalledWith({ block: "nearest", behavior: "smooth" });
    await user.click(bracket("Afternoon"));
    expect(scrolled).toHaveBeenCalledTimes(2);
    await user.click(tue14());
    await screen.findByText(HOLD.line);
    await waitFor(() => expect(scrolled).toHaveBeenLastCalledWith({ block: "end", behavior: "smooth" }));
    expect(scrolled.mock.contexts.at(-1)).toBe(screen.getByTestId("slot-picker-actions"));
  });

  it("under prefers-reduced-motion everything jumps (no smooth scroll)", async () => {
    const user = userEvent.setup();
    reduced(true);
    render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />);
    await holdTue14(user);
    await waitFor(() => expect(scrolled).toHaveBeenLastCalledWith({ block: "end", behavior: "auto" }));
    expect(scrolled.mock.calls.every(([options]) => (options as ScrollIntoViewOptions).behavior === "auto")).toBe(true);
  });
});

describe("SlotPicker — React re-review fixes", () => {
  it("HIGH 1 (b): a confirm that throws keeps her hold and Confirm; a retry succeeds with the same hold id", async () => {
    const user = userEvent.setup();
    const confirm = vi.fn().mockRejectedValueOnce(new Error("network")).mockResolvedValueOnce({ ok: true, value: "booked" });
    const onConfirmed = vi.fn();
    render(<SlotPicker days={DAYS} actions={actionsWith({ confirm })} onConfirmed={onConfirmed} />);
    await holdTue14(user);
    await user.click(await screen.findByRole("button", { name: "Confirm time" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't do that — try again");
    expect(screen.getByText(HOLD.line)).toBeInTheDocument();
    expect(tue14()).toHaveAttribute("aria-checked", "true");
    expect(confirmButton()).toBeEnabled();
    await user.click(confirmButton());
    expect(confirm).toHaveBeenCalledTimes(2);
    expect(confirm.mock.calls[0][0].holdId).toBe(confirm.mock.calls[1][0].holdId);
    expect(onConfirmed).toHaveBeenCalledWith("booked");
  });

  it.each([["error"], ["rate_limited"], ["invalid"]])("HIGH 1 (b): a refused confirm (%s) keeps her hold and Confirm enabled", async (error) => {
    const user = userEvent.setup();
    render(<SlotPicker days={DAYS} actions={actionsWith({ confirm: vi.fn(async () => ({ ok: false as const, error })) })} onConfirmed={vi.fn()} />);
    await holdTue14(user);
    await user.click(await screen.findByRole("button", { name: "Confirm time" }));
    await screen.findByRole("alert");
    expect(screen.getByText(HOLD.line)).toBeInTheDocument();
    expect(confirmButton()).toBeEnabled();
  });

  it("HIGH 1: hold A, tap B, B refused → A is still hers, chosen and held (the database kept A's hold)", async () => {
    const user = userEvent.setup();
    const hold = vi.fn(async (startsAt: string) =>
      startsAt === TUE_14 ? { ok: true as const, value: { ...HOLD, startsAt } } : { ok: false as const, error: "taken" },
    );
    render(<SlotPicker days={DAYS} actions={actionsWith({ hold })} onConfirmed={vi.fn()} />);
    await holdTue14(user);
    await screen.findByText(HOLD.line);
    await user.click(time("Tuesday 9 February, 14:30"));
    const notice = await screen.findByRole("dialog", { name: "This time has just been booked" });
    await user.click(within(notice).getByRole("button", { name: "Pick another time" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(tue14()).toHaveAttribute("aria-checked", "true");
    expect(screen.getByText(HOLD.line)).toBeInTheDocument();
    expect(confirmButton()).toBeEnabled();
    await waitFor(() => expect(tue14()).toHaveFocus());
  });

  it("LOW: a chosen time of day that has since closed renders greyed and disabled, not violet", async () => {
    const user = userEvent.setup();
    render(<SlotPicker days={gridDays({ [TUE_1430]: false })} actions={actionsWith({ hold: vi.fn(async () => ({ ok: false as const, error: "taken" })) })} onConfirmed={vi.fn()} />);
    await holdTue14(user);
    const notice = await screen.findByRole("dialog", { name: "This time has just been booked" });
    await user.click(within(notice).getByRole("button", { name: "Pick another time" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    expect(bracket("Afternoon")).toBeDisabled();
    expect(bracket("Afternoon").className).toContain("bg-slate-50 text-slate-200 border-slate-100");
    expect(bracket("Afternoon").className).not.toContain("bg-violet-600");
  });

  it("LOW: after Retry reloads the list, focus returns to the steps (not the page body)", async () => {
    const user = userEvent.setup();
    /** The owner, as the page is: its reload sets fresh days. */
    function Owner() {
      const [days, setDays] = useState<ReturnType<typeof gridDays> | null>(null);
      const reload = async () => {
        setDays(gridDays());
      };
      return <SlotPicker days={days} actions={actionsWith({ reload })} onConfirmed={vi.fn()} />;
    }
    render(<Owner />);
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(tue()).toHaveFocus());
  });
});
