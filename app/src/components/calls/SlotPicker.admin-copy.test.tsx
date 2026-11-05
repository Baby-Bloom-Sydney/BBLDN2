/**
 * The picker on /admin/calls (plan §13: "for on-behalf, `copy` widens to cover the confirm button and the held line";
 * BB-wave1-041126/04c1-build). Staff book or move a family's call with the same picker, in their own words:
 *
 * - the confirm button: "Book this time", or "Move to this time" when she already has a booked call;
 * - the held line: "Held for 5 minutes" — the owner's hold action supplies the line (`PickerHold.line`), as the
 *   parent's does ("Your time is being reserved for 5 minutes"), so the admin action returns `adminHeldLine(n)`;
 * - the heading names London time (brief §3 admin 1: staff are not in London; the parent-side ruling W14 is for parents).
 *
 * Nothing a parent sees changes: with no `copy` the button still reads "Confirm time" (SlotPicker.test.tsx).
 */
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { ADMIN_COPY, adminHeldLine } from "@/lib/calls/copy";
import { actionsWith, DAYS, HOLD } from "./slot-picker.fixtures.test-util";
import { SlotPicker } from "./SlotPicker";

type User = ReturnType<typeof userEvent.setup>;

const ADMIN_HOLD = { ...HOLD, line: adminHeldLine(5) };

async function holdTue14(user: User) {
  await user.click(screen.getByRole("button", { name: "Tue 9 Feb" }));
  await user.click(screen.getByRole("button", { name: /^Afternoon / }));
  await user.click(screen.getByRole("button", { name: "Tuesday 9 February, 14:00" }));
}

function renderAdmin(confirm: string, onConfirmed = vi.fn()) {
  const actions = actionsWith({ hold: vi.fn(async () => ({ ok: true as const, value: ADMIN_HOLD })) });
  render(<SlotPicker days={DAYS} actions={actions} onConfirmed={onConfirmed} copy={{ heading: ADMIN_COPY.availability, confirm }} />);
  return actions;
}

describe("SlotPicker — admin words", () => {
  it("the heading names London time; the button reads 'Book this time' and the held line 'Held for 5 minutes'", async () => {
    const user = userEvent.setup();
    renderAdmin(ADMIN_COPY.bookThisTime);
    expect(screen.getByRole("heading", { name: "Matchmaker's availability (London time)" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Book this time" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: "Confirm time" })).not.toBeInTheDocument();
    await holdTue14(user);
    expect(await screen.findByText("Held for 5 minutes")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Book this time" })).toBeEnabled());
  });

  it("'Move to this time' when moving; pressing it confirms the hold", async () => {
    const user = userEvent.setup();
    const onConfirmed = vi.fn();
    const actions = renderAdmin(ADMIN_COPY.moveToThisTime, onConfirmed);
    await holdTue14(user);
    await user.click(await screen.findByRole("button", { name: "Move to this time" }));
    await waitFor(() => expect(onConfirmed).toHaveBeenCalledWith("booked"));
    expect(actions.confirm).toHaveBeenCalledWith(ADMIN_HOLD);
  });

  it("while confirming the button still says Confirming...", async () => {
    const user = userEvent.setup();
    let release: (v: { ok: true; value: string }) => void = () => {};
    const actions = actionsWith({
      hold: vi.fn(async () => ({ ok: true as const, value: ADMIN_HOLD })),
      confirm: vi.fn(() => new Promise<{ ok: true; value: string }>((resolve) => (release = resolve))),
    });
    render(<SlotPicker days={DAYS} actions={actions} onConfirmed={vi.fn()} copy={{ confirm: ADMIN_COPY.bookThisTime }} />);
    await holdTue14(user);
    await user.click(await screen.findByRole("button", { name: "Book this time" }));
    expect(await screen.findByRole("button", { name: "Confirming..." })).toBeDisabled();
    release({ ok: true, value: "booked" });
    await waitFor(() => expect(screen.getByRole("button", { name: "Book this time" })).toBeInTheDocument());
  });

  it("no copy → the parent's words, unchanged", () => {
    render(<SlotPicker days={DAYS} actions={actionsWith()} onConfirmed={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Your matchmaker's availability" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Confirm time" })).toBeInTheDocument();
  });
});
