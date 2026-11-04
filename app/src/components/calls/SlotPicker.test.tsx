/**
 * SlotPicker (plan B6 + §12 R16, R17; brief §2 picker semantics, §3 parent 2–3, §9.16). Port of LDN1's
 * `call-layer.screens.test.tsx` onto the 24-hour clock and an explicit "Choose this time" press:
 *  - one fieldset per London day, the full date as its legend; a radiogroup inside; every option named in full
 *    with "(London time)"; native radios, so Tab moves between days and arrow keys within one;
 *  - choosing a radio (by click or arrow key) never holds — only "Choose this time" does (R17);
 *  - a taken slot or a run-out hold says so in an alert that takes focus, and the list refreshes;
 *  - the no-times and load-failed states, each with Retry; a skeleton while the list reloads;
 *  - motion respects prefers-reduced-motion.
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { groupSlotsByDay } from "@/lib/calls/group-slots-by-day";
import { SlotPicker, type PickerHold, type SlotPickerActions } from "./SlotPicker";

const TUE_14 = "2027-02-09T14:00:00.000Z";
const TUE_1430 = "2027-02-09T14:30:00.000Z";
const WED_09 = "2027-02-10T09:00:00.000Z";
const DAYS = groupSlotsByDay([TUE_14, TUE_1430, WED_09].map((startsAt) => ({ startsAt, endsAt: startsAt })));
const HOLD: PickerHold = { holdId: "h-1", startsAt: TUE_14, line: "We're holding Tuesday 9 February, 14:00 (London time) for you until 10:05." };

function actionsWith(over: Partial<SlotPickerActions<string>> = {}): SlotPickerActions<string> {
  return {
    hold: vi.fn(async () => ({ ok: true as const, value: HOLD })),
    confirm: vi.fn(async () => ({ ok: true as const, value: "booked" })),
    reload: vi.fn(async () => {}),
    ...over,
  };
}

const tue14 = () => screen.getByRole("radio", { name: "Tuesday 9 February, 14:00 (London time)" });
const choose = () => screen.getByRole("button", { name: "Choose this time" });

describe("SlotPicker — the days", () => {
  it("one fieldset per day with the full date as legend, a radiogroup, every option named with (London time)", () => {
    render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />);
    const tuesday = screen.getByRole("group", { name: "Tuesday 9 February" });
    expect(tuesday.tagName).toBe("FIELDSET");
    expect(within(tuesday).getByRole("radiogroup", { name: "Tuesday 9 February (London time)" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Wednesday 10 February" })).toBeInTheDocument();
    expect(screen.getAllByRole("radio").map((r) => r.getAttribute("aria-label"))).toEqual([
      "Tuesday 9 February, 14:00 (London time)",
      "Tuesday 9 February, 14:30 (London time)",
      "Wednesday 10 February, 09:00 (London time)",
    ]);
    expect(screen.getByText("14:00").closest("time")).toHaveAttribute("dateTime", TUE_14);
    expect(choose()).toBeDisabled();
  });

  it("choosing a radio never holds (R17); Choose this time does", async () => {
    const user = userEvent.setup();
    const actions = actionsWith();
    render(<SlotPicker days={DAYS} actions={actions} onConfirmed={vi.fn()} />);
    await user.click(tue14());
    expect(tue14()).toBeChecked();
    expect(actions.hold).not.toHaveBeenCalled();
    await user.click(choose());
    expect(actions.hold).toHaveBeenCalledWith(TUE_14);
  });

  it("keyboard: arrows move within a day (no hold), Tab moves to the next day", async () => {
    const user = userEvent.setup();
    const actions = actionsWith();
    render(<SlotPicker days={DAYS} actions={actions} onConfirmed={vi.fn()} />);
    await user.click(tue14());
    await user.keyboard("{ArrowRight}");
    const tue1430 = screen.getByRole("radio", { name: "Tuesday 9 February, 14:30 (London time)" });
    expect(tue1430).toHaveFocus();
    expect(tue1430).toBeChecked();
    expect(actions.hold).not.toHaveBeenCalled();
    await user.tab();
    expect(screen.getByRole("radio", { name: "Wednesday 10 February, 09:00 (London time)" })).toHaveFocus();
  });

  it("respects prefers-reduced-motion", () => {
    render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />);
    expect(screen.getByText("14:00").closest("label")?.className).toContain("motion-reduce:transition-none");
  });
});

describe("SlotPicker — hold and confirm", () => {
  it("held: says what is held and until when, focuses Confirm; Confirm writes with the hold and hands back the result", async () => {
    const user = userEvent.setup();
    const actions = actionsWith();
    const onConfirmed = vi.fn();
    render(<SlotPicker days={DAYS} actions={actions} onConfirmed={onConfirmed} />);
    await user.click(tue14());
    await user.click(choose());
    expect(await screen.findByText(HOLD.line)).toBeInTheDocument();
    const confirm = screen.getByRole("button", { name: "Confirm this time" });
    expect(confirm).toHaveFocus();
    expect(screen.queryByRole("radio")).not.toBeInTheDocument();
    await user.click(confirm);
    expect(actions.confirm).toHaveBeenCalledWith(HOLD);
    expect(onConfirmed).toHaveBeenCalledWith("booked");
  });

  it("Pick another time goes back to the days", async () => {
    const user = userEvent.setup();
    render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />);
    await user.click(tue14());
    await user.click(choose());
    await user.click(await screen.findByRole("button", { name: "Pick another time" }));
    expect(tue14()).toBeInTheDocument();
  });

  it("a taken slot: an alert that takes focus, the option marked gone, and the list refreshes", async () => {
    const user = userEvent.setup();
    const actions = actionsWith({ hold: vi.fn(async () => ({ ok: false as const, error: "taken" })) });
    render(<SlotPicker days={DAYS} actions={actions} onConfirmed={vi.fn()} />);
    await user.click(tue14());
    await user.click(choose());
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("That time has just gone — pick another");
    expect(alert).toHaveFocus();
    expect(screen.getByRole("radio", { name: /14:00 \(London time\) — no longer available/ })).toBeDisabled();
    expect(actions.reload).toHaveBeenCalled();
  });

  it("a hold that ran out at Confirm: 'Your hold ran out — pick again', back to the days, refreshed", async () => {
    const user = userEvent.setup();
    const actions = actionsWith({ confirm: vi.fn(async () => ({ ok: false as const, error: "hold_expired" })) });
    render(<SlotPicker days={DAYS} actions={actions} onConfirmed={vi.fn()} />);
    await user.click(tue14());
    await user.click(choose());
    await user.click(await screen.findByRole("button", { name: "Confirm this time" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Your hold ran out — pick again");
    expect(tue14()).toBeInTheDocument();
    expect(actions.reload).toHaveBeenCalled();
  });

  it.each([
    ["rate_limited", "Too many changes — try again in a while"],
    ["error", "We couldn't do that — try again"],
  ])("%s → '%s'", async (error, message) => {
    const user = userEvent.setup();
    render(<SlotPicker days={DAYS} actions={actionsWith({ hold: vi.fn(async () => ({ ok: false as const, error })) })} onConfirmed={vi.fn()} />);
    await user.click(tue14());
    await user.click(choose());
    expect(await screen.findByRole("alert")).toHaveTextContent(message);
  });

  it("Keep my time is offered only when the owner gives one", async () => {
    const user = userEvent.setup();
    const keep = vi.fn();
    const { rerender } = render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Keep my time" })).not.toBeInTheDocument();
    rerender(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} onKeepTime={keep} />);
    await user.click(screen.getByRole("button", { name: "Keep my time" }));
    expect(keep).toHaveBeenCalled();
  });
});

describe("SlotPicker — no times, failed, loading", () => {
  it("no free time: the no-times line and Retry", async () => {
    const user = userEvent.setup();
    const actions = actionsWith();
    render(<SlotPicker days={[]} actions={actions} onConfirmed={vi.fn()} />);
    expect(screen.getByText("No times free right now — we'll still call you for your Complimentary matchmaker call.")).toBeInTheDocument();
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
    render(<SlotPicker days={[]} actions={actions} onConfirmed={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(screen.getByTestId("slot-picker-loading")).toBeInTheDocument();
    expect(screen.getByRole("region", { busy: true })).toBeInTheDocument();
    finish();
    await waitFor(() => expect(screen.queryByTestId("slot-picker-loading")).not.toBeInTheDocument());
  });

  it("a selection that is no longer in the list is dropped", async () => {
    const user = userEvent.setup();
    const { rerender } = render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />);
    await user.click(tue14());
    rerender(<SlotPicker days={groupSlotsByDay([{ startsAt: WED_09, endsAt: WED_09 }])} actions={actionsWith()} onConfirmed={vi.fn()} />);
    expect(choose()).toBeDisabled();
  });
});

describe("SlotPicker — reuse (04c on-behalf, 03 pre-book)", () => {
  it("two pickers on one page share no element ids or radio-group names", () => {
    render(
      <>
        <SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />
        <SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />
      </>,
    );
    const radios = screen.getAllByRole("radio");
    const ids = radios.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    const names = (picker: number) => new Set(radios.slice(picker * 3, picker * 3 + 3).map((r) => r.getAttribute("name")));
    expect([...names(0)].some((n) => names(1).has(n))).toBe(false);
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

  it("a rejecting hold: 'We couldn't do that — try again', the days enabled, nothing busy", async () => {
    const user = userEvent.setup();
    render(<SlotPicker days={DAYS} actions={actionsWith({ hold: vi.fn(boom) })} onConfirmed={vi.fn()} />);
    await user.click(tue14());
    await user.click(choose());
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't do that — try again");
    expect(tue14()).toBeEnabled();
    idle();
  });

  it("a rejecting confirm: the message, back to the days, nothing busy", async () => {
    const user = userEvent.setup();
    render(<SlotPicker days={DAYS} actions={actionsWith({ confirm: vi.fn(boom) })} onConfirmed={vi.fn()} />);
    await user.click(tue14());
    await user.click(choose());
    await user.click(await screen.findByRole("button", { name: "Confirm this time" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("We couldn't do that — try again");
    expect(tue14()).toBeEnabled();
    idle();
  });

  it("a rejecting reload: no skeleton left, the load-failed line with Retry", async () => {
    const user = userEvent.setup();
    render(<SlotPicker days={[]} actions={actionsWith({ reload: vi.fn(boom) })} onConfirmed={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("We couldn't load the times — we'll still call you for your Complimentary matchmaker call")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeEnabled();
    idle();
  });

  it("a confirm that fails in transit refreshes the list, so a booking that was written shows (re-review)", async () => {
    const user = userEvent.setup();
    const actions = actionsWith({ confirm: vi.fn(boom) });
    render(<SlotPicker days={DAYS} actions={actions} onConfirmed={vi.fn()} />);
    await user.click(tue14());
    await user.click(choose());
    await user.click(await screen.findByRole("button", { name: "Confirm this time" }));
    await screen.findByRole("alert");
    expect(actions.reload).toHaveBeenCalledTimes(1);
  });

  it("an invalid refusal (a stale list) refreshes the list too", async () => {
    const user = userEvent.setup();
    const actions = actionsWith({ hold: vi.fn(async () => ({ ok: false as const, error: "invalid" })) });
    render(<SlotPicker days={DAYS} actions={actions} onConfirmed={vi.fn()} />);
    await user.click(tue14());
    await user.click(choose());
    await screen.findByRole("alert");
    expect(actions.reload).toHaveBeenCalled();
  });
});
