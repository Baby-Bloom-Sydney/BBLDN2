/**
 * "Pre-book next available cohort" (plan 03 §3 "Pre-book", row C1; brief 03 §0.5, §3 parent 5–6). The button records
 * the pre-booking through 03's action with the code, then shows 04's picker for that cohort's opening day (one day =
 * one row; its hold, confirm and reload wired to 03's three actions with the code), or "We'll call you on …", or
 * "We'll be in touch …". Already pre-booked (she came back, e.g. from the call email's button, D8) → it opens at once.
 *
 * 03c review fixes: the changing lines (call-on, in-touch, booked) are in ONE always-mounted polite status region, so
 * each is announced; after a press, focus goes to the picker's heading (the picker) or to the page heading (a line,
 * or booked) — never on a page load. A picker action that throws is a plain failure; `invalid` → the invalid page.
 */
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";

const h = vi.hoisted(() => ({
  prebookNext: vi.fn(),
  holdPrebookTime: vi.fn(),
  confirmPrebookTime: vi.fn(),
  reloadPrebookTimes: vi.fn(),
  refresh: vi.fn(),
}));
vi.mock("./actions", () => ({
  prebookNext: h.prebookNext,
  holdPrebookTime: h.holdPrebookTime,
  confirmPrebookTime: h.confirmPrebookTime,
  reloadPrebookTimes: h.reloadPrebookTimes,
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh }) }));

import { heldLine } from "@/lib/calls/copy";
import { groupSlotGridByDay } from "@/lib/calls/group-slots-by-day";
import { PAGE_COPY, prebookBookedLine, prebookCallLine, prebookPickHeading } from "@/lib/deposit/copy";
import { PrebookPanel } from "./PrebookPanel";

const CODE = "Pb0_-".repeat(8) + "xyz";
const NEXT = "2027-02-08";
const AT_10 = "2027-02-08T10:00:00.000Z";
const HOLD_ID = "f0300000-0000-4000-8000-000000000111";
const DAYS = groupSlotGridByDay({ dates: [NEXT], slots: [{ startsAt: AT_10, endsAt: "2027-02-08T10:30:00.000Z", free: true }] });
const PICKER = { ok: true, value: { kind: "picker", londonDate: NEXT, days: DAYS } };

let onInvalid: Mock<() => void>;
let onFocusHeading: Mock<() => void>;
const draw = (prebooked = false) =>
  render(<PrebookPanel code={CODE} prebooked={prebooked} onInvalid={onInvalid} onFocusHeading={onFocusHeading} />);
const prebookButton = () => screen.getByRole("button", { name: PAGE_COPY.prebookButton });
const status = () => screen.getByTestId("deposit-prebook-status");
const pickerHeading = () => screen.getByRole("heading", { name: prebookPickHeading(NEXT) });
type User = ReturnType<typeof userEvent.setup>;

async function pickTen(user: User) {
  await user.click(screen.getByRole("button", { name: "Mon 8 Feb" }));
  await user.click(screen.getByRole("button", { name: /^Morning / }));
  await user.click(screen.getByRole("button", { name: "Monday 8 February, 10:00" }));
}
async function openPicker() {
  draw(true);
  await screen.findByTestId("deposit-prebook-picker");
}

beforeEach(() => {
  for (const fn of Object.values(h)) fn.mockReset();
  onInvalid = vi.fn<() => void>();
  onFocusHeading = vi.fn<() => void>();
  h.prebookNext.mockResolvedValue(PICKER);
  h.holdPrebookTime.mockResolvedValue({ ok: true, value: { holdId: HOLD_ID, startsAt: AT_10, line: heldLine(5) } });
  h.confirmPrebookTime.mockResolvedValue({ ok: true, value: { bookingId: "b-1", startsAt: AT_10, line: prebookBookedLine(AT_10) } });
  h.reloadPrebookTimes.mockResolvedValue({ ok: true, value: DAYS });
});

