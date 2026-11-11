/**
 * The connection popup: a family sees the days left to book under a nanny who has accepted; the nanny's countdown to
 * reply shows days and hours from 24 hours up.
 */
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/actions/connection", () => ({ acceptConnectionRequest: vi.fn(), declineConnectionRequest: vi.fn() }));
vi.mock("@/lib/legal/record-consent", () => ({ recordInformedAction: vi.fn(async () => {}) }));

import { ConnectionDetailPopup } from "./ConnectionDetailPopup";
import type { UpcomingIntro } from "@/lib/actions/position-funnel";

const DAY = 86_400_000;
const intro = (stage: number, expiresAt: string, status: string): UpcomingIntro => ({
  connectionId: "c1", otherPartyName: "Sarah Jones", otherPartySuburb: "Islington", otherPartyPhoto: null, confirmedTime: "",
  connectionStage: stage, fillInitiatedBy: null, trialDate: null, startDate: null, status, proposedTimes: null, message: null,
  expiresAt, nannyPhoneShared: null, positionId: null, position: null, source: "parent", nannyId: "n1",
});

describe("ConnectionDetailPopup — time left", () => {
  it("shows the family the days left to book once she has accepted", () => {
    render(<ConnectionDetailPopup intro={intro(10, new Date(Date.now() + 3 * DAY - 60_000).toISOString(), "accepted")} open onOpenChange={vi.fn()} role="parent" />);
    expect(screen.getByText("3 days left to book your meet and greet with Sarah")).toBeInTheDocument();
    expect(screen.getByText("Sarah accepted! Pick a time for your meet and greet.")).toBeInTheDocument();
  });

  it("shows the nanny her countdown in whole days at 7 days", () => {
    render(<ConnectionDetailPopup intro={intro(0, new Date(Date.now() + 7 * DAY - 60_000).toISOString(), "pending")} open onOpenChange={vi.fn()} role="nanny" />);
    expect(screen.getByText("7 days to respond")).toBeInTheDocument();
    expect(screen.queryByText(/left to book/)).toBeNull();
  });
});
