/**
 * The hub card (plan B7; brief §0.5, §9.5): one card at the top of /parent. Booked → "Your Complimentary matchmaker
 * call: Tue 9 Feb, 14:00 (London time) · Change"; not booked → "Pick a time for your Complimentary matchmaker call";
 * no card → nothing at all (hidden after Answered or Stop calling, and outside the scope — decided by `hubCardFor`).
 */
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { CallHubCard } from "./CallHubCard";

describe("CallHubCard", () => {
  it("booked: the line and a Change link to the call page", () => {
    const { container } = render(<CallHubCard card={{ kind: "booked", line: "Your Complimentary matchmaker call: Tue 9 Feb, 14:00 (London time)", changeable: true }} />);
    expect(container).toHaveTextContent("Your Complimentary matchmaker call: Tue 9 Feb, 14:00 (London time) · Change");
    expect(screen.getByRole("link", { name: "Change" })).toHaveAttribute("href", "/matchmaking/call");
  });

  it("booked, at or after the start: the line, no Change", () => {
    render(<CallHubCard card={{ kind: "booked", line: "Your Complimentary matchmaker call: Tue 9 Feb, 14:00 (London time)", changeable: false }} />);
    expect(screen.getByText("Your Complimentary matchmaker call: Tue 9 Feb, 14:00 (London time)")).toBeInTheDocument();
    expect(screen.queryByRole("link")).not.toBeInTheDocument();
  });

  it("not booked: 'Pick a time…' links to the call page", () => {
    render(<CallHubCard card={{ kind: "not_booked", line: "Pick a time for your Complimentary matchmaker call" }} />);
    expect(screen.getByRole("link", { name: "Pick a time for your Complimentary matchmaker call" })).toHaveAttribute("href", "/matchmaking/call");
  });

  it("no card → renders nothing", () => {
    const { container } = render(<CallHubCard card={null} />);
    expect(container.innerHTML).toBe("");
  });
});