describe("PrebookPanel — the button records, then the next step", () => {
  it("shows only the button at first; nothing is recorded until it is pressed", () => {
    draw();
    expect(prebookButton()).toBeEnabled();
    expect(screen.getByTestId("deposit-prebook")).toBe(prebookButton());
    expect(h.prebookNext).not.toHaveBeenCalled();
  });

  it("press → records with the code, disabled while it does; then the opening day's picker, one row, its heading focused", async () => {
    let answer: (value: unknown) => void = () => {};
    h.prebookNext.mockImplementation(() => new Promise((resolve) => { answer = resolve; }));
    const user = userEvent.setup();
    draw();
    await user.click(prebookButton());
    expect(prebookButton()).toBeDisabled();
    await user.click(prebookButton());
    expect(h.prebookNext).toHaveBeenCalledTimes(1);
    expect(h.prebookNext).toHaveBeenCalledWith(CODE);
    await act(async () => answer(PICKER));
    expect(screen.getByTestId("deposit-prebook-picker")).toBeInTheDocument();
    expect(screen.getAllByRole("button", { name: /^[A-Z][a-z]{2} \d{1,2} [A-Z][a-z]{2}$/ })).toHaveLength(1);
    expect(screen.queryByTestId("deposit-prebook")).toBeNull();
    await waitFor(() => expect(pickerHeading()).toHaveFocus());
    expect(onFocusHeading).not.toHaveBeenCalled();
  });

  it("call_on → \"We'll call you on Monday 8 February to confirm your place.\" in the live region; focus to the page heading", async () => {
    h.prebookNext.mockResolvedValue({ ok: true, value: { kind: "call_on", date: NEXT } });
    const user = userEvent.setup();
    draw();
    await user.click(prebookButton());
    await waitFor(() => expect(status()).toHaveTextContent(prebookCallLine(NEXT)));
    expect(status()).toHaveTextContent("Monday 8 February");
    expect(screen.getByTestId("deposit-prebook-line")).toHaveTextContent(prebookCallLine(NEXT));
    await waitFor(() => expect(onFocusHeading).toHaveBeenCalledTimes(1));
  });

  it("in_touch → \"We'll be in touch to arrange your place.\" in the live region", async () => {
    h.prebookNext.mockResolvedValue({ ok: true, value: { kind: "in_touch" } });
    const user = userEvent.setup();
    draw();
    await user.click(prebookButton());
    await waitFor(() => expect(status()).toHaveTextContent(PAGE_COPY.prebookNoCohort));
  });

  it("the live region is mounted from the start, empty, polite — the same node when its words arrive", async () => {
    h.prebookNext.mockResolvedValue({ ok: true, value: { kind: "call_on", date: NEXT } });
    const user = userEvent.setup();
    draw();
    const region = status();
    expect(region).toHaveAttribute("role", "status");
    expect(region).toHaveAttribute("aria-live", "polite");
    expect(region).toHaveTextContent("");
    await user.click(prebookButton());
    await waitFor(() => expect(region).toHaveTextContent(prebookCallLine(NEXT)));
    expect(status()).toBe(region);
  });

  it("a failure, or a throw → try again as an alert, and the button again", async () => {
    h.prebookNext.mockResolvedValueOnce({ ok: false, error: "error" }).mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    draw();
    await user.click(prebookButton());
    expect(await screen.findByRole("alert")).toHaveTextContent(PAGE_COPY.tryAgain);
    expect(prebookButton()).toBeEnabled();
    await user.click(prebookButton());
    await waitFor(() => expect(h.prebookNext).toHaveBeenCalledTimes(2));
    expect(await screen.findByRole("alert")).toHaveTextContent(PAGE_COPY.tryAgain);
  });

  it("not offered any more (the state moved on) → the page is fetched again", async () => {
    h.prebookNext.mockResolvedValue({ ok: false, error: "not_offered" });
    const user = userEvent.setup();
    draw();
    await user.click(prebookButton());
    await waitFor(() => expect(h.refresh).toHaveBeenCalledTimes(1));
  });

  it.each(["invalid", "deposit_disabled"] as const)("%s → the page becomes the invalid page", async (error) => {
    h.prebookNext.mockResolvedValue({ ok: false, error });
    const user = userEvent.setup();
    draw();
    await user.click(prebookButton());
    await waitFor(() => expect(onInvalid).toHaveBeenCalledTimes(1));
  });

  it("already pre-booked → opens at once (once), with no press — and moves no focus on a page load", async () => {
    await openPicker();
    expect(h.prebookNext).toHaveBeenCalledTimes(1);
    expect(pickerHeading()).not.toHaveFocus();
    expect(onFocusHeading).not.toHaveBeenCalled();
  });

  it("already pre-booked with a line → the line is in the live region, focus stays", async () => {
    h.prebookNext.mockResolvedValue({ ok: true, value: { kind: "in_touch" } });
    draw(true);
    await waitFor(() => expect(status()).toHaveTextContent(PAGE_COPY.prebookNoCohort));
    expect(onFocusHeading).not.toHaveBeenCalled();
  });
});

