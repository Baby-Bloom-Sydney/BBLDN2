import { describe, expect, it } from "vitest";
import { summarise } from "./connections-shared";
import type { ConnectionRequestWithDetails } from "@/lib/actions/connection";

const DAY = 86_400_000;
const row = (stage: number, status: string, expiresInDays: number) =>
  ({
    id: "c1", nanny_id: "n1", parent_id: "p1", status, connection_stage: stage, proposed_times: null,
    expires_at: new Date(Date.now() + expiresInDays * DAY - 60_000).toISOString(), confirmed_time: null, fill_initiated_by: null,
    nanny: { id: "n1", first_name: "Sarah", last_name: "Jones", suburb: "Islington", hourly_rate_min: null, profile_picture_url: null },
    parent: { first_name: "Pia", last_name: "Flow", suburb: "Bow" },
  }) as unknown as ConnectionRequestWithDetails;

describe("summarise — the time left the assistant reads out", () => {
  it("gives the family the days left to book once she has accepted", () => {
    expect(summarise(row(10, "accepted", 3), "parent")?.time_left).toBe("3 days left to book your meet and greet with Sarah");
  });

  it("gives the family no time on a request still waiting on her", () => {
    expect(summarise(row(0, "pending", 6), "parent")?.time_left).toBeNull();
  });

  it("gives the nanny her time left as before", () => {
    expect(summarise(row(0, "pending", 6), "nanny")?.time_left).toBe("5d 23h left");
  });
});
