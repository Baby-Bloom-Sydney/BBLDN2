/**
 * LDN2 unit 3h — a London parent is never asked to verify.
 *
 * Renders the parent hub with a DFY connection, an upcoming intro and one
 * babysitting request in every bucket, and asserts that nothing is locked:
 * no lock icon, no "Verify" text, the Cart goes to payment, and every card
 * opens its own detail. No verified-flag prop is passed — after 3h the
 * hub has no such input, and before 3h its default (`false`) is exactly the
 * never-verified parent this unit unlocks.
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

const DFY_CONNECTION = {
  connectionId: "conn-dfy-1",
  notificationId: "notif-1",
  nannyId: "nanny-dfy",
  connectionStage: 20, // CONNECTION_STAGE.INTRO_SCHEDULED
  proposedTimes: null,
  confirmedTime: "2026-10-10T10:00:00.000Z",
  matchScore: 88,
  distanceKm: 2,
  breakdown: null,
  overQualifiedBonuses: [],
  unmetRequirements: [],
  nanny: {
    firstName: "Dana",
    lastName: "Fox",
    suburb: "Islington",
    profilePicUrl: null,
    hourlyRateMin: 20,
    experienceYears: 4,
    aiHeadline: null,
    dateOfBirth: null,
    schedule: null,
  },
};

vi.mock("@/lib/actions/matching", () => ({
  getDfyConnections: vi.fn(async () => ({ data: [DFY_CONNECTION] })),
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
}));
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
type Bsr = NonNullable<HubProps["babysittingRequests"]>[number];
type Intro = NonNullable<HubProps["upcomingIntros"]>[number];

const POSITION = {
  id: "pos-1",
  parent_id: "parent-1",
  status: "active",
  stage: 10,
  details: null,
  dfy_activated_at: "2026-10-01T09:00:00.000Z",
  created_at: "2026-10-01T09:00:00.000Z",
  updated_at: "2026-10-01T09:00:00.000Z",
  children: [],
} as unknown as HubProps["position"];

function intro(connectionId: string, source: string | null): Intro {
  return {
    connectionId,
    otherPartyName: source === "dfy" ? "Dana Fox" : "Robin Lee",
    otherPartySuburb: "Hackney",
    otherPartyPhoto: null,
    confirmedTime: "2026-10-10T10:00:00.000Z",
    connectionStage: 20,
    fillInitiatedBy: null,
    trialDate: null,
    startDate: null,
    status: "accepted",
    proposedTimes: null,
    message: null,
    expiresAt: null,
    nannyPhoneShared: null,
    positionId: "pos-1",
    position: null,
    source,
    nannyId: source === "dfy" ? "nanny-dfy" : "nanny-intro",
  };
}

function bsr(id: string, status: string, day: string): Bsr {
  return {
    id,
    parent_id: "parent-1",
    title: null,
    description: null,
    special_requirements: null,
    suburb: "Camden",
    postcode: "NW1",
    address: null,
    hourly_rate: 20,
    status,
    accepted_nanny_id: null,
    accepted_at: null,
    nannies_notified_count: 0,
    created_at: "2026-10-01T09:00:00.000Z",
    expires_at: null,
    cancelled_by: null,
    slots: [
      {
        id: `${id}-slot`,
        slot_date: day,
        start_time: "18:00:00",
        end_time: "21:00:00",
        is_selected: true,
      },
    ],
    requestingNannies: [],
  } as Bsr;
}

const CART = bsr("bsr-cart", "pending_payment", "2026-10-20");
const AWAITING = bsr("bsr-awaiting", "open", "2026-10-21");
const BOOKED = bsr("bsr-booked", "filled", "2026-10-22");
const PAST = bsr("bsr-past", "completed", "2026-09-01");

function renderConnections() {
  return render(
    <ParentHubClient
      position={POSITION}
      upcomingIntros={[intro("conn-dfy-1", "dfy"), intro("conn-intro-1", null)]}
      dfyActivated
      dfyExpiresAt="2099-01-01T00:00:00.000Z"
      initialTab="childcare"
      initialSub="connections"
    />,
  );
}

function renderBabysitting(requests: Bsr[]) {
  return render(
    <ParentHubClient
      position={POSITION}
      babysittingRequests={requests}
      initialTab="babysitting"
    />,
  );
}

function openPast() {
  fireEvent.click(screen.getByRole("button", { name: /Past \(1\)/ }));
}

const originalLocation = window.location;

beforeEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: { ...originalLocation, href: "http://localhost/parent" },
  });
});

afterEach(() => {
  Object.defineProperty(window, "location", {
    configurable: true,
    writable: true,
    value: originalLocation,
  });
});

describe("ParentHubClient — no parent verification lock (3h)", () => {
  it("renders no lock icon on any card when the hub has DFY, intro and every BSR bucket", async () => {
    const connections = renderConnections();
    await screen.findByText("Dana");
    expect(connections.container.querySelector(".lucide-lock")).toBeNull();
    connections.unmount();

    const active = renderBabysitting([CART, AWAITING, BOOKED, PAST]);
    openPast();
    expect(active.container.querySelector(".lucide-lock")).toBeNull();
    active.unmount();

    // The no-active branch renders its own Past list (L4).
    const pastOnly = renderBabysitting([PAST]);
    openPast();
    expect(pastOnly.container.querySelector(".lucide-lock")).toBeNull();
  });

  it('renders no "Verify" text or verify banner when the parent has never verified', async () => {
    renderConnections();
    await screen.findByText("Dana");
    expect(screen.queryAllByText(/verify/i)).toHaveLength(0);
    expect(
      screen.queryByRole("region", { name: /verification required/i }),
    ).toBeNull();
    expect(
      document.querySelector('a[href*="verif"]'),
    ).toBeNull();
  });

  it("links the babysitting Cart tile to /parent/babysitting/{id}/payment when the request is pending payment", () => {
    renderBabysitting([CART]);
    fireEvent.click(screen.getByText("Checkout"));
    expect(window.location.href).toBe("/parent/babysitting/bsr-cart/payment");
    expect(screen.queryByText(/verify your account/i)).toBeNull();
  });

  it("opens the intro detail, not a verify modal, when a DFY connection card is clicked", async () => {
    renderConnections();
    fireEvent.click(await screen.findByText("Dana"));
    expect(await screen.findByTestId("connection-detail")).toHaveTextContent(
      "conn-dfy-1",
    );
    expect(screen.queryByText(/verify your account/i)).toBeNull();
  });

  it("opens the BSR detail when an Awaiting, Bookings or Past tile is clicked", async () => {
    for (const [request, title] of [
      [AWAITING, "Babysitting Request"],
      [BOOKED, "Babysitting Booking"],
      [PAST, "Babysitting Request"],
    ] as const) {
      const view = renderBabysitting([AWAITING, BOOKED, PAST]);
      if (request === PAST) openPast();
      const tile = view.container.querySelector<HTMLElement>(
        `[data-bsr-id="${request.id}"]`,
      );
      const target =
        tile ??
        within(view.container).getAllByRole("button").find((b) =>
          b.textContent?.includes(
            new Date(`${request.slots[0].slot_date}T00:00:00`).toLocaleDateString(
              "en-GB",
              { weekday: "short", day: "numeric", month: "short" },
            ),
          ),
        );
      expect(target).toBeTruthy();
      fireEvent.click(target as HTMLElement);
      await waitFor(() => expect(screen.getByText(title)).toBeInTheDocument());
      expect(screen.queryByText(/verify your account/i)).toBeNull();
      view.unmount();
    }
  });
});
