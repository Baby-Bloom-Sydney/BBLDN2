/**
 * Unit 5g (BB-LDN-5g-151026) — every link to `/parent/matches/checkout` is not rendered while
 * `LEGACY_TIER_CHECKOUT_ENABLED` is off (Stage 5 ruling 7, P-23); with the flag on each renders as before.
 * Sites: MatchResultsClient (×2), PositionPageClient (×2), DfyModal, hub PositionTile, hub MatchesTile.
 * The kept `/parent/matchmaking` links are not this unit's (ledger 5g §1).
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";

const actions = vi.hoisted(() => ({ getDfyConnections: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/parent",
}));
vi.mock("@/lib/analytics/trackEvent", () => ({ trackEvent: vi.fn() }));
vi.mock("@/components/MatchCard", () => ({ MatchCard: () => null }));
vi.mock("@/lib/actions/parent", () => ({ closePosition: vi.fn() }));
vi.mock("@/lib/actions/position-funnel", () => ({
  fillPosition: vi.fn(),
  removePositionConnection: vi.fn(),
  updatePositionRate: vi.fn(),
  updatePositionHours: vi.fn(),
}));
vi.mock("@/lib/actions/connection", () => ({ cancelConnectionRequest: vi.fn() }));
vi.mock("@/lib/actions/babysitting", () => ({}));
vi.mock("@/lib/actions/matching", () => ({
  getDfyConnections: actions.getDfyConnections,
  scheduleIntroTime: vi.fn(),
  declineDfyConnection: vi.fn(),
}));
vi.mock("@/app/parent/request/renderers/PositionDetailView", () => ({ PositionDetailView: () => null }));
vi.mock("../request/renderers/PositionDetailView", () => ({ PositionDetailView: () => null }));
vi.mock("@/components/position/ConnectionDetailPopup", () => ({ ConnectionDetailPopup: () => null }));
vi.mock("@/components/position/ScheduleTimeGrid", () => ({ ScheduleTimeGrid: () => null }));
vi.mock("@/components/parent/PlacementCard", () => ({ PlacementCard: () => null }));

import { MatchResultsClient } from "./MatchResultsClient";
import { DfyModal } from "./DfyModal";
import { PositionPageClient } from "../position/PositionPageClient";
import { PositionTile } from "@/components/hub/PositionTile";
import { MatchesTile } from "@/components/hub/MatchesTile";

afterEach(() => {
  vi.unstubAllEnvs();
  actions.getDfyConnections.mockReset();
});

const checkoutLinks = () => document.querySelectorAll('a[href="/parent/matches/checkout"]');
const setFlag = (on: boolean) => vi.stubEnv("LEGACY_TIER_CHECKOUT_ENABLED", on ? "true" : "");
const STATS = { totalEligible: 0, returned: 0 };
const EXPIRED_DFY = {
  activated: true,
  activatedAt: "2026-01-01T00:00:00Z",
  expiresAt: "2026-01-04T00:00:00Z",
  expired: true,
  notifiedCount: 3,
  interestedCount: 0,
  connectedCount: 0,
  tier: "standard" as const,
  maxRespondents: 5,
  positionId: "pos-1",
};

describe("MatchResultsClient — checkout links", () => {
  it.each([
    ["not triggered (Find me a nanny)", undefined],
    ["expired (Boost again)", EXPIRED_DFY],
  ])("%s: absent when off, present when on", (_label, dfyStatus) => {
    setFlag(false);
    const { unmount } = render(<MatchResultsClient matches={[]} stats={STATS} dfyStatus={dfyStatus} />);
    expect(checkoutLinks()).toHaveLength(0);
    unmount();
    setFlag(true);
    render(<MatchResultsClient matches={[]} stats={STATS} dfyStatus={dfyStatus} />);
    expect(checkoutLinks()).toHaveLength(1);
  });
});

describe("DfyModal — Get started", () => {
  it("absent when off, present when on", () => {
    setFlag(false);
    const { unmount } = render(<DfyModal open onClose={() => {}} />);
    expect(screen.queryByRole("button", { name: /get started/i })).toBeNull();
    expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
    unmount();
    setFlag(true);
    render(<DfyModal open onClose={() => {}} />);
    expect(screen.getByRole("button", { name: /get started/i })).toBeInTheDocument();
  });
});

describe("hub tiles — Find Me a Nanny", () => {
  it("PositionTile: absent when off, present when on", () => {
    setFlag(false);
    const { unmount } = render(<PositionTile hasPosition positionSummary={null} hasDfy={false} />);
    expect(checkoutLinks()).toHaveLength(0);
    unmount();
    setFlag(true);
    render(<PositionTile hasPosition positionSummary={null} hasDfy={false} />);
    expect(checkoutLinks()).toHaveLength(1);
  });
  it("MatchesTile: absent when off, present when on", () => {
    setFlag(false);
    const { unmount } = render(<MatchesTile hasPosition hasDfy={false} />);
    expect(checkoutLinks()).toHaveLength(0);
    unmount();
    setFlag(true);
    render(<MatchesTile hasPosition hasDfy={false} />);
    expect(checkoutLinks()).toHaveLength(1);
  });
});

type PositionProp = Parameters<typeof PositionPageClient>[0]["position"];
const basePosition = (dfyActivatedAt: string | null) =>
  ({
    id: "pos-1",
    parent_id: "par-1",
    status: "active",
    children: [],
    dfy_activated_at: dfyActivatedAt,
  }) as unknown as PositionProp;

const DFY_CONNECTION = {
  connectionId: "c1",
  notificationId: "n1",
  nannyId: "nan-1",
  connectionStage: 10,
  proposedTimes: null,
  confirmedTime: null,
  matchScore: 80,
  distanceKm: 2,
  breakdown: null,
  overQualifiedBonuses: [],
  unmetRequirements: [],
  nanny: {
    firstName: "Ana",
    lastName: "B",
    suburb: null,
    profilePicUrl: null,
    hourlyRateMin: null,
    experienceYears: null,
    aiHeadline: null,
    dateOfBirth: null,
    wwccVerified: false,
    schedule: null,
  },
};

describe("PositionPageClient — checkout links", () => {
  it("no DFY (Find my nanny for me): absent when off, present when on; Browse nannies stays", () => {
    setFlag(false);
    const { unmount } = render(<PositionPageClient position={basePosition(null)} />);
    expect(checkoutLinks()).toHaveLength(0);
    expect(document.querySelector('a[href="/nannies"]')).not.toBeNull();
    unmount();
    setFlag(true);
    render(<PositionPageClient position={basePosition(null)} />);
    expect(checkoutLinks()).toHaveLength(1);
  });

  it("DFY expired with matches (Find my perfect nanny): absent when off, present when on", async () => {
    actions.getDfyConnections.mockResolvedValue({ data: [DFY_CONNECTION] });
    const props = {
      position: basePosition("2026-01-01T00:00:00Z"),
      dfyActivated: true,
      dfyExpiresAt: "2026-01-04T00:00:00Z",
      dfyTier: "priority" as const,
    };
    setFlag(false);
    const { unmount } = render(<PositionPageClient {...props} />);
    await waitFor(() => expect(screen.getAllByText(/Matched Nannies/i).length).toBeGreaterThan(0));
    await waitFor(() => expect(actions.getDfyConnections).toHaveBeenCalled());
    await waitFor(() => expect(screen.getAllByText(/Ana/).length).toBeGreaterThan(0));
    expect(checkoutLinks()).toHaveLength(0);
    unmount();
    setFlag(true);
    render(<PositionPageClient {...props} />);
    await waitFor(() => expect(checkoutLinks()).toHaveLength(1));
  });
});
