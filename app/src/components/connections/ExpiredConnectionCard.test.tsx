import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/actions/connection", () => ({ createConnectionRequest: vi.fn(async () => ({ success: true, error: null })) }));
vi.mock("@/lib/legal/record-consent", () => ({ recordInformedAction: vi.fn(async () => {}) }));

import { ExpiredConnectionCard } from "./ExpiredConnectionCard";
import { BookingDaysLeftNote } from "./BookingDaysLeftNote";

const expired = (because: "no_reply" | "not_booked") => ({
  connectionId: "r1", nannyId: "nA", nannyFirstName: "Sarah", nannyLastName: "Jones", nannyName: "Sarah Jones", nannySuburb: "Islington",
  nannyPhoto: null, source: "parent", expiredBecause: because,
});

describe("ExpiredConnectionCard", () => {
  it("shows Expired, the reason she didn't reply, and the button", () => {
    render(<ExpiredConnectionCard connection={expired("no_reply")} pendingRequestCount={0} />);
    expect(screen.getByText("Expired")).toBeInTheDocument();
    expect(screen.getByText("Your connection has expired: Sarah didn't reply in time.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect with Sarah again" })).toBeInTheDocument();
  });

  it("shows the reason the meet and greet wasn't booked", () => {
    render(<ExpiredConnectionCard connection={expired("not_booked")} pendingRequestCount={0} />);
    expect(screen.getByText("Your connection has expired: the meet and greet wasn't booked in time.")).toBeInTheDocument();
  });

  it("opens the connect form for her from the button", () => {
    render(<ExpiredConnectionCard connection={expired("no_reply")} pendingRequestCount={1} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect with Sarah again" }));
    expect(screen.getByRole("heading", { name: "Connect with Sarah" })).toBeInTheDocument();
    expect(document.querySelector("textarea")).not.toBeNull();
  });

  it("opens the limit message at 5 open requests", () => {
    render(<ExpiredConnectionCard connection={expired("no_reply")} pendingRequestCount={5} />);
    fireEvent.click(screen.getByRole("button", { name: "Connect with Sarah again" }));
    expect(screen.getByRole("heading", { name: "You have 5 open requests" })).toBeInTheDocument();
  });
});

describe("ExpiredConnectionCard — her name as each list shows it", () => {
  it("shows a matched nanny by her first name, and a family-sent one by her full name", () => {
    const { rerender } = render(<ExpiredConnectionCard connection={{ ...expired("not_booked"), source: "dfy" }} pendingRequestCount={0} />);
    expect(screen.queryByText("Sarah Jones")).toBeNull();
    expect(screen.getByText("Sarah")).toBeInTheDocument();
    rerender(<ExpiredConnectionCard connection={expired("no_reply")} pendingRequestCount={0} />);
    expect(screen.getByText("Sarah Jones")).toBeInTheDocument();
  });
});

describe("BookingDaysLeftNote", () => {
  it("shows the line for a stage-10 row and nothing otherwise", () => {
    const later = new Date(Date.now() + 3 * 86_400_000 - 60_000).toISOString();
    const { container, rerender } = render(
      <BookingDaysLeftNote row={{ connectionStage: 10, expiresAt: later, proposedTimes: null }} name="Sarah" />,
    );
    expect(screen.getByText("3 days left to book your meet and greet with Sarah")).toBeInTheDocument();
    rerender(<BookingDaysLeftNote row={{ connectionStage: 0, expiresAt: later, proposedTimes: null }} name="Sarah" />);
    expect(container.textContent).toBe("");
  });
});
