/**
 * LDN2 unit 3h — the admin viewer shows the Verification tab and the level
 * badge for nannies only. London parents are never verified, so a parent has
 * neither (H-3/H-5 admin surfaces; stands in for the admin walk until a
 * preview deploy exists).
 */

import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  usePathname: () => "/admin/viewer/u-1",
}));
vi.mock("@/components/dashboard/UserAvatar", () => ({
  UserAvatar: () => null,
}));

import { AdminViewerBar } from "./AdminViewerBar";
import { LEVEL_LABELS } from "@/lib/verification";

// Unit 3d retarget: the badge reads 3a's LEVEL_LABELS (brief change 14), not the bar's old local "Level n" copy.
const LEVEL_2 = LEVEL_LABELS[2];

function user(role: "nanny" | "parent") {
  return {
    userId: "u-1",
    firstName: "Sam",
    lastName: "Reed",
    email: "sam@example.com",
    profilePictureUrl: null,
    role,
    verificationLevel: 2,
  };
}

describe("AdminViewerBar — verification is nanny-only (3h)", () => {
  it("shows no Verification tab and no level badge for a parent", () => {
    render(<AdminViewerBar user={user("parent")} />);
    expect(screen.queryByRole("link", { name: "Verification" })).toBeNull();
    expect(screen.queryByText(LEVEL_2)).toBeNull();
    expect(screen.getByRole("link", { name: "Hub" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Profile" })).toBeInTheDocument();
  });

  it("still shows the Verification tab and the level badge for a nanny", () => {
    render(<AdminViewerBar user={user("nanny")} />);
    expect(
      screen.getByRole("link", { name: "Verification" }),
    ).toHaveAttribute("href", "/admin/viewer/u-1/verification");
    expect(screen.getByText(LEVEL_2)).toBeInTheDocument();
  });
});
