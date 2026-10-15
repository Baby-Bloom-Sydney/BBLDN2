/**
 * Unit 4a-i (BB-LDN-4a-i-151026) — the settings "Contributions" branch embeds the whole payout surface (upcoming
 * payouts, payout history, Stripe Connect onboarding). While `PAYOUTS_ENABLED` is off the branch is not in the menu
 * and its leaves render nothing even when deep-linked (`?s=contribution-settings`). Flag on → as before.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen, cleanup } from "@testing-library/react";

const params = vi.hoisted(() => ({ s: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(params.s),
  usePathname: () => "/nanny/settings",
}));
vi.mock("@/lib/actions/nanny", () => ({ updateNannyAccountSettings: vi.fn(), deactivateNannyAccount: vi.fn() }));
vi.mock("@/lib/actions/account-security", () => ({ requestPasswordChange: vi.fn() }));
vi.mock("@/components/payments/UpcomingPayoutsView", () => ({ UpcomingPayoutsView: () => <div data-testid="upcoming" /> }));
vi.mock("@/components/payments/PayoutHistoryView", () => ({ PayoutHistoryView: () => <div data-testid="history" /> }));
vi.mock("../payouts/onboarding/PayoutOnboardingPageClient", () => ({
  PayoutOnboardingPageClient: () => <div data-testid="connect-onboarding" />,
}));

import { NannySettingsClient } from "./NannySettingsClient";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const PROFILE = {
  first_name: "Jane", last_name: "Doe", email: "jane@example.test", mobile_number: "+447700900123",
  date_of_birth: "1990-01-01", suburb: "Camden", postcode: "NW1 0AA",
};

function show(s: string) {
  params.s = s;
  return render(
    <NannySettingsClient
      profile={PROFILE}
      verificationLevel={2}
      dbs={null}
      payoutsDashboard={null}
      payoutHistory={null}
      payoutOnboarding={{ status: "not_applied", email: null, bankSummary: null }}
    />,
  );
}

describe("nanny settings — Contributions (payout) branch", () => {
  it("is not in the menu when off; the rest of the menu is", () => {
    vi.stubEnv("PAYOUTS_ENABLED", "");
    show("");
    expect(screen.queryAllByText("Contributions")).toHaveLength(0);
    expect(screen.getAllByText("Contact Us").length).toBeGreaterThan(0);
  });

  it.each([
    ["contribution-settings", "connect-onboarding"],
    ["upcoming-contributions", "upcoming"],
    ["contribution-history", "history"],
  ])("deep link ?s=%s renders nothing when off", (leaf, testId) => {
    vi.stubEnv("PAYOUTS_ENABLED", "");
    show(`s=${leaf}`);
    expect(screen.queryAllByTestId(testId)).toHaveLength(0);
  });

  it("is in the menu when on", () => {
    vi.stubEnv("PAYOUTS_ENABLED", "true");
    show("");
    expect(screen.getAllByText("Contributions").length).toBeGreaterThan(0);
  });

  it("deep link ?s=contribution-settings renders Connect onboarding when on", () => {
    vi.stubEnv("PAYOUTS_ENABLED", "true");
    show("s=contribution-settings");
    expect(screen.getAllByTestId("connect-onboarding").length).toBeGreaterThan(0);
  });
});
