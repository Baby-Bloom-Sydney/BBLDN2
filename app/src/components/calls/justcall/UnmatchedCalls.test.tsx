/**
 * Unmatched JustCall calls on /admin/calls (plan 05 §5 B4; brief §0.9, §3 admin 7, §7): "Unmatched JustCall calls
 * (3)", a captioned table (number, London time, direction, result, length, why), **Attach to family** (a dialog) and
 * **Dismiss** (asked once, then gone). Result and reason use `StatusBadge` tones.
 */
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ dismissJustCallAction: vi.fn(), attachJustCallAction: vi.fn(), searchFamiliesForCallAction: vi.fn() }));
vi.mock("@/app/admin/calls/justcall-actions", () => h);

import type { UnmatchedList } from "@/lib/justcall/types";
import { UnmatchedCalls } from "./UnmatchedCalls";

const LIST: UnmatchedList = {
  total: 2,
  calls: [
    { callSid: "CAun0001", number: "+44 (0) 7700 900 599", when: "Tue 9 Feb, 14:03 (London time)", direction: "Outgoing", result: "Answered", duration: "6 min 12 s", reason: "No family with this number", resultCode: "answered", matchNote: "none" },
    { callSid: "CAun0002", number: "+44 (0) 7700 900 123", when: "Tue 9 Feb, 15:00 (London time)", direction: "Incoming", result: "No answer", duration: "—", reason: "Number on more than one family", resultCode: "no_answer", matchNote: "several" },
  ],
};

beforeEach(() => {
  h.dismissJustCallAction.mockReset().mockResolvedValue({ ok: true, value: { replay: false } });
  h.attachJustCallAction.mockReset();
  h.searchFamiliesForCallAction.mockReset();
});

