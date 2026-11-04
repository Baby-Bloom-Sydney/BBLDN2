/**
 * The call card on her Childcare tab ("My childcare" sub-tab; brief 04 §0a.4; 04b rework W9). Shown only while no
 * nanny is hired or connected (decided by the page). States:
 *   not booked        "Your Complimentary matchmaker call" · 04b's intro · "Book a time"
 *   after no-answer   … "We tried to call you — pick another time" · "Book a time"
 *   booked            … "Tue 9 Feb, 14:00 (London time)" · "Change time" (moves the same booking; never a second)
 * Book a time / Change time go to the call with `next` back to her Childcare tab. No card → nothing at all.
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CallHubCard } from "./CallHubCard";

const BOOK = "/matchmaking/call?next=%2Fparent%3Ft%3Dchildcare";
const CHANGE = "/matchmaking/call?change=1&next=%2Fparent%3Ft%3Dchildcare";

describe("CallHubCard", () => {
  it("not booked: the call's name, 04b's intro, and Book a time", () => {
    render(<CallHubCard card={{ kind: "not_booked", afterNoAnswer: false }} />);
    expect(screen.getByRole("heading", { name: "Your Complimentary matchmaker call" })).toBeInTheDocument();
    expect(screen.getByText("Pick a time and we'll call you then. All times are London time.")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Book a time" })).toHaveAttribute("href", BOOK);
  });

  it("after a no-answer: 'We tried to call you — pick another time' and Book a time", () => {
    render(<CallHubCard card={{ kind: "not_booked", afterNoAnswer: true }} />);
    expect(screen.getByText("We tried to call you — pick another time")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Book a time" })).toHaveAttribute("href", BOOK);
  });

  it("booked: her time and Change time (straight into changing, never a second booking)", () => {
    render(<CallHubCard card={{ kind: "booked", line: "Tue 9 Feb, 14:00 (London time)", changeable: true }} />);
    expect(screen.getByText("Tue 9 Feb, 14:00 (London time)")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Change time" })).toHaveAttribute("href", CHANGE);
    expect(screen.queryByRole("link", { name: "Book a time" })).not.toBeInTheDocument();
  });

  it("booked, at or after the start: her time, no Change time", () => {
    render(<CallHubCard card={{ kind: "booked", line: "Tue 9 Feb, 14:00 (London time)", changeable: false }} />);
    expect(screen.getByText("Tue 9 Feb, 14:00 (London time)")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("no card → renders nothing", () => {
    const { container } = render(<CallHubCard card={null} />);
    expect(container.innerHTML).toBe("");
  });
});
