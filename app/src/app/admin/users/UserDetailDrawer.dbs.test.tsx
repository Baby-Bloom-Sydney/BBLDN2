/**
 * Unit 3a (BB-LDN-3a-061026) — render proof for decoder 3 (stand-in for the admin walk; see verification-reference
 * page.test.tsx). The drawer's DBS row reads "Enhanced DBS"; 27 shows Barred from the code alone (no longer
 * "22 + suspended"); 22 shows Rejected; every label comes from STATUS_META.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("@/lib/actions/admin", () => ({
  adminDeleteUser: vi.fn(),
  adminChangeRole: vi.fn(),
  adminResetVerification: vi.fn(),
  adminRegenerateNannyBio: vi.fn(),
}));
vi.mock("./ContactUserModal", () => ({ ContactUserModal: () => null }));

import { UserDetailDrawer } from "./UserDetailDrawer";
import type { UserData } from "./page";

const nanny = (verification_status: number, nanny_status = "active") =>
  ({
    user_id: "u1",
    first_name: "Test",
    last_name: "Nanny",
    email: null,
    suburb: null,
    postcode: null,
    profile_picture_url: null,
    mobile_number: null,
    date_of_birth: null,
    created_at: "2026-10-06T00:00:00Z",
    role: "nanny",
    nanny_status,
    verification_level: verification_status === 27 ? 0 : 2,
    verification_status,
    identity_verified: true,
    parent_status: null,
    babysitter_eligible: false,
    nanny_id: "n1",
  }) as unknown as UserData;

function dbsRowText() {
  const label = screen.getByText("Enhanced DBS");
  return label.parentElement?.textContent ?? "";
}

describe("user drawer — DBS row", () => {
  it("shows Barred for 27 from the code alone, even when the account is not suspended", () => {
    render(<UserDetailDrawer user={nanny(27, "active")} open onOpenChange={() => {}} />);
    expect(dbsRowText()).toContain("Barred");
    expect(screen.getByText("DBS Barred (27)")).toBeTruthy();
  });

  it("shows Rejected (not barred) for 22 on a suspended account", () => {
    render(<UserDetailDrawer user={nanny(22, "suspended")} open onOpenChange={() => {}} />);
    expect(dbsRowText()).toContain("Rejected");
    expect(dbsRowText()).not.toContain("Barred");
  });

  it.each([
    [23, "New information"],
    [26, "No Update Service match"],
    [30, "Awaiting approval"],
  ])("shows the STATUS_META short label for %i", (code, short) => {
    render(<UserDetailDrawer user={nanny(code)} open onOpenChange={() => {}} />);
    expect(dbsRowText()).toContain(short);
  });
});
