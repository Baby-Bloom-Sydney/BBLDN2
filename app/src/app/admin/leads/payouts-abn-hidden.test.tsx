/**
 * Unit 4a-i (BB-LDN-4a-i-151026) — the ABN chip, filter and drawer rows and the drawer's payout context are
 * hidden while `PAYOUTS_ENABLED` is off (P-23, card 4b; brief step 5 + the step-4 grep hits). Flag on → as before.
 * `lib/leads/*` query code is not touched: the hide is display-only.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { LeadFiltersBar } from "./LeadFiltersBar";
import { LeadDrawerVerificationBreakdown } from "./LeadDrawerVerificationBreakdown";
import { LeadDrawerPreCallContext } from "./LeadDrawerPreCallContext";
import { VerificationMiniChip } from "./VerificationMiniChip";
import { LeadDrawerSubscriptionPayout } from "./LeadDrawerSubscriptionPayout";
import { LeadDrawerActivityTimeline } from "./LeadDrawerActivityTimeline";
import { parseLeadQueryState } from "@/lib/leads/query-builder";
import type { LeadDetail } from "@/lib/leads/fetch-lead-detail";
import type { TimelineEvent, VerificationSnapshot } from "@/lib/leads/types";

afterEach(() => vi.unstubAllEnvs());

const off = () => vi.stubEnv("PAYOUTS_ENABLED", "");
const on = () => vi.stubEnv("PAYOUTS_ENABLED", "true");

const detail = {
  nanny: { abn: "51824753556", abn_push_flagged_at: null, payouts_enabled: true, created_at: null },
  verifications: { identity_verified: true, verification_status: null },
  user_profile: null,
  children_linked: [],
  interview_requests: [],
  nanny_lead: null,
} as unknown as LeadDetail;

const snapshot = {
  identity_verified: true,
  photo_present: true,
  abn_present: true,
  verification_level: 3,
  verification_status: null,
} as unknown as VerificationSnapshot;

const events: TimelineEvent[] = [
  { event_at: "2026-10-01T09:00:00Z", category: "payout", title: "Payout scheduled (£100)", detail: null, source: "nanny_payouts" },
  { event_at: "2026-10-02T09:00:00Z", category: "email", title: "Welcome email", detail: null, source: "email_logs" },
];

const abnFilter = () => screen.queryByRole("button", { name: /^ABN/ });

describe("LeadFiltersBar — ABN filter", () => {
  const state = parseLeadQueryState(new URLSearchParams());
  it("hidden when off", () => {
    off();
    render(<LeadFiltersBar state={state} onChange={() => {}} />);
    expect(abnFilter()).toBeNull();
    expect(screen.getByRole("button", { name: /^Photo/ })).toBeInTheDocument();
  });
  it("shown when on", () => {
    on();
    render(<LeadFiltersBar state={state} onChange={() => {}} />);
    expect(abnFilter()).not.toBeNull();
  });
});

describe("LeadDrawerVerificationBreakdown — ABN row", () => {
  it("hidden when off", () => {
    off();
    const { container } = render(<LeadDrawerVerificationBreakdown detail={detail} />);
    expect(container.textContent).not.toMatch(/ABN|51824753556/);
    expect(container.textContent).toMatch(/Photo/);
  });
  it("shown when on", () => {
    on();
    const { container } = render(<LeadDrawerVerificationBreakdown detail={detail} />);
    expect(container.textContent).toMatch(/ABN/);
  });
});

describe("LeadDrawerPreCallContext — ABN badge", () => {
  it("hidden when off", () => {
    off();
    const { container } = render(<LeadDrawerPreCallContext detail={detail} />);
    expect(container.textContent).not.toMatch(/ABN/);
    expect(container.textContent).toMatch(/ID done/);
  });
  it("shown when on", () => {
    on();
    const { container } = render(<LeadDrawerPreCallContext detail={detail} />);
    expect(container.textContent).toMatch(/ID \+ ABN done/);
  });
});

describe("VerificationMiniChip — ABN chip", () => {
  it("hidden when off", () => {
    off();
    const { container } = render(<VerificationMiniChip verification={snapshot} />);
    expect(container.textContent).not.toMatch(/ABN/);
    expect(container.textContent).toMatch(/Photo/);
  });
  it("shown when on", () => {
    on();
    const { container } = render(<VerificationMiniChip verification={snapshot} />);
    expect(container.textContent).toMatch(/ABN/);
  });
});

describe("LeadDrawerSubscriptionPayout — Connect / payout / ABN section", () => {
  it("renders nothing when off", () => {
    off();
    const { container } = render(<LeadDrawerSubscriptionPayout detail={detail} />);
    expect(container).toBeEmptyDOMElement();
  });
  it("renders when on", () => {
    on();
    const { container } = render(<LeadDrawerSubscriptionPayout detail={detail} />);
    expect(container.textContent).toMatch(/Subscription & payout/);
  });
});

describe("LeadDrawerActivityTimeline — payout events", () => {
  it("drops payout events when off", () => {
    off();
    const { container } = render(<LeadDrawerActivityTimeline events={events} />);
    expect(container.textContent).not.toMatch(/Payout/);
    expect(container.textContent).toMatch(/Welcome email/);
    expect(container.textContent).toMatch(/\(1\)/);
  });
  it("keeps them when on", () => {
    on();
    const { container } = render(<LeadDrawerActivityTimeline events={events} />);
    expect(container.textContent).toMatch(/Payout scheduled/);
    expect(container.textContent).toMatch(/\(2\)/);
  });
});
