/**
 * Brief 04 §0.9 (plan C2; BB-wave1-041126/04c1-build): `/admin/positions?openPosition=<id>` opens that position's row
 * expanded and scrolls it into view — the `UsersTab` `openUser` pattern — but only while CALL_BOOKING_ENABLED is on.
 * Off, or with no parameter, the page is exactly today's: nothing expanded, nothing scrolled.
 *
 * The page reads the parameter on the server and passes it down (the `/admin/leads` `openLead` shape), so the client
 * needs no `useSearchParams` and `AdminPositionsClient.area-label.test.tsx` stays as it is.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { FakeAdmin } from "@/lib/payments/fake-admin.test-util";

const h = vi.hoisted(() => ({ fake: null as FakeAdmin | null }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("./actions", () => ({
  closePositionAction: vi.fn(async () => ({ success: true })),
  fetchUserData: vi.fn(async () => null),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.fake!.client }));

import { fakeAdmin } from "@/lib/payments/fake-admin.test-util";
import { AdminPositionsClient } from "./AdminPositionsClient";
import AdminPositionsPage, { type AdminPosition } from "./page";

const A = "11111111-1111-4111-8111-111111111111";
const B = "44444444-4444-4444-8444-444444444444";

function position(id: string, name: string): AdminPosition {
  return {
    id,
    parent_id: "22222222-2222-4222-8222-222222222222",
    parent_name: name,
    parent_user_id: "33333333-3333-4333-8333-333333333333",
    suburb: "Clapham",
    hourly_rate: 22,
    hours_per_week: 30,
    status: "open",
    stage: 1,
    position_status: 1,
    source: "parent",
    family_display_name: `${name} Family`,
    days_required: ["Monday"],
    schedule_type: "part_time",
    placement_length: "ongoing",
    description: null,
    dfy_activated_at: null,
    dfy_tier: null,
    expires_at: null,
    created_at: "2026-09-01T09:00:00.000Z",
    schedule: null,
    children: [],
    connections: [],
  };
}

const POSITIONS = [position(A, "Okonkwo"), position(B, "Hartley")];
const expanded = (id: string) => document.querySelector(`a[href="/position/${id}"]`);
const scrolled: Element[] = [];

beforeEach(() => {
  scrolled.length = 0;
  Element.prototype.scrollIntoView = vi.fn(function (this: Element) {
    scrolled.push(this);
  });
});
afterEach(() => vi.unstubAllEnvs());

describe("AdminPositionsClient — ?openPosition", () => {
  it("flag on + the parameter → that row is expanded and scrolled into view; the others are not", () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    render(<AdminPositionsClient positions={POSITIONS} openPositionId={B} />);
    expect(expanded(B)).not.toBeNull();
    expect(expanded(A)).toBeNull();
    expect(scrolled).toHaveLength(1);
    expect(scrolled[0].textContent).toContain("Hartley Family");
  });

  it("flag off → the parameter is ignored: nothing expanded, nothing scrolled (today)", () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    render(<AdminPositionsClient positions={POSITIONS} openPositionId={B} />);
    expect(expanded(A)).toBeNull();
    expect(expanded(B)).toBeNull();
    expect(scrolled).toHaveLength(0);
  });

  it("no parameter → nothing expanded (today)", () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    render(<AdminPositionsClient positions={POSITIONS} />);
    expect(expanded(A)).toBeNull();
    expect(expanded(B)).toBeNull();
    expect(scrolled).toHaveLength(0);
  });

  it("an id that isn't on the page → nothing expanded, nothing scrolled", () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    render(<AdminPositionsClient positions={POSITIONS} openPositionId="55555555-5555-4555-8555-555555555555" />);
    expect(expanded(A)).toBeNull();
    expect(expanded(B)).toBeNull();
    expect(scrolled).toHaveLength(0);
  });

  it("a refresh (new positions array, same link) doesn't re-open or re-scroll a row she collapsed (review)", () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    const { rerender } = render(<AdminPositionsClient positions={POSITIONS} openPositionId={B} />);
    fireEvent.click(screen.getByText("Hartley Family"));
    expect(expanded(B)).toBeNull();
    rerender(<AdminPositionsClient positions={[...POSITIONS]} openPositionId={B} />);
    expect(expanded(B)).toBeNull();
    expect(scrolled).toHaveLength(1);
  });

  it("a row opened from the link still toggles by click, as today", () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    render(<AdminPositionsClient positions={POSITIONS} openPositionId={B} />);
    fireEvent.click(screen.getByText("Hartley Family"));
    expect(expanded(B)).toBeNull();
    fireEvent.click(screen.getByText("Okonkwo Family"));
    expect(expanded(A)).not.toBeNull();
  });
});

describe("AdminPositionsPage — passes ?openPosition down", () => {
  const rows = (data: unknown) => () => data;
  const dbRow = { ...position(B, "Hartley"), parent_name: undefined, parent_user_id: undefined, schedule: undefined, children: undefined, connections: undefined };

  beforeEach(() => {
    h.fake = fakeAdmin({
      nanny_positions: rows([dbRow]),
      position_children: rows([]),
      connection_requests: rows([]),
      position_schedule: rows([]),
      nannies: rows([]),
      parents: rows([]),
      user_profiles: rows([]),
    });
  });

  it("flag on: /admin/positions?openPosition=<id> opens that row", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    render(await AdminPositionsPage({ searchParams: { openPosition: B } }));
    expect(expanded(B)).not.toBeNull();
  });

  it("no search params at all → today's page, nothing open", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    render(await AdminPositionsPage({}));
    expect(screen.getByText("Hartley Family")).toBeInTheDocument();
    expect(expanded(B)).toBeNull();
  });

  it("a repeated parameter takes the first value", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    render(await AdminPositionsPage({ searchParams: { openPosition: [B, A] } }));
    expect(expanded(B)).not.toBeNull();
  });
});
