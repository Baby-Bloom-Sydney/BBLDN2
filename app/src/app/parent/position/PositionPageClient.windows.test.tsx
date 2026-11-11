/**
 * The position page's copy of the family's lists: the days left to book under a nanny who has accepted, and the expired
 * connections kept with their reason and "Connect with NAME again".
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import type { ComponentProps } from "react";

const h = vi.hoisted(() => ({ dfy: [] as unknown[] }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }), usePathname: () => "/parent/position" }));
vi.mock("@/lib/analytics/trackEvent", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/actions/parent", () => ({ closePosition: vi.fn() }));
vi.mock("@/lib/actions/position-funnel", () => ({}));
vi.mock("@/lib/actions/connection", () => ({ cancelConnectionRequest: vi.fn(), createConnectionRequest: vi.fn() }));
vi.mock("@/lib/legal/record-consent", () => ({ recordInformedAction: vi.fn(async () => {}) }));
vi.mock("@/lib/actions/babysitting", () => ({}));
vi.mock("@/lib/actions/matching", () => ({ getDfyConnections: vi.fn(async () => ({ data: h.dfy })), declineDfyConnection: vi.fn() }));
vi.mock("../request/renderers/PositionDetailView", () => ({ PositionDetailView: () => null }));
vi.mock("@/components/position/ConnectionDetailPopup", () => ({ ConnectionDetailPopup: () => null }));
vi.mock("@/components/position/ScheduleTimeGrid", () => ({ ScheduleTimeGrid: () => null }));
vi.mock("@/components/parent/PlacementCard", () => ({ PlacementCard: () => null }));

import { PositionPageClient } from "./PositionPageClient";

type Props = ComponentProps<typeof PositionPageClient>;
type Intro = NonNullable<Props["upcomingIntros"]>[number];
const DAY = 86_400_000;
const inDays = (d: number) => new Date(Date.now() + d * DAY - 60_000).toISOString();
const POSITION = { id: "pos-1", status: "active", stage: 10, dfy_activated_at: "2026-10-01T09:00:00.000Z", children: [] } as unknown as Props["position"];
const accepted: Intro = {
  connectionId: "conn-10", otherPartyName: "Robin Lee", otherPartySuburb: "Hackney", otherPartyPhoto: null, confirmedTime: "",
  connectionStage: 10, fillInitiatedBy: null, trialDate: null, startDate: null, status: "accepted", proposedTimes: null, message: null,
  expiresAt: inDays(3), nannyPhoneShared: null, positionId: null, position: null, source: "parent", nannyId: "nanny-robin",
};

beforeEach(() => {
  h.dfy = [];
});

describe("the position page — time left and expired connections", () => {
  it("shows the line under a family-sent request she accepted", () => {
    render(<PositionPageClient position={POSITION} upcomingIntros={[accepted]} />);
    expect(screen.getByText("3 days left to book your meet and greet with Robin")).toBeInTheDocument();
  });

  it("keeps expired connections on both lists, with their reasons and the button", () => {
    render(
      <PositionPageClient
        position={POSITION}
        upcomingIntros={[]}
        pendingRequestCount={0}
        expiredConnections={[
          { connectionId: "r1", nannyId: "nA", nannyFirstName: "Sarah", nannyLastName: "Jones", nannyName: "Sarah Jones", nannySuburb: "Bow", nannyPhoto: null, source: "parent", expiredBecause: "no_reply" },
          { connectionId: "r2", nannyId: "nB", nannyFirstName: "Cleo", nannyLastName: "Jones", nannyName: "Cleo Hart", nannySuburb: "Kew", nannyPhoto: null, source: "dfy", expiredBecause: "not_booked" },
        ]}
      />,
    );
    expect(screen.getByText("Your connection has expired: Sarah didn't reply in time.")).toBeInTheDocument();
    expect(screen.getByText("Your connection has expired: the meet and greet wasn't booked in time.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect with Sarah again" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect with Cleo again" })).toBeInTheDocument();
  });
});
