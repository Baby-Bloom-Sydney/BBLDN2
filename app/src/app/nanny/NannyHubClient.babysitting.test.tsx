/**
 * Unit 5c (BB-LDN-5c-151026) — the nanny hub keeps its "Babysitting" tab while `BABYSITTING_ENABLED` is off; the
 * body says "Coming soon." for every level (the < 3 lock would hide the body and its modal promises a babysitting
 * dashboard). With the flag on, the old behaviour returns: locked below level 3, the real jobs client at 3+.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup, fireEvent } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/nanny",
  useSearchParams: () => new URLSearchParams(),
}));

import { NannyHubClient } from "./NannyHubClient";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

function hub(level: number) {
  return render(
    <NannyHubClient
      firstName="Jane" lastName="Doe" profilePictureUrl={null}
      verificationLevel={level}
      verificationData={null}
      nannyProfile={null}
      placements={[]} upcomingIntros={[]} dfyNotifications={[]} openPositions={[]} nannyApplications={[]}
      babysittingJobs={[]} bsrBanned={false} bsrBanUntil={null} shareUnlocked educationChildren={[]}
    />,
  );
}

const tab = () => screen.getByRole("button", { name: "Babysitting" });

describe("NannyHubClient — babysitting tab while off (5c)", () => {
  it.each([[2], [3], [4]])('level %i: the tab stays, unlocked, and its body says "Coming soon."', (level) => {
    vi.stubEnv("BABYSITTING_ENABLED", "");
    hub(level);
    expect(tab()).not.toHaveAttribute("aria-disabled");
    fireEvent.click(tab());
    expect(screen.getByText("Coming soon.")).toBeInTheDocument();
    expect(screen.queryByText("Babysitting Jobs")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("NannyHubClient — babysitting tab with the flag on (old behaviour)", () => {
  it("level 2: the tab is locked", () => {
    vi.stubEnv("BABYSITTING_ENABLED", "true");
    hub(2);
    expect(tab()).toHaveAttribute("aria-disabled", "true");
  });

  it("level 4: the tab shows the real jobs client, not the panel", () => {
    vi.stubEnv("BABYSITTING_ENABLED", "true");
    hub(4);
    fireEvent.click(tab());
    expect(screen.queryByText("Coming soon.")).toBeNull();
  });
});
