/**
 * Tests for the T-041 ConnectModal position-required surface.
 *
 * The modal is the client-side mirror of the server gate: when
 * `createConnectionRequest` returns `{ error: "POSITION_REQUIRED" }`,
 * the modal swaps the form for a "Create your position first" surface
 * with a CTA to `/parent/request`. The existing VERIFICATION_REQUIRED
 * branch is verified as a regression check.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ConnectModal } from "./ConnectModal";

const state = vi.hoisted(() => ({
  createReturn: { success: false, error: "POSITION_REQUIRED" } as {
    success: boolean;
    error: string | null;
    requestId?: string;
  },
}));

vi.mock("@/lib/actions/connection", () => ({
  createConnectionRequest: vi.fn(async () => state.createReturn),
}));

vi.mock("@/lib/legal/record-consent", () => ({
  recordInformedAction: vi.fn(() => Promise.resolve()),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn() }),
}));

const NANNY = {
  id: "nanny-1",
  first_name: "Alex",
  last_name: "Smith",
  suburb: "Clapham",
  hourly_rate_min: 35,
  profile_picture_url: null,
  date_of_birth: null,
};

function renderModal() {
  return render(
    <ConnectModal
      isOpen
      onClose={vi.fn()}
      nanny={NANNY}
      pendingRequestCount={0}
    />,
  );
}

async function submit() {
  const form = document.querySelector("form");
  if (!form) throw new Error("Form not found");
  fireEvent.submit(form);
  // wait for the awaited createConnectionRequest + state update
  await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("ConnectModal — T-041 POSITION_REQUIRED surface", () => {
  beforeEach(() => {
    state.createReturn = { success: false, error: "POSITION_REQUIRED" };
  });

  it("swaps to the position-required surface when the action returns POSITION_REQUIRED", async () => {
    renderModal();
    await submit();

    expect(screen.getByText("Create your position first")).toBeInTheDocument();
    expect(
      screen.getByText(/To connect with Alex, you'll need to tell us/),
    ).toBeInTheDocument();
  });

  it("renders the 'Create position' CTA pointing at /parent/request", async () => {
    renderModal();
    await submit();

    const cta = screen.getByRole("link", { name: "Create position" });
    expect(cta).toHaveAttribute("href", "/parent/request");
  });

  it("hides the pending-request counter on the position-required surface", async () => {
    renderModal();
    await submit();

    expect(screen.queryByText(/\d+\/5 ongoing/)).not.toBeInTheDocument();
  });
});

describe("ConnectModal — regression: VERIFICATION_REQUIRED still works after T-041", () => {
  beforeEach(() => {
    state.createReturn = { success: false, error: "VERIFICATION_REQUIRED" };
  });

  it("still renders the verification-required surface when the action returns VERIFICATION_REQUIRED", async () => {
    renderModal();
    await submit();

    expect(
      screen.getByText("Identity Verification Required"),
    ).toBeInTheDocument();
    const cta = screen.getByRole("link", { name: "Verify Now" });
    expect(cta).toHaveAttribute("href", "/parent/verification");
  });
});
