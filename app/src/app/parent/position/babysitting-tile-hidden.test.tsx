/**
 * 5-w3fix (W3-M2, P-23) — `/parent/position`'s Babysitting tile ("Find Babysitter", "Need a sitter?") renders only
 * while `BABYSITTING_ENABLED` is on. Off (the default) → no tile; on → the tile as before.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/parent/position",
}));
vi.mock("@/lib/analytics/trackEvent", () => ({ trackEvent: vi.fn() }));
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
  getDfyConnections: vi.fn(),
  scheduleIntroTime: vi.fn(),
  declineDfyConnection: vi.fn(),
}));
vi.mock("../request/renderers/PositionDetailView", () => ({ PositionDetailView: () => null }));
vi.mock("@/components/position/ConnectionDetailPopup", () => ({ ConnectionDetailPopup: () => null }));
vi.mock("@/components/position/ScheduleTimeGrid", () => ({ ScheduleTimeGrid: () => null }));
vi.mock("@/components/parent/PlacementCard", () => ({ PlacementCard: () => null }));

import { PositionPageClient } from "./PositionPageClient";

afterEach(() => vi.unstubAllEnvs());

const setBabysitting = (on: boolean) => vi.stubEnv("BABYSITTING_ENABLED", on ? "true" : "");
const babysittingLinks = () => document.querySelectorAll('a[href="/parent/babysitting"]');

describe("PositionPageClient — Babysitting tile", () => {
  it("off: no tile, no Find Babysitter link, no sitter copy", () => {
    setBabysitting(false);
    render(<PositionPageClient position={null} />);
    expect(screen.queryByText(/^Babysitting$/)).toBeNull();
    expect(babysittingLinks()).toHaveLength(0);
    expect(screen.queryByText(/Find Babysitter/i)).toBeNull();
    expect(screen.queryByText(/Need a sitter/i)).toBeNull();
  });

  it("on: the tile renders as before", () => {
    setBabysitting(true);
    render(<PositionPageClient position={null} />);
    expect(screen.getByText(/^Babysitting$/)).toBeInTheDocument();
    expect(babysittingLinks()).toHaveLength(1);
    expect(screen.getByText(/Find Babysitter/i)).toBeInTheDocument();
    expect(screen.getByText(/Need a sitter/i)).toBeInTheDocument();
  });
});
