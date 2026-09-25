/**
 * 2i render proof — the admin positions table says "Area", not "Suburb".
 *
 * P-15: the London word for the place a family lives is "Area"; `district`
 * stays the data-model term and every identifier (`nanny_positions.suburb`,
 * `AdminPosition.suburb`) keeps its name. This pins the *label*, not the
 * data: the row below still carries `suburb: "Clapham"` and the test asserts
 * the district value renders beneath the "Area" heading — which is exactly
 * the pairing the checkpoint walk looks for.
 *
 * Pinned rather than left to a browser because the Stage 0 nanny's login is
 * not recorded (`LEDGER/stage-0-findings.md` §5 records the account and the
 * journey, not a password), so `04-sequence.md` §0's render proof takes its
 * second form for this unit.
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { AdminPositionsClient } from "./AdminPositionsClient";
import type { AdminPosition } from "./page";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
}));

vi.mock("./actions", () => ({
  closePositionAction: vi.fn(async () => ({ success: true })),
  fetchUserData: vi.fn(async () => null),
}));

const POSITION: AdminPosition = {
  id: "11111111-1111-4111-8111-111111111111",
  parent_id: "22222222-2222-4222-8222-222222222222",
  parent_name: "Okonkwo",
  parent_user_id: "33333333-3333-4333-8333-333333333333",
  suburb: "Clapham",
  hourly_rate: 22,
  hours_per_week: 30,
  status: "open",
  stage: 1,
  position_status: 1,
  source: "parent",
  family_display_name: "Okonkwo Family",
  days_required: ["Monday", "Tuesday"],
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

describe("2i — admin positions table place label (P-15)", () => {
  it('heads the place column "Area" and shows the district under it', () => {
    render(<AdminPositionsClient positions={[POSITION]} />);

    const areaHeading = screen.getByRole("columnheader", { name: "Area" });
    expect(areaHeading).toBeInTheDocument();

    expect(
      screen.queryByRole("columnheader", { name: "Suburb" }),
    ).not.toBeInTheDocument();

    const table = areaHeading.closest("table");
    expect(table).not.toBeNull();
    expect(
      within(table as HTMLElement).getByText("Clapham"),
    ).toBeInTheDocument();
  });

  it("offers the place word in the search placeholder", () => {
    render(<AdminPositionsClient positions={[POSITION]} />);

    expect(
      screen.getByPlaceholderText("Search family or area..."),
    ).toBeInTheDocument();
  });
});
