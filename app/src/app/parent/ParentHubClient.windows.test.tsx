/**
 * The family's hub: the days left to book under a nanny who has accepted (Connections and Matched Nannies), and the
 * expired connections kept on both lists with their reason and "Connect with NAME again".
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  render,
  screen,
  fireEvent,
  waitFor,
  within,
} from "@testing-library/react";
import type { ComponentProps } from "react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/parent",
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ profile: { first_name: "Pat", profile_picture_url: null } }),
}));


const DAY = 86_400_000;
const h = vi.hoisted(() => ({ dfy: [] as unknown[] }));
const inDays = (d: number) => new Date(Date.now() + d * DAY - 60_000).toISOString();

vi.mock("@/lib/actions/matching", () => ({
  getDfyConnections: vi.fn(async () => ({ data: h.dfy })),
  declineDfyConnection: vi.fn(),
}));
vi.mock("@/lib/actions/parent", () => ({ closePosition: vi.fn() }));
vi.mock("@/lib/actions/position-funnel", () => ({
  parentInitiateFill: vi.fn(),
  confirmPlacement: vi.fn(),
  reportParentOutcome: vi.fn(),
  rejectHiredClaim: vi.fn(),
  revertToAwaiting: vi.fn(),
  closePositionWithReason: vi.fn(),
  scheduleIntroTime: vi.fn(),
  updateConnectionStartWeek: vi.fn(),
  removeNannyPlacement: vi.fn(),
  updateParentPlacementRate: vi.fn(),
  updateParentPlacementHours: vi.fn(),
  confirmTrialArrangement: vi.fn(),
  declineTrialArrangement: vi.fn(),
}));
vi.mock("@/lib/actions/connection", () => ({
  cancelConnectionRequest: vi.fn(),
  createConnectionRequest: vi.fn(async () => ({ success: true, error: null })),
}));
vi.mock("@/lib/legal/record-consent", () => ({ recordInformedAction: vi.fn(async () => {}) }));
vi.mock("@/lib/actions/babysitting", () => ({
  cancelBabysittingRequest: vi.fn(),
  parentAcceptNanny: vi.fn(),
}));

// The detail popup is its own unit; the hub's job is only to open it with
// the right intro. The stub makes "which detail opened" observable.
vi.mock("@/components/position/ConnectionDetailPopup", () => ({
  ConnectionDetailPopup: ({
    intro,
    open,
  }: {
    intro: { connectionId: string } | null;
    open: boolean;
  }) =>
    open && intro ? (
      <div data-testid="connection-detail">{intro.connectionId}</div>
    ) : null,
}));
vi.mock("@/components/parent/BrowseNanniesTab", () => ({
  BrowseNanniesTab: () => null,
}));
vi.mock("@/components/parent/MyChildcareTab", () => ({
  MyChildcareTab: () => null,
}));
vi.mock("@/components/parent/ParentAvatarEditor", () => ({
  ParentAvatarEditor: () => null,
}));
vi.mock("@/components/bapp/ChildCardGrid", () => ({
  ChildCardGrid: () => null,
}));
vi.mock("@/components/bapp/PendingInvitesSection", () => ({
  PendingInvitesSection: () => null,
}));
vi.mock("../parent/request/renderers/PositionDetailView", () => ({
  PositionDetailView: () => null,
}));

import { ParentHubClient } from "./ParentHubClient";

type HubProps = ComponentProps<typeof ParentHubClient>;
type Intro = NonNullable<HubProps["upcomingIntros"]>[number];
type Expired = NonNullable<HubProps["expiredConnections"]>[number];

const POSITION = {
  id: "pos-1", parent_id: "parent-1", status: "active", stage: 10, details: null,
  dfy_activated_at: "2026-10-01T09:00:00.000Z", created_at: "2026-10-01T09:00:00.000Z", updated_at: "2026-10-01T09:00:00.000Z", children: [],
} as unknown as HubProps["position"];

const accepted: Intro = {
  connectionId: "conn-10", otherPartyName: "Robin Lee", otherPartySuburb: "Hackney", otherPartyPhoto: null, confirmedTime: "",
  connectionStage: 10, fillInitiatedBy: null, trialDate: null, startDate: null, status: "accepted", proposedTimes: null, message: null,
  expiresAt: inDays(3), nannyPhoneShared: null, positionId: null, position: null, source: "parent", nannyId: "nanny-robin",
};
const dfyAccepted: unknown = {
  connectionId: "dfy-10", notificationId: "n1", nannyId: "nanny-dana", connectionStage: 10, proposedTimes: null, confirmedTime: null,
  expiresAt: inDays(2), matchScore: 80, distanceKm: 2, breakdown: null, overQualifiedBonuses: [], unmetRequirements: [],
  nanny: { firstName: "Dana", lastName: "Fox", suburb: "Islington", profilePicUrl: null, hourlyRateMin: 20, experienceYears: 4, aiHeadline: null, age: 30, schedule: null },
};
const expired = (id: string, first: string, source: string, because: "no_reply" | "not_booked"): Expired => ({
  connectionId: id, nannyId: `nanny-${first}`, nannyFirstName: first, nannyName: `${first} Hart`, nannySuburb: "Bow", nannyPhoto: null, source, expiredBecause: because,
});

function renderHub(props: Partial<HubProps>) {
  return render(
    <ParentHubClient position={POSITION} dfyActivated dfyExpiresAt="2099-01-01T00:00:00.000Z" initialTab="childcare" initialSub="connections" {...props} />,
  );
}

beforeEach(() => {
  h.dfy = [];
});

describe("the family's hub — days left to book", () => {
  it("shows the line under a family-sent request she accepted", async () => {
    renderHub({ upcomingIntros: [accepted] });
    expect(await screen.findByText("3 days left to book your meet and greet with Robin")).toBeInTheDocument();
  });

  it("shows the line on a matched nanny who accepted", async () => {
    h.dfy = [dfyAccepted];
    renderHub({ upcomingIntros: [] });
    expect(await screen.findByText("2 days left to book your meet and greet with Dana")).toBeInTheDocument();
  });

  it("shows no line for a request still waiting on her", async () => {
    renderHub({ upcomingIntros: [{ ...accepted, connectionStage: 0, status: "pending" }] });
    await waitFor(() => expect(screen.getByText("Robin Lee")).toBeInTheDocument());
    expect(screen.queryByText(/left to book/)).toBeNull();
  });
});

describe("the family's hub — expired connections stay", () => {
  it("keeps a family-sent expired connection in Connections, with its reason and the button", async () => {
    renderHub({ upcomingIntros: [], expiredConnections: [expired("r1", "Sarah", "parent", "no_reply")], pendingRequestCount: 1 });
    expect(await screen.findByText("Your connection has expired: Sarah didn't reply in time.")).toBeInTheDocument();
    expect(screen.queryByText("No connections yet")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Connect with Sarah again" }));
    expect(screen.getByRole("heading", { name: "Connect with Sarah" })).toBeInTheDocument();
  });

  it("keeps an expired matched nanny under Matched Nannies", async () => {
    renderHub({ upcomingIntros: [], expiredConnections: [expired("r2", "Cleo", "dfy", "not_booked")] });
    expect(await screen.findByText("Your connection has expired: the meet and greet wasn't booked in time.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Connect with Cleo again" })).toBeInTheDocument();
  });
});