describe("UnmatchedCalls", () => {
  it("a heading with the count, and a captioned table of the calls", () => {
    render(<UnmatchedCalls list={LIST} onChanged={vi.fn()} />);
    expect(screen.getByRole("heading", { level: 2, name: "Unmatched JustCall calls (2)" })).toBeInTheDocument();
    const table = screen.getByRole("table", { name: "Unmatched JustCall calls" });
    expect(within(table).getAllByRole("columnheader").map((c) => c.textContent)).toEqual(["Number", "When", "Direction", "Result", "Length", "Why", "Actions"]);
    const row = within(table).getAllByRole("row")[1];
    expect(within(row).getAllByRole("cell").slice(0, 6).map((c) => c.textContent)).toEqual([
      "+44 (0) 7700 900 599", "Tue 9 Feb, 14:03 (London time)", "Outgoing", "Answered", "6 min 12 s", "No family with this number",
    ]);
  });

  it("StatusBadge tones: Answered green, No answer slate; one family none grey, several amber", () => {
    render(<UnmatchedCalls list={LIST} onChanged={vi.fn()} />);
    expect(screen.getByText("Answered")).toHaveClass("bg-green-100");
    expect(screen.getByText("No answer")).toHaveClass("bg-slate-100");
    expect(screen.getByText("No family with this number")).toHaveClass("bg-gray-100");
    expect(screen.getByText("Number on more than one family")).toHaveClass("bg-yellow-100");
  });

  it("none → the heading with 0 and 'None right now.'; a failed read says so", () => {
    const { rerender } = render(<UnmatchedCalls list={{ calls: [], total: 0 }} onChanged={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Unmatched JustCall calls (0)" })).toBeInTheDocument();
    expect(screen.getByText("None right now.")).toBeInTheDocument();
    rerender(<UnmatchedCalls list={null} onChanged={vi.fn()} />);
    expect(screen.getByRole("alert")).toHaveTextContent("The JustCall calls could not be read — reload to try again.");
    expect(screen.getByRole("heading", { level: 2 })).toHaveTextContent(/^Unmatched JustCall calls$/);
  });

  it("more than shown → 'Showing the newest 100.'", () => {
    render(<UnmatchedCalls list={{ ...LIST, total: 140 }} onChanged={vi.fn()} />);
    expect(screen.getByRole("heading", { name: "Unmatched JustCall calls (140)" })).toBeInTheDocument();
    expect(screen.getByText("Showing the newest 100.")).toBeInTheDocument();
  });

  it("Dismiss asks once; Keep backs out; Dismiss again dismisses it and refreshes", async () => {
    const user = userEvent.setup();
    const onChanged = vi.fn();
    render(<UnmatchedCalls list={LIST} onChanged={onChanged} />);
    const row = () => within(screen.getByRole("table", { name: "Unmatched JustCall calls" })).getAllByRole("row")[1];
    await user.click(within(row()).getByRole("button", { name: "Dismiss: +44 (0) 7700 900 599" }));
    expect(within(row()).getByText("Dismiss this call? It leaves the list.")).toBeInTheDocument();
    await user.click(within(row()).getByRole("button", { name: "Keep" }));
    expect(h.dismissJustCallAction).not.toHaveBeenCalled();
    await user.click(within(row()).getByRole("button", { name: "Dismiss: +44 (0) 7700 900 599" }));
    await user.click(within(row()).getByRole("button", { name: "Dismiss" }));
    expect(h.dismissJustCallAction).toHaveBeenCalledWith({ callSid: "CAun0001" });
    expect(onChanged).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Dismissed.");
  });

  it("focus (review H1): to the question's Dismiss when asked; back to the row's Dismiss on Keep; to the heading once dismissed", async () => {
    const user = userEvent.setup();
    render(<UnmatchedCalls list={LIST} onChanged={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Dismiss: +44 (0) 7700 900 599" }));
    const question = screen.getByRole("group", { name: "Dismiss this call? It leaves the list.: +44 (0) 7700 900 599" });
    expect(within(question).getByRole("button", { name: "Dismiss" })).toHaveFocus();
    await user.click(within(question).getByRole("button", { name: "Keep" }));
    expect(screen.getByRole("button", { name: "Dismiss: +44 (0) 7700 900 599" })).toHaveFocus();
    await user.click(screen.getByRole("button", { name: "Dismiss: +44 (0) 7700 900 599" }));
    await user.click(within(screen.getByRole("group")).getByRole("button", { name: "Dismiss" }));
    expect(screen.getByRole("heading", { level: 2 })).toHaveFocus();
  });

  it("a dismissed call leaves the table at once, before the refresh lands (review L10)", async () => {
    const user = userEvent.setup();
    render(<UnmatchedCalls list={LIST} onChanged={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Dismiss: +44 (0) 7700 900 599" }));
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText("+44 (0) 7700 900 599")).toBeNull();
    expect(screen.getByText("+44 (0) 7700 900 123")).toBeInTheDocument();
  });

  it("while a dismiss is in flight every row's buttons wait (TS review L)", async () => {
    const user = userEvent.setup();
    h.dismissJustCallAction.mockImplementation(() => new Promise(() => {}));
    render(<UnmatchedCalls list={LIST} onChanged={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Dismiss: +44 (0) 7700 900 599" }));
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.getByRole("button", { name: "Attach to family: +44 (0) 7700 900 123" })).toBeDisabled();
  });

  it("a dismiss refused shows its line, and nothing refreshes", async () => {
    const user = userEvent.setup();
    h.dismissJustCallAction.mockResolvedValue({ ok: false, error: "not_unmatched" });
    const onChanged = vi.fn();
    render(<UnmatchedCalls list={LIST} onChanged={onChanged} />);
    await user.click(screen.getByRole("button", { name: "Dismiss: +44 (0) 7700 900 599" }));
    await user.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("That call has already been attached or dismissed — reload to see it.");
    expect(onChanged).not.toHaveBeenCalled();
  });

  it("Attach to family opens the dialog for that call", async () => {
    const user = userEvent.setup();
    render(<UnmatchedCalls list={LIST} onChanged={vi.fn()} />);
    await user.click(screen.getByRole("button", { name: "Attach to family: +44 (0) 7700 900 123" }));
    const dialog = screen.getByRole("dialog", { name: "Attach this call to a family" });
    expect(within(dialog).getByText("+44 (0) 7700 900 123 · Tue 9 Feb, 15:00 (London time)")).toBeInTheDocument();
  });
});
