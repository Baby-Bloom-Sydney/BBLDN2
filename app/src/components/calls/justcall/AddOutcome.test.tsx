/**
 * Under a past attempt made through JustCall (plan 05 §5 B5; brief §0.6–§0.7, §3 admin 6; D2): JustCall's notes and
 * disposition as lines, and on an "outcome needed" entry **Add outcome**, which opens 04's outcome form with Answered
 * chosen, the JustCall line read-only, and a save through `saveJustCallOutcomeAction` with the call's sid (R5).
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ saveJustCallOutcomeAction: vi.fn(), recordCallOutcomeAction: vi.fn() }));
vi.mock("@/app/admin/calls/justcall-actions", () => ({ saveJustCallOutcomeAction: h.saveJustCallOutcomeAction }));
vi.mock("@/app/admin/calls/actions", () => ({ recordCallOutcomeAction: h.recordCallOutcomeAction }));

import type { AttemptView } from "@/lib/calls/family-panel";
import { JustCallAttemptAction } from "./AddOutcome";

const P1 = "b0500000-0000-4000-8000-000000000017";
const BOOKING = "c0500000-0000-4000-8000-000000000001";
const FAMILY = { parentUserId: P1, bookingId: BOOKING };
const BASE: AttemptView = { key: "e-1", when: "Tue 9 Feb, 14:03 (London time)", what: "Answered", note: null, by: null, callBack: null };
const NEEDS: AttemptView = {
  ...BASE,
  what: "JustCall · Outgoing · Answered — outcome needed · 6 min 12 s",
  justcall: {
    callSid: "CAtest0001", needsOutcome: true, what: "JustCall · Outgoing · Answered — outcome needed · 6 min 12 s",
    lines: ["JustCall notes: wants Tuesdays", "JustCall disposition: Link sent"], summary: "JustCall · Outgoing · 6 min 12 s · Ref CAtest0001",
  },
};

beforeEach(() => {
  h.saveJustCallOutcomeAction.mockReset().mockResolvedValue({ ok: true, value: { entryId: "e-1" } });
  h.recordCallOutcomeAction.mockReset();
});

describe("JustCallAttemptAction", () => {
  it("an attempt not made through JustCall: nothing", () => {
    const { container } = render(<JustCallAttemptAction attempt={BASE} family={FAMILY} onSaved={vi.fn()} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("JustCall's notes and disposition as lines; no Add outcome once his words are in", () => {
    const done: AttemptView = { ...NEEDS, justcall: { ...NEEDS.justcall!, needsOutcome: false } };
    render(<JustCallAttemptAction attempt={done} family={FAMILY} onSaved={vi.fn()} />);
    expect(screen.getByText("JustCall notes: wants Tuesdays")).toBeInTheDocument();
    expect(screen.getByText("JustCall disposition: Link sent")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Add outcome/ })).toBeNull();
  });

  it("outcome needed → Add outcome opens 04's form: Answered chosen, the JustCall line read-only", async () => {
    const user = userEvent.setup();
    render(<JustCallAttemptAction attempt={NEEDS} family={FAMILY} onSaved={vi.fn()} />);
    const add = screen.getByRole("button", { name: "Add outcome: Tue 9 Feb, 14:03 (London time)" });
    expect(add).toHaveAttribute("aria-expanded", "false");
    expect(add).not.toHaveAttribute("aria-controls");
    await user.click(add);
    expect(document.getElementById(add.getAttribute("aria-controls") ?? "")).not.toBeNull();
    expect(add).toHaveAttribute("aria-expanded", "true");
    expect(screen.getByRole("button", { name: "Answered" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText("JustCall · Outgoing · 6 min 12 s · Ref CAtest0001")).toBeInTheDocument();
  });

  it("saves through the JustCall action with the call's sid, her id and booked call; then closes and refreshes", async () => {
    const user = userEvent.setup();
    const onSaved = vi.fn();
    render(<JustCallAttemptAction attempt={NEEDS} family={FAMILY} onSaved={onSaved} />);
    await user.click(screen.getByRole("button", { name: "Add outcome: Tue 9 Feb, 14:03 (London time)" }));
    await user.click(screen.getByRole("button", { name: "Link sent" }));
    await user.click(screen.getByRole("button", { name: "Save outcome" }));
    expect(h.saveJustCallOutcomeAction).toHaveBeenCalledWith({
      parentUserId: P1, bookingId: BOOKING, callSid: "CAtest0001", result: "answered", outcome: "link_sent", note: null, callBackDate: null, callBackTime: null,
    });
    expect(h.recordCallOutcomeAction).not.toHaveBeenCalled();
    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: "Add outcome: Tue 9 Feb, 14:03 (London time)" })).toHaveAttribute("aria-expanded", "false");
  });

  it("a refusal shows its line and keeps the form open", async () => {
    const user = userEvent.setup();
    h.saveJustCallOutcomeAction.mockResolvedValue({ ok: false, error: "not_yours" });
    render(<JustCallAttemptAction attempt={NEEDS} family={FAMILY} onSaved={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Add outcome: Tue 9 Feb, 14:03 (London time)" }));
    await user.click(screen.getByRole("button", { name: "Save outcome" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That call belongs to another family — reload to see it.");
    expect(screen.getByRole("button", { name: "Save outcome" })).toBeInTheDocument();
  });
});

describe("JustCallAttemptAction — after a save (review M5)", () => {
  it("says Saved. in a status line that stays, and moves focus to it", async () => {
    const user = userEvent.setup();
    render(<JustCallAttemptAction attempt={NEEDS} family={FAMILY} onSaved={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: /Add outcome/ }));
    await user.click(screen.getByRole("button", { name: "Save outcome" }));
    const status = await screen.findByText("Outcome saved.");
    expect(status.closest("[role=status]")).not.toBeNull();
    expect(status.closest("[tabindex='-1']")).toHaveFocus();
  });
});
