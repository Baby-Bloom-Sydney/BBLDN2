/**
 * W6-D3 / dispatch D4 (3w6fix, BB-LDN-3w6fix-141026) — Check ID: the admin's edits to "AI Extracted Details" reach
 * `adminVerifyIdentity` (only the fields she changed); without edits the call is unchanged.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const h = vi.hoisted(() => ({
  adminVerifyIdentity: vi.fn(async () => ({ success: true, error: null as string | null })),
  adminRejectIdentity: vi.fn(async () => ({ success: true, error: null as string | null })),
  refresh: vi.fn(),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: h.refresh, push: vi.fn() }) }));
vi.mock("@/lib/actions/admin", () => ({ adminVerifyIdentity: h.adminVerifyIdentity, adminRejectIdentity: h.adminRejectIdentity }));

import { IDCheckModal } from "./IDCheckModal";
import type { PendingIdentityCheck } from "./page";

const check = (over: Partial<PendingIdentityCheck> = {}): PendingIdentityCheck => ({
  id: "v1", user_id: "u1", surname: "Taylor", given_names: "Sophie", date_of_birth: "1990-03-05",
  passport_country: "United Kingdom", passport_upload_url: null, identification_photo_url: null,
  identity_verified: false, identity_rejection_reason: null, verification_status: 11, created_at: "2026-10-14T08:00:00Z",
  first_name: "Sophie", last_name: "Taylor", email: "sophie.taylor+3w6fix@example.test", profile_picture_url: null,
  extracted_surname: "TAYLOR", extracted_given_names: "SOPHIE", extracted_dob: null, extracted_nationality: "BRITISH CITIZEN",
  extracted_passport_number: "123456789", extracted_passport_expiry: "2031-06-30",
  identity_ai_reasoning: "DOB unreadable", identity_ai_issues: null,
  ...over,
});

async function verify() {
  fireEvent.click(screen.getByRole("button", { name: /verify user/i }));
  fireEvent.click(screen.getByRole("button", { name: /yes, verify/i }));
  await waitFor(() => expect(h.adminVerifyIdentity).toHaveBeenCalledTimes(1));
}

beforeEach(() => vi.clearAllMocks());

describe("IDCheckModal — AI Extracted Details edits (W6-D3)", () => {
  it("sends only the edited fields with the approval", async () => {
    render(<IDCheckModal check={check()} open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.change(screen.getByLabelText("Date of Birth"), { target: { value: "1990-03-05" } });
    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    await verify();
    expect(h.adminVerifyIdentity).toHaveBeenCalledWith("v1", { extracted_dob: "1990-03-05" });
  });

  it("shows the edited value after Done, before the approval saves it", () => {
    render(<IDCheckModal check={check({ extracted_surname: "TAYLR" })} open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.change(screen.getByLabelText("Surname"), { target: { value: "TAYLOR" } });
    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    expect(screen.getByText("TAYLOR")).toBeInTheDocument();
    expect(screen.queryByText("TAYLR")).not.toBeInTheDocument();
  });

  it("sends no edits when the admin changed nothing", async () => {
    render(<IDCheckModal check={check()} open onOpenChange={() => {}} />);
    fireEvent.click(screen.getByRole("button", { name: /edit/i }));
    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    await verify();
    expect(h.adminVerifyIdentity).toHaveBeenCalledWith("v1", {});
  });
});
