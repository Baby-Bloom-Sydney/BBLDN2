import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { ConnectionTile } from "./ConnectionTile";
import type { ConnectionRequestWithDetails } from "@/lib/actions/connection";

const DAY = 86_400_000;
const row = (stage: number, status: string, expiresInDays: number) =>
  ({
    id: "c1", nanny_id: "n1", parent_id: "p1", status, connection_stage: stage, proposed_times: null,
    expires_at: new Date(Date.now() + expiresInDays * DAY - 60_000).toISOString(), confirmed_time: null,
    nanny: { id: "n1", first_name: "Sarah", last_name: "Jones", suburb: "Islington", hourly_rate_min: null, profile_picture_url: null },
    parent: { first_name: "Pia", last_name: "Flow", suburb: "Bow" },
  }) as unknown as ConnectionRequestWithDetails;

describe("ConnectionTile — time left", () => {
  it("shows the family the days left to book once she has accepted, with no hours", () => {
    render(<ConnectionTile request={row(10, "accepted", 3)} viewerRole="parent" />);
    expect(screen.getByText("3 days left to book your meet and greet with Sarah")).toBeInTheDocument();
    expect(screen.queryByText(/\dh/)).toBeNull();
  });

  it("shows the family no time on a request still waiting on her", () => {
    render(<ConnectionTile request={row(0, "pending", 6)} viewerRole="parent" />);
    expect(screen.queryByText(/left/)).toBeNull();
  });

  it("shows the nanny her time left as before", () => {
    render(<ConnectionTile request={row(0, "pending", 6)} viewerRole="nanny" />);
    expect(screen.getByText("5d 23h left")).toBeInTheDocument();
  });
});
