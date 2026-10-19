/**
 * 5-w3fix (W3-M3, P-23) — the admin leads read-outs of the nanny contributions (payout) programme are hidden while
 * `PAYOUTS_ENABLED` is off, as 4a-i hid its other payout read-outs: the drawer's "Contributions" stat, the pre-call
 * "contributions …" part, the "Bonus contributions not set up yet" upsell line and the list's "Contributions:"
 * filter — plus the same read-out on the phone-width list card (`LeadsListCards`, "Contributions ✓/✗"), which the
 * desktop walk could not see. Flag on → as before.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("./actions", () => ({ overrideResponded: vi.fn(), updateContactsOffset: vi.fn() }));

import { LeadDrawerStats } from "./LeadDrawerStats";
import { LeadDrawerPreCallContext } from "./LeadDrawerPreCallContext";
import { LeadDrawerChildrenPositions } from "./LeadDrawerChildrenPositions";
import { LeadFiltersBar } from "./LeadFiltersBar";
import { LeadsListCards } from "./LeadsListCards";
import { parseLeadQueryState } from "@/lib/leads/query-builder";
import type { LeadDetail } from "@/lib/leads/fetch-lead-detail";
import type { LeadRow } from "@/lib/leads/types";

afterEach(() => vi.unstubAllEnvs());

const setPayouts = (on: boolean) => vi.stubEnv("PAYOUTS_ENABLED", on ? "true" : "");

const detail = {
  nanny_user_id: "nan-1",
  nanny: { created_at: null, verification_level: 2, bonus_program_completed_at: null },
  verifications: null,
  user_profile: null,
  contact_state: null,
  contacts: [],
  children_linked: [],
  placements: [],
  interview_requests: [],
  parent_directory: [],
  subscription_directory: [],
  babysitting_notifications: [],
  nanny_lead: null,
} as unknown as LeadDetail;

const renderEach = (on: boolean) => {
  setPayouts(on);
  return render(
    <>
      <LeadDrawerStats detail={detail} onLocalPatch={() => {}} />
      <LeadDrawerPreCallContext detail={detail} />
      <LeadDrawerChildrenPositions detail={detail} />
      <LeadFiltersBar state={parseLeadQueryState(new URLSearchParams())} onChange={() => {}} />
    </>,
  );
};

describe("admin leads — contributions read-outs", () => {
  it("off: no Contributions stat, pre-call part, upsell line or filter; neighbours stay", () => {
    const { container } = renderEach(false);
    expect(container.textContent).not.toMatch(/contribution/i);
    expect(screen.queryByRole("button", { name: /^Incomplete$/ })).toBeNull();
    expect(screen.getAllByText("Children").length).toBeGreaterThan(0);
    expect(container.textContent).toMatch(/no children on account/);
    expect(container.textContent).toMatch(/No children on this nanny/);
    expect(container.textContent).toMatch(/Family:/);
  });

  it("on: all four render as before", () => {
    const { container } = renderEach(true);
    expect(screen.getByText("Contributions")).toBeInTheDocument();
    expect(container.textContent).toMatch(/contributions incomplete/);
    expect(container.textContent).toMatch(/Bonus contributions not set up yet — upsell opportunity\./);
    expect(container.textContent).toMatch(/Contributions:/);
    expect(screen.getAllByRole("button", { name: /Incomplete/ }).length).toBeGreaterThan(0);
  });
});

const row = {
  nanny_user_id: "nan-1",
  first_name: "Ana",
  last_name: "B",
  email: "ana@example.test",
  suburb: null,
  profile_picture_url: null,
  signup_at: null,
  contact_state: null,
  verification: { identity_verified: true, photo_present: true, verification_level: 2, verification_status: null },
  contributions_complete_derived: false,
  external_u3_position: null,
  children_total: 0,
  children_linked: 0,
} as unknown as LeadRow;

describe("LeadsListCards — Contributions chip (phone width)", () => {
  it("off: no Contributions chip; the card still renders", () => {
    setPayouts(false);
    const { container } = render(<LeadsListCards rows={[row]} onRowClick={() => {}} />);
    expect(container.textContent).not.toMatch(/Contributions/);
    expect(container.textContent).toMatch(/Ana B/);
  });

  it("on: the chip renders as before", () => {
    setPayouts(true);
    const { container } = render(<LeadsListCards rows={[row]} onRowClick={() => {}} />);
    expect(container.textContent).toMatch(/Contributions ✗/);
  });
});
