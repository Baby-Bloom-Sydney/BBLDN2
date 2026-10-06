/**
 * Unit 3b (BB-LDN-3b-061026) — processing step reads the DBS display state, not only the code (brief change 5;
 * rulings #10, #30; copy deck §1.4). "You're verified!" only at `clear`; 21 never; API-down goes to the failure bucket.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, act } from "@testing-library/react";

const nav = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: nav.push, replace: vi.fn(), refresh: vi.fn() }) }));
vi.mock("@/lib/supabase/storage", () => ({ uploadFileWithProgress: vi.fn() }));

import { VerificationProcessingStep } from "./steps/VerificationProcessingStep";
import { OnboardingVerificationClient } from "./OnboardingVerificationClient";
import { GUIDANCE_MESSAGES } from "@/lib/verification";
import { dbsPoll, STORED_SECTION } from "@/lib/dbs/fixtures.test-util";

const profile = { firstName: "Jane", profilePictureUrl: null, bioSnippet: null };

function mockPoll(body: Record<string, unknown>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true, json: async () => body })),
  );
}

beforeEach(() => {
  vi.useFakeTimers();
  nav.push.mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

async function renderStep(body: Record<string, unknown>, ms = 7000) {
  mockPoll(body);
  const onComplete = vi.fn();
  render(<VerificationProcessingStep profile={profile} onComplete={onComplete} />);
  await advance(ms);
  return onComplete;
}

/** Step time in slices so each effect's timeout is scheduled before the clock moves past it (React flushes per act). */
async function advance(ms: number) {
  for (let left = ms; left > 0; left -= 500) {
    await act(async () => {
      await vi.advanceTimersByTimeAsync(Math.min(500, left));
    });
  }
}

describe("VerificationProcessingStep", () => {
  it("shows 'Reading your certificate…' when the poll returns 29", async () => {
    await renderStep(dbsPoll({code: 29, section: "pending", crossCheck: "not_started" }), 100);
    expect(screen.getByText("Reading your certificate…")).toBeInTheDocument();
    expect(screen.getByText("DBS")).toBeInTheDocument();
  });

  it("shows 'Checking with the DBS Update Service…' when the poll returns 20 + cross-check pending", async () => {
    await renderStep(dbsPoll({code: 20, section: "doc_verified", crossCheck: "pending", guidance: null }), 100);
    expect(screen.getByText("Checking with the DBS Update Service…")).toBeInTheDocument();
  });

  it("shows 'Almost done…' when the result is in but the minimum display time has not ended", async () => {
    await renderStep(dbsPoll({code: 30, section: "doc_verified", crossCheck: "passed" }), 100);
    expect(screen.getByText("Almost done…")).toBeInTheDocument();
    expect(screen.queryByText("You’re verified!")).toBeNull();
  });

  it("shows \"You're verified!\" when the poll returns 30", async () => {
    const onComplete = await renderStep(dbsPoll({code: 30, section: "doc_verified", crossCheck: "passed" }));
    expect(screen.getByText("You’re verified!")).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledWith("success");
  });

  it("never shows \"You're verified!\" when the poll returns 21", async () => {
    const onComplete = await renderStep(dbsPoll({code: 21, section: "doc_verified", crossCheck: "review" }));
    expect(screen.queryByText("You’re verified!")).toBeNull();
    expect(screen.getByText("Under review")).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledWith("review");
    expect(onComplete).not.toHaveBeenCalledWith("success");
  });

  it.each([
    ["23", dbsPoll({code: 23, section: "expired", crossCheck: "not_started" })],
    ["26", dbsPoll({code: 26, section: STORED_SECTION.NO_MATCH, crossCheck: "not_started" })],
  ])("never shows \"You're verified!\" at %s (P-7) and reports failure", async (_c, body) => {
    const onComplete = await renderStep(body);
    expect(screen.queryByText("You’re verified!")).toBeNull();
    expect(screen.getByText("There was a problem with your certificate. We'll show you what to fix.")).toBeInTheDocument();
    expect(onComplete).toHaveBeenCalledWith("failure");
  });
});

describe("OnboardingVerificationClient — processing outcome routing", () => {
  it("goes to the failure bucket and pushes /nanny/verification when the poll returns 20 + TECHNICAL_RETRY guidance", async () => {
    mockPoll(dbsPoll({ code: 20, section: "doc_verified", crossCheck: "pending", guidance: GUIDANCE_MESSAGES.TECHNICAL_RETRY }));
    render(
      <OnboardingVerificationClient
        initialStep={4}
        verification={null}
        userId="user-1"
        profile={{
          firstName: "Jane", lastName: "Doe", dateOfBirth: "", mobileNumber: "", suburb: "", postcode: "",
          profilePictureUrl: null, bioSnippet: null, nationality: null,
        }}
      />,
    );
    await advance(5000);
    expect(screen.getByText("We ran into an issue")).toBeInTheDocument();
    expect(screen.queryByText("You’re verified!")).toBeNull();
    expect(nav.push).toHaveBeenCalledWith("/nanny/verification");
  });
});
