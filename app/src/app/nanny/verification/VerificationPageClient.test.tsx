/**
 * Unit 3b (BB-LDN-3b-061026) — /nanny/verification accordion (brief changes 4, 6, 10; copy deck §2.1, §2.5).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/actions/dbs-review", () => ({ submitDbsForManualReview: vi.fn() }));
vi.mock("@/lib/supabase/storage", () => ({ uploadFileWithProgress: vi.fn() }));
vi.mock("@/lib/supabase/client", () => ({
  createClient: () => ({ auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) } }),
}));

import { VerificationPageClient } from "./VerificationPageClient";
import { dbsRow, STORED_SECTION } from "@/lib/dbs/fixtures.test-util";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

const show = (over: Parameters<typeof dbsRow>[0]) =>
  render(<VerificationPageClient initialData={dbsRow(over)} profileData={null} />);

describe("VerificationPageClient — DBS", () => {
  it("titles the step 'Verify DBS' (display mode, so no CTA of the same name is on screen)", () => {
    show({ code: 30, section: "doc_verified", crossCheck: "passed" });
    expect(screen.getByText("Verify DBS")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Verify DBS" })).toBeNull();
  });

  it("keeps polling while the Update Service runs (checking)", async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    show({ code: 20, section: "doc_verified", crossCheck: "pending" });
    await vi.advanceTimersByTimeAsync(3100);
    expect(fetchMock).toHaveBeenCalledWith("/api/verification-status");
    vi.useRealTimers();
  });

  it("shows the fixed copy, never cross_check_reasoning, on the cross-check card", () => {
    show({
      code: 21, section: "doc_verified", crossCheck: "review",
      reasoning: 'Surname mismatch: passport "X" vs certificate "Y"',
    });
    expect(screen.getByText("We're taking a closer look")).toBeInTheDocument();
    expect(
      screen.getByText(
        "The name or date of birth on your certificate doesn't quite match your passport — this often happens after a name change. Our team will check it. You don't need to do anything; we'll email you.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Surname mismatch/)).toBeNull();
  });

  it.each([
    ["new_info (23)", { code: 23, section: "expired" }],
    ["no_match (26)", { code: 26, section: STORED_SECTION.NO_MATCH }],
  ])("badges %s as 'Action needed', never 'Expired'", (_n, row) => {
    show(row);
    expect(screen.getAllByText("Action needed").length).toBeGreaterThan(0);
    expect(screen.queryByText("Expired")).toBeNull();
  });

  it("re-fires the DBS phase on mount when a dbs_certificate upload was queued before a refresh", () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({}) }));
    vi.stubGlobal("fetch", fetchMock);
    show({ code: 29, section: "pending", method: "dbs_certificate" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/run-verification",
      expect.objectContaining({ method: "POST", body: expect.stringContaining('"verificationId":"ver-1"') }),
    );
  });

  it("does not show the fully-verified banner at 21", () => {
    show({ code: 21, section: "review", crossCheck: "not_started" });
    expect(screen.queryByText("Your account is fully verified!")).toBeNull();
  });
});
