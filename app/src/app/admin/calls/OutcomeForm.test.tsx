/**
 * The outcome form in the row drawer (plan C4; brief §3 admin 3, §11 Q4; BB-wave1-041126/04c1-build). The chip rows
 * of `LeadDrawerLogContactForm` (rounded-full, ring-1 ring-inset, aria-pressed, a second tap unselects): the result
 * (Answered / No answer / Voicemail left / Wrong number); the outcome only for Answered; "Stop calling" on its own;
 * a call-back time (London) for "Call back later"; a note. Refusals are one line, in an alert.
 *
 * `prefill`, `extraReadOnly` and `onSaved` are brief 05's "after call" hook.
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const actions = vi.hoisted(() => ({ recordCallOutcomeAction: vi.fn() }));
vi.mock("./actions", () => actions);

import { OutcomeForm } from "./OutcomeForm";
import { AVA, BOOKING } from "./calls-fixtures.test-util";

const chip = (name: string) => screen.getByRole("button", { name });
const save = () => screen.getByRole("button", { name: "Save outcome" });

beforeEach(() => {
  actions.recordCallOutcomeAction.mockReset();
  actions.recordCallOutcomeAction.mockResolvedValue({ ok: true, value: { entryId: "e-1" } });
});

describe("OutcomeForm — the chips", () => {
  it("four result chips; the outcome row appears only for Answered; Save waits for a result", async () => {
    const user = userEvent.setup();
    render(<OutcomeForm parentUserId={AVA} bookingId={BOOKING} />);
    expect(["Answered", "No answer", "Voicemail left", "Wrong number"].map((n) => chip(n).getAttribute("aria-pressed"))).toEqual(["false", "false", "false", "false"]);
    expect(screen.queryByRole("button", { name: "Deposit taken" })).not.toBeInTheDocument();
    expect(save()).toBeDisabled();
    await user.click(chip("Answered"));
    expect(chip("Answered")).toHaveAttribute("aria-pressed", "true");
    expect(["Deposit taken", "Link sent", "Call back later", "Not going ahead", "Pre-booked next cohort", "Other"].every((n) => chip(n))).toBe(true);
    expect(save()).toBeEnabled();
    await user.click(chip("No answer"));
    expect(screen.queryByRole("button", { name: "Deposit taken" })).not.toBeInTheDocument();
  });

  it("the chip styling matches the contacts log (rounded-full, ring-1 ring-inset; ring-2 when chosen)", async () => {
    const user = userEvent.setup();
    render(<OutcomeForm parentUserId={AVA} bookingId={null} />);
    expect(chip("Answered").className).toContain("rounded-full");
    expect(chip("Answered").className).toContain("ring-1 ring-inset");
    await user.click(chip("Answered"));
    expect(chip("Answered").className).toContain("ring-2");
  });

  it("a second tap unselects (and hides the outcome row)", async () => {
    const user = userEvent.setup();
    render(<OutcomeForm parentUserId={AVA} bookingId={null} />);
    await user.click(chip("Answered"));
    await user.click(chip("Answered"));
    expect(chip("Answered")).toHaveAttribute("aria-pressed", "false");
    expect(screen.queryByRole("button", { name: "Deposit taken" })).not.toBeInTheDocument();
  });

  it("Stop calling stands on its own: Save is enabled without a result", async () => {
    const user = userEvent.setup();
    render(<OutcomeForm parentUserId={AVA} bookingId={null} />);
    await user.click(chip("Stop calling"));
    expect(save()).toBeEnabled();
  });
});

describe("OutcomeForm — saving", () => {
  it("No answer with a note → recorded against her booked call; the form clears; onSaved", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<OutcomeForm parentUserId={AVA} bookingId={BOOKING} onSaved={onSaved} />);
    await user.click(chip("No answer"));
    await user.type(screen.getByLabelText("Note (optional)"), "Rang twice");
    await user.click(save());
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith("e-1"));
    expect(actions.recordCallOutcomeAction).toHaveBeenCalledWith({
      parentUserId: AVA,
      bookingId: BOOKING,
      result: "no_answer",
      outcome: null,
      note: "Rang twice",
      callBackDate: null,
      callBackTime: null,
    });
    expect(chip("No answer")).toHaveAttribute("aria-pressed", "false");
    expect(screen.getByLabelText("Note (optional)")).toHaveValue("");
    expect(screen.getByRole("status")).toHaveTextContent("Saved.");
  });

  it("Answered · Call back later with a London call-back time", async () => {
    const user = userEvent.setup();
    render(<OutcomeForm parentUserId={AVA} bookingId={BOOKING} />);
    await user.click(chip("Answered"));
    expect(screen.queryByLabelText("Call back date")).not.toBeInTheDocument();
    await user.click(chip("Call back later"));
    expect(screen.getByText("Call back at (London time)")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Call back date"), "2027-02-05");
    await user.type(screen.getByLabelText("Call back time"), "17:30");
    await user.click(save());
    await waitFor(() => expect(actions.recordCallOutcomeAction).toHaveBeenCalled());
    expect(actions.recordCallOutcomeAction.mock.calls[0][0]).toMatchObject({ result: "answered", outcome: "call_back_later", callBackDate: "2027-02-05", callBackTime: "17:30" });
  });

  it("a call-back with only a date (or only a time) can't be saved, and says why (review: it was dropped silently)", async () => {
    const user = userEvent.setup();
    render(<OutcomeForm parentUserId={AVA} bookingId={BOOKING} />);
    await user.click(chip("Answered"));
    await user.click(chip("Call back later"));
    await user.type(screen.getByLabelText("Call back date"), "2027-02-05");
    expect(save()).toBeDisabled();
    expect(screen.getByText("Add both a date and a time, or neither.")).toBeInTheDocument();
    await user.type(screen.getByLabelText("Call back time"), "17:30");
    expect(save()).toBeEnabled();
    expect(screen.queryByText("Add both a date and a time, or neither.")).not.toBeInTheDocument();
  });

  it("Stop calling while booked → 'Cancel the booked time first', in an alert; nothing cleared", async () => {
    const user = userEvent.setup();
    actions.recordCallOutcomeAction.mockResolvedValue({ ok: false, error: "booked_call_exists" });
    render(<OutcomeForm parentUserId={AVA} bookingId={BOOKING} />);
    await user.click(chip("Stop calling"));
    await user.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("Cancel the booked time first");
    expect(chip("Stop calling")).toHaveAttribute("aria-pressed", "true");
  });

  it("a throw is a refusal, never a stuck form", async () => {
    const user = userEvent.setup();
    actions.recordCallOutcomeAction.mockRejectedValue(new Error("network"));
    render(<OutcomeForm parentUserId={AVA} bookingId={null} />);
    await user.click(chip("Wrong number"));
    await user.click(save());
    expect(await screen.findByRole("alert")).toHaveTextContent("That didn't save — try again.");
    expect(save()).toBeEnabled();
  });
});

describe("OutcomeForm — one save per press (review round 2 M3)", () => {
  it("a double click while the first save is in flight sends it once", async () => {
    const user = userEvent.setup();
    let release: (v: unknown) => void = () => {};
    actions.recordCallOutcomeAction.mockImplementation(() => new Promise((resolve) => (release = resolve)));
    render(<OutcomeForm parentUserId={AVA} bookingId={BOOKING} />);
    await user.click(chip("No answer"));
    const button = save(); // the same element twice, as a real double click
    fireEvent.click(button);
    fireEvent.click(button);
    expect(actions.recordCallOutcomeAction).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    release({ ok: true, value: { entryId: "e-1" } });
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent("Saved."));
  });
});

describe("OutcomeForm — brief 05's hook", () => {
  it("prefill sets the chips and the note; extraReadOnly shows above them", () => {
    render(
      <OutcomeForm
        parentUserId={AVA}
        bookingId={null}
        prefill={{ result: "answered", outcome: "link_sent", note: "From JustCall" }}
        extraReadOnly={<p>Call lasted 4 minutes</p>}
      />,
    );
    expect(chip("Answered")).toHaveAttribute("aria-pressed", "true");
    expect(chip("Link sent")).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByLabelText("Note (optional)")).toHaveValue("From JustCall");
    expect(screen.getByText("Call lasted 4 minutes")).toBeInTheDocument();
  });
});
