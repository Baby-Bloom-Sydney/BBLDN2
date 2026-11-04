/**
 * The call card on her Childcare tab ("My childcare" sub-tab; brief 04 §0a.4; 04b rework W9, W12). Shown only while no
 * nanny is hired or connected (decided by the page). States:
 *   not booked        "Your Complimentary matchmaker call" · 04b's intro · "Book a time"
 *   after no-answer   … "We tried to call you — pick another time" · "Book a time"
 *   booked            … "Tue 9 Feb, 14:00 (London time)" · "Change time" (moves the same booking; never a second)
 * W12: both buttons open the call popup in place — no navigation. No card → nothing at all.
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CallHubCard } from "./CallHubCard";

const card = (c: Parameters<typeof CallHubCard>[0]["card"]) => {
  const onBook = vi.fn();
  const onChange = vi.fn();
  render(<CallHubCard card={c} onBook={onBook} onChange={onChange} />);
  return { onBook, onChange };
};

describe("CallHubCard", () => {
  it("not booked: the call's name, 04b's intro, and Book a time opens the popup in place", async () => {
    const user = userEvent.setup();
    const { onBook } = card({ kind: "not_booked", afterNoAnswer: false });
    expect(screen.getByRole("heading", { name: "Your Complimentary matchmaker call" })).toBeInTheDocument();
    expect(screen.getByText("Pick a time and we'll call you then. All times are London time.")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Book a time" }));
    expect(onBook).toHaveBeenCalled();
  });

  it("after a no-answer: 'We tried to call you — pick another time' and Book a time", () => {
    card({ kind: "not_booked", afterNoAnswer: true });
    expect(screen.getByText("We tried to call you — pick another time")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Book a time" })).toBeInTheDocument();
  });

  it("booked: her time and Change time (opens the popup changing her booking, never a second)", async () => {
    const user = userEvent.setup();
    const { onChange, onBook } = card({ kind: "booked", line: "Tue 9 Feb, 14:00 (London time)", changeable: true });
    expect(screen.getByText("Tue 9 Feb, 14:00 (London time)")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Book a time" })).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Change time" }));
    expect(onChange).toHaveBeenCalled();
    expect(onBook).not.toHaveBeenCalled();
  });

  it("booked, at or after the start: her time, no Change time", () => {
    card({ kind: "booked", line: "Tue 9 Feb, 14:00 (London time)", changeable: false });
    expect(screen.getByText("Tue 9 Feb, 14:00 (London time)")).toBeInTheDocument();
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("no card → renders nothing", () => {
    const { container } = render(<CallHubCard card={null} onBook={vi.fn()} onChange={vi.fn()} />);
    expect(container.innerHTML).toBe("");
  });
});