describe("PrebookPanel — 04's picker, wired to 03's actions with the code", () => {
  it("a tap holds through holdPrebookTime(code, time); Confirm → confirmPrebookTime(code, hold id); then the booked line", async () => {
    const user = userEvent.setup();
    await openPicker();
    await pickTen(user);
    expect(h.holdPrebookTime).toHaveBeenCalledWith(CODE, AT_10);
    expect(await screen.findByText(heldLine(5))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm time" }));
    expect(h.confirmPrebookTime).toHaveBeenCalledWith(CODE, HOLD_ID);
    expect(await screen.findByTestId("deposit-prebook-booked")).toHaveTextContent(prebookBookedLine(AT_10));
    expect(status()).toHaveTextContent(prebookBookedLine(AT_10));
    expect(screen.queryByTestId("deposit-prebook-picker")).toBeNull();
    await waitFor(() => expect(onFocusHeading).toHaveBeenCalledTimes(1));
  });

  it("a refusal shows 04's line (taken → its notice; the list reloads through reloadPrebookTimes(code))", async () => {
    h.holdPrebookTime.mockResolvedValue({ ok: false, error: "taken" });
    const user = userEvent.setup();
    await openPicker();
    await pickTen(user);
    await waitFor(() => expect(h.reloadPrebookTimes).toHaveBeenCalledWith(CODE));
  });

  it.each([
    ["deposit_disabled", () => h.holdPrebookTime.mockResolvedValue({ ok: false, error: "deposit_disabled" })],
    ["a throw", () => h.holdPrebookTime.mockRejectedValue(new Error("offline"))],
  ])("%s from a picker action is a plain failure for the picker", async (_label, arrange) => {
    arrange();
    const user = userEvent.setup();
    await openPicker();
    await pickTen(user);
    const picker = screen.getByTestId("deposit-prebook-picker");
    expect(await within(picker).findByRole("alert")).toHaveTextContent("We couldn't do that — try again");
    expect(onInvalid).not.toHaveBeenCalled();
  });

  it("invalid from a picker action (the link or pre-booking gone) → the page becomes the invalid page", async () => {
    h.holdPrebookTime.mockResolvedValue({ ok: false, error: "invalid" });
    const user = userEvent.setup();
    await openPicker();
    await pickTen(user);
    await waitFor(() => expect(onInvalid).toHaveBeenCalledTimes(1));
  });

  it("a reload that fails or throws → the call-on line with Retry (04's load-failed slot)", async () => {
    h.holdPrebookTime.mockResolvedValue({ ok: false, error: "hold_expired" });
    h.reloadPrebookTimes.mockResolvedValueOnce({ ok: false, error: "error" }).mockRejectedValueOnce(new Error("offline"));
    const user = userEvent.setup();
    await openPicker();
    await pickTen(user);
    expect(await screen.findByText(prebookCallLine(NEXT))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(h.reloadPrebookTimes).toHaveBeenCalledTimes(2));
    expect(await screen.findByText(prebookCallLine(NEXT))).toBeInTheDocument();
  });
});
