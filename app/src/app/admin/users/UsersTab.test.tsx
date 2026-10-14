/**
 * 3d follow-up (BB-LDN-3dfix-141026), code review MEDIUM 1 — the same stale-snapshot bug as finding 2, in the user
 * drawer: after "Run DBS check now" drops a level-4 nanny to 23 / 26, `router.refresh()` brings new `users`, but the
 * open drawer kept the clicked object, still showing 40 and the button. The open drawer must show the refreshed user.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(""),
}));
vi.mock("@/lib/actions/admin", () => ({
  adminDeleteUser: vi.fn(),
  adminChangeRole: vi.fn(),
  adminResetVerification: vi.fn(),
  adminRegenerateNannyBio: vi.fn(),
}));
vi.mock("@/lib/actions/admin-dbs", () => ({ adminRunDbsCheck: vi.fn() }));
vi.mock("./ContactUserModal", () => ({ ContactUserModal: () => null }));

import { UsersTab } from "./UsersTab";
import type { UserData, UserStats } from "./page";

const nanny = (verification_status: number, verification_level: number) =>
  ({
    user_id: "u1",
    first_name: "Sophie",
    last_name: "Taylor",
    email: null,
    suburb: null,
    postcode: null,
    profile_picture_url: null,
    mobile_number: null,
    date_of_birth: null,
    created_at: "2026-10-06T00:00:00Z",
    role: "nanny",
    nanny_status: "active",
    verification_level,
    verification_status,
    verification_id: "ver-40",
    identity_verified: true,
    parent_status: null,
    babysitter_eligible: false,
    nanny_id: "n1",
  }) as unknown as UserData;

const stats: UserStats = { total: 1, nannies: 1, parents: 0, admins: 0 };

describe("UsersTab — the open drawer follows a refresh", () => {
  it("drops the Run button and shows the new DBS state when the refreshed user is no longer at 40", () => {
    const { rerender } = render(<UsersTab users={[nanny(40, 4)]} stats={stats} />);
    fireEvent.click(screen.getByText("Sophie Taylor"));
    expect(screen.getByRole("button", { name: /Run DBS check now/ })).toBeInTheDocument();

    rerender(<UsersTab users={[nanny(23, 2)]} stats={stats} />);

    expect(screen.queryByRole("button", { name: /Run DBS check now/ })).toBeNull();
    expect(screen.getByText("Enhanced DBS").parentElement?.textContent).toContain("New information");
  });

  it("keeps the drawer open on the last user it showed when that user leaves the list", () => {
    const { rerender } = render(<UsersTab users={[nanny(40, 4)]} stats={stats} />);
    fireEvent.click(screen.getByText("Sophie Taylor"));
    rerender(<UsersTab users={[]} stats={stats} />);
    expect(screen.getByText("Enhanced DBS")).toBeInTheDocument();
  });
});
