/**
 * 3d follow-up (BB-LDN-3dfix-141026), finding 1 — P-8 needs a UI entry point: a level-4 (status 40) nanny is in no DBS
 * list, so the user drawer's Enhanced DBS row carries "Run DBS check now" (BAI 2026-10-14). It calls the existing
 * `adminRunDbsCheck` (its P-8 behaviour is pinned by D7e / RC1–RC4 in `lib/actions/admin-dbs.test.ts`) after a two-step
 * confirm, shows the result, then refreshes.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  adminRunDbsCheck: vi.fn(async () => ({ success: true, error: null, result: "NEW_INFO", outcome: "recheck_fail" })),
  refresh: vi.fn(),
}));

vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }));
vi.mock("@/lib/actions/admin", () => ({
  adminDeleteUser: vi.fn(),
  adminChangeRole: vi.fn(),
  adminResetVerification: vi.fn(),
  adminRegenerateNannyBio: vi.fn(),
}));
vi.mock("@/lib/actions/admin-dbs", () => ({ adminRunDbsCheck: h.adminRunDbsCheck }));
vi.mock("./ContactUserModal", () => ({ ContactUserModal: () => null }));

import { UserDetailDrawer } from "./UserDetailDrawer";
import type { UserData } from "./page";

const nanny = (verification_status: number, verification_id: string | null = "ver-40") =>
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
    verification_level: verification_status === 40 ? 4 : 2,
    verification_status,
    verification_id,
    identity_verified: true,
    parent_status: null,
    babysitter_eligible: false,
    nanny_id: "n1",
  }) as unknown as UserData;

const show = (u: UserData) => render(<UserDetailDrawer user={u} open onOpenChange={() => {}} />);
const runButton = () => screen.queryByRole("button", { name: /Run DBS check now/ });

beforeEach(() => vi.clearAllMocks());

describe("user drawer — Run DBS check now on a level-4 nanny (P-8 entry point)", () => {
  it("shows the button for an approved (status 40) nanny", () => {
    show(nanny(40));
    expect(runButton()).toBeInTheDocument();
  });

  it.each([20, 21, 22, 23, 26, 27, 30])("does not show it at status %i (lists A–D and the nanny's own flow cover those)", (code) => {
    show(nanny(code));
    expect(runButton()).toBeNull();
  });

  it("does not show it when there is no verification row id", () => {
    show(nanny(40, null));
    expect(runButton()).toBeNull();
  });

  it("asks first: one click calls nothing, Cancel calls nothing", () => {
    show(nanny(40));
    fireEvent.click(runButton()!);
    expect(h.adminRunDbsCheck).not.toHaveBeenCalled();
    expect(screen.getByText(/drops to level 2/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(h.adminRunDbsCheck).not.toHaveBeenCalled();
    expect(runButton()).toBeInTheDocument();
  });

  it("Yes calls adminRunDbsCheck once with the verification id, shows the result and refreshes", async () => {
    show(nanny(40));
    fireEvent.click(runButton()!);
    fireEvent.click(screen.getByRole("button", { name: /Yes, run check/ }));
    await waitFor(() => expect(h.adminRunDbsCheck).toHaveBeenCalledTimes(1));
    expect(h.adminRunDbsCheck).toHaveBeenCalledWith("ver-40");
    expect(await screen.findByText(/Update Service: NEW_INFO/)).toBeInTheDocument();
    expect(h.refresh).toHaveBeenCalled();
  });

  it("shows the action's error and a warning when there is one", async () => {
    h.adminRunDbsCheck.mockResolvedValueOnce({ success: false, error: "The Update Service did not answer (timeout) — nothing was saved", result: "ERROR" } as never);
    show(nanny(40));
    fireEvent.click(runButton()!);
    fireEvent.click(screen.getByRole("button", { name: /Yes, run check/ }));
    expect(await screen.findByText(/did not answer \(timeout\)/)).toBeInTheDocument();

    h.adminRunDbsCheck.mockResolvedValueOnce({ success: true, error: null, result: "NO_MATCH", warning: "Saved, but her account level did not update" } as never);
    fireEvent.click(runButton()!);
    fireEvent.click(screen.getByRole("button", { name: /Yes, run check/ }));
    expect(await screen.findByText(/her account level did not update/)).toBeInTheDocument();
  });

  it("a throwing action shows the error and re-enables the button", async () => {
    h.adminRunDbsCheck.mockRejectedValueOnce(new Error("network down"));
    show(nanny(40));
    fireEvent.click(runButton()!);
    fireEvent.click(screen.getByRole("button", { name: /Yes, run check/ }));
    expect(await screen.findByText(/network down/)).toBeInTheDocument();
    expect(runButton()).toBeEnabled();
  });
});
