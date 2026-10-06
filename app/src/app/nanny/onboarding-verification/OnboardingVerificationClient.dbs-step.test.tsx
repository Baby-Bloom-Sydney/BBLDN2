/**
 * Unit 3b (BB-LDN-3b-061026) — onboarding step 3 end to end in the client: upload page 1, tick, "Verify DBS" →
 * the write gets path + consent, the check fires, and she moves to processing (brief changes 2 and 4).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent, waitFor } from "@testing-library/react";

const m = vi.hoisted(() => ({ submit: vi.fn(), upload: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/actions/verification", () => ({
  submitIdentitySection: vi.fn(),
  submitContactSection: vi.fn(),
  submitWWCCSection: m.submit,
}));
vi.mock("@/lib/supabase/storage", () => ({ uploadFileWithProgress: m.upload }));

import { OnboardingVerificationClient } from "./OnboardingVerificationClient";

const PROFILE = {
  firstName: "Jane", lastName: "Doe", dateOfBirth: "", mobileNumber: "", suburb: "", postcode: "",
  profilePictureUrl: null, bioSnippet: null, nationality: null,
};

beforeEach(() => {
  m.submit.mockReset();
  m.upload.mockReset();
  m.upload.mockResolvedValue({ url: "user-1/1-page1.pdf", error: null });
  vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ status: null }) })));
});
afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

async function uploadAndTick(container: HTMLElement) {
  fireEvent.change(container.querySelector('input[type="file"]')!, {
    target: { files: [new File(["%PDF-1.7 synthetic"], "page1.pdf", { type: "application/pdf" })] },
  });
  await screen.findByText("Certificate uploaded");
  fireEvent.click(screen.getByRole("checkbox"));
}

describe("OnboardingVerificationClient — DBS step", () => {
  it("shows the DBS step title and no old chooser", () => {
    render(<OnboardingVerificationClient initialStep={3} verification={null} userId="user-1" profile={PROFILE} />);
    expect(screen.getByRole("heading", { name: "Enhanced DBS certificate" })).toBeInTheDocument();
    expect(screen.queryByText(/verification method/i)).toBeNull();
  });

  it("submits path + consent, fires the check and moves to processing", async () => {
    m.submit.mockResolvedValue({ success: true, error: null, verificationId: "ver-1" });
    const { container } = render(<OnboardingVerificationClient initialStep={3} verification={null} userId="user-1" profile={PROFILE} />);
    await uploadAndTick(container);
    fireEvent.click(screen.getByRole("button", { name: "Verify DBS" }));
    await waitFor(() => expect(m.submit).toHaveBeenCalledWith({ certificate_path: "user-1/1-page1.pdf", consent: true }));
    expect(globalThis.fetch).toHaveBeenCalledWith("/api/run-verification", expect.objectContaining({ method: "POST" }));
    expect(await screen.findByText("Verifying your account")).toBeInTheDocument();
  });

  it("shows the server's error and stays on the step when the write fails", async () => {
    m.submit.mockResolvedValue({ success: false, error: "We couldn't save your certificate. Please try again." });
    const { container } = render(<OnboardingVerificationClient initialStep={3} verification={null} userId="user-1" profile={PROFILE} />);
    await uploadAndTick(container);
    fireEvent.click(screen.getByRole("button", { name: "Verify DBS" }));
    expect(await screen.findByText("We couldn't save your certificate. Please try again.")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Enhanced DBS certificate" })).toBeInTheDocument();
  });

  it("shows the deck submit error when the write throws", async () => {
    m.submit.mockRejectedValue(new Error("network"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { container } = render(<OnboardingVerificationClient initialStep={3} verification={null} userId="user-1" profile={PROFILE} />);
    await uploadAndTick(container);
    fireEvent.click(screen.getByRole("button", { name: "Verify DBS" }));
    expect(await screen.findByText("We couldn't send your certificate. Please try again.")).toBeInTheDocument();
  });
});
