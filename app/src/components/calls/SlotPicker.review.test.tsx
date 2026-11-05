/**
 * SlotPicker — the final review's fixes (04b rework W17). A refusal's alert is announced on insert (role=alert) but
 * never takes focus (item 14: a focused alert is read twice, and with no roving a keyboard user would tab through every
 * tile back to Confirm): when her hold survives, focus goes to Confirm. The same failure twice is announced twice; any
 * new choice (a day, a time of day, a time, Confirm) clears
 * the last refusal; the held line's status region stays mounted for the picker's life and only its words change; the
 * refusal sets are typed to the parent's codes. (Item 4, toggle buttons, and item 8, the 320px labels, are in
 * SlotPicker.test.tsx.)
 */
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { actionsWith, DAYS, HOLD } from "./slot-picker.fixtures.test-util";
import { pickerMessage, SlotPicker } from "./SlotPicker";

type User = ReturnType<typeof userEvent.setup>;
const tile = (name: string | RegExp) => screen.getByRole("button", { name });
const confirmButton = () => screen.getByRole("button", { name: "Confirm time" });
const actions = () => screen.getByTestId("slot-picker-actions");

async function holdTue14(user: User) {
  await user.click(tile("Tue 9 Feb"));
  await user.click(tile(/^Afternoon /));
  await user.click(tile("Tuesday 9 February, 14:00"));
}

describe("item 14: the alert is announced, never focused; a surviving hold puts focus on Confirm", () => {
  it("a confirm that fails with her hold surviving: Confirm has focus and the alert's words are there", async () => {
    const user = userEvent.setup();
    render(<SlotPicker days={DAYS} actions={actionsWith({ confirm: vi.fn(async () => ({ ok: false as const, error: "error" as const })) })} onConfirmed={vi.fn()} />);
    await holdTue14(user);
    await user.click(await screen.findByRole("button", { name: "Confirm time" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("We couldn't do that — try again");
    await waitFor(() => expect(document.activeElement).toBe(confirmButton()));
    expect(alert).not.toHaveAttribute("tabindex");
  });

  it("a refused tap with no hold to fall back on: focus stays on the tile she tapped, not the alert", async () => {
    const user = userEvent.setup();
    render(<SlotPicker days={DAYS} actions={actionsWith({ hold: vi.fn(async () => ({ ok: false as const, error: "rate_limited" as const })) })} onConfirmed={vi.fn()} />);
    await holdTue14(user);
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(tile("Tuesday 9 February, 14:00")).toBeEnabled());
    expect(alert).not.toHaveFocus();
    expect(tile("Tuesday 9 February, 14:00")).toHaveFocus();
  });

  it("a refused tap while holding another time: her first hold survives, so focus is on Confirm", async () => {
    const user = userEvent.setup();
    const hold = vi
      .fn()
      .mockResolvedValueOnce({ ok: true, value: HOLD })
      .mockResolvedValueOnce({ ok: false, error: "rate_limited" });
    render(<SlotPicker days={DAYS} actions={actionsWith({ hold })} onConfirmed={vi.fn()} />);
    await holdTue14(user);
    await screen.findByText(HOLD.line);
    await user.click(tile("Tuesday 9 February, 14:30"));
    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(document.activeElement).toBe(confirmButton()));
    expect(alert).not.toHaveFocus();
  });

  it("the same failure twice is announced twice: the alert is cleared when Confirm is pressed and comes back", async () => {
    const user = userEvent.setup();
    let fail: (value: { ok: false; error: "error" }) => void = () => {};
    const confirm = vi
      .fn()
      .mockResolvedValueOnce({ ok: false, error: "error" })
      .mockImplementationOnce(() => new Promise((resolve) => (fail = resolve)));
    render(<SlotPicker days={DAYS} actions={actionsWith({ confirm })} onConfirmed={vi.fn()} />);
    await holdTue14(user);
    await user.click(await screen.findByRole("button", { name: "Confirm time" }));
    const first = await screen.findByRole("alert");
    await waitFor(() => expect(confirmButton()).toBeEnabled());
    await user.click(confirmButton());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    fail({ ok: false, error: "error" });
    const second = await screen.findByRole("alert");
    expect(second).not.toBe(first);
    expect(second).toHaveTextContent("We couldn't do that — try again");
  });
});

describe("item 10: a new day or time of day clears the last refusal", () => {
  it.each([
    ["another day", () => tile("Wed 10 Feb")],
    ["another time of day", () => tile(/^Morning /)],
  ])("%s clears the alert", async (_what, next) => {
    const user = userEvent.setup();
    render(<SlotPicker days={DAYS} actions={actionsWith({ hold: vi.fn(async () => ({ ok: false as const, error: "rate_limited" as const })) })} onConfirmed={vi.fn()} />);
    await holdTue14(user);
    await screen.findByRole("alert");
    await user.click(next());
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});

describe("item 3: the held line's status region is mounted for the picker's life", () => {
  it("the same node before a hold (empty), with the hold line, and after the time is unselected (empty again)", async () => {
    const user = userEvent.setup();
    render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />);
    const region = within(actions()).getByRole("status");
    expect(region).toHaveTextContent("");
    await holdTue14(user);
    await waitFor(() => expect(within(actions()).getByRole("status")).toHaveTextContent(HOLD.line));
    expect(within(actions()).getByRole("status")).toBe(region);
    await user.click(tile("Tuesday 9 February, 14:00"));
    expect(within(actions()).getByRole("status")).toBe(region);
    expect(region).toHaveTextContent("");
  });
});

describe("item 9: the refusal sets are typed to the parent's codes", () => {
  it("pickerMessage takes a MyCallRefusal, not any string", () => {
    // @ts-expect-error a free-form string is not one of the parent's refusal codes
    expect(pickerMessage("nonsense")).toBe("We couldn't do that — try again");
    expect(pickerMessage("hold_expired")).toBe("Your hold ran out — pick again");
  });
});

describe("item 5: the taken notice is an alertdialog, described by its text; a tap outside still closes it (§0a.8)", () => {
  it("role=alertdialog, aria-describedby → the 'Someone else booked …' line; the overlay closes it", async () => {
    const user = userEvent.setup();
    render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} initialNotice="Tuesday 9 February at 14:00" />);
    const notice = await screen.findByRole("alertdialog", { name: "This time has just been booked" });
    const described = document.getElementById(notice.getAttribute("aria-describedby") ?? "");
    expect(described).toHaveTextContent("Someone else booked Tuesday 9 February at 14:00 a moment ago. Please pick another time.");
    expect(notice).toHaveAccessibleDescription("Someone else booked Tuesday 9 February at 14:00 a moment ago. Please pick another time.");
    await user.click(document.querySelector<HTMLElement>(".bg-black\\/80") as HTMLElement);
    await waitFor(() => expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument());
  });
});
