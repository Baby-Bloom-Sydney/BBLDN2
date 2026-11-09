/**
 * Brief 06 (plan 06 §14.6 b3.4; acceptance A1) — the settings "Business" node, the payouts test's pattern. While
 * `NANNY_INVOICES_ENABLED` is off the node is not in the menu and `?s=business` renders nothing of the section, even if
 * a section were passed. On: the node sits after "Account" and `?s=business` renders the section the server page
 * passed in (`businessSection`, a server component slot).
 *
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const params = vi.hoisted(() => ({ s: "" }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(params.s),
  usePathname: () => "/nanny/settings",
}));
vi.mock("@/lib/actions/nanny", () => ({ deactivateNannyAccount: vi.fn() }));
vi.mock("@/lib/actions/nanny-account-settings", () => ({ updateNannyAccountSettings: vi.fn() }));
vi.mock("@/lib/actions/account-security", () => ({ requestPasswordChange: vi.fn() }));

import { NannySettingsClient } from "./NannySettingsClient";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const PROFILE = {
  first_name: "Jane", last_name: "Doe", email: "jane@example.test", mobile_number: "+447700900123",
  date_of_birth: "1990-01-01", suburb: "Camden", postcode: "NW1 0AA",
  address_line1: "1 Camden Road", address_line2: "", updated_at: null,
};

function show(s: string, businessSection: React.ReactNode = <div data-testid="business-section" />) {
  params.s = s;
  return render(
    <NannySettingsClient
      profile={PROFILE}
      verificationLevel={2}
      dbs={null}
      payoutsDashboard={null}
      payoutHistory={null}
      payoutOnboarding={{ status: "not_applied", email: null, bankSummary: null }}
      businessSection={businessSection}
    />,
  );
}

/** The top-level menu labels in order (the mobile list; the desktop sidebar repeats them). */
const menu = (): string[] =>
  [...document.querySelectorAll("ul a p")].map((p) => p.textContent ?? "").filter((t, i, all) => all.indexOf(t) === i);

describe("nanny settings — Business node (brief 06)", () => {
  it.each(["", "false", "TRUE", "1"])("switch %j: not in the menu; the rest of the menu is", (value) => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", value);
    show("");
    expect(screen.queryAllByText("Business")).toHaveLength(0);
    expect(menu()).toEqual(["Profile", "Account", "Linked children", "Contact us"]);
  });

  it("switch off: the deep link ?s=business renders nothing of the section", () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "");
    show("s=business");
    expect(screen.queryAllByTestId("business-section")).toHaveLength(0);
  });

  it("switch on: 'Business' sits after 'Account'", () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
    show("");
    expect(menu()).toEqual(["Profile", "Account", "Business", "Linked children", "Contact us"]);
  });

  it("switch on: ?s=business renders the section the page passed, under its breadcrumb; the section draws its own title (06b-3 rework)", () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
    show("s=business");
    expect(screen.getAllByTestId("business-section").length).toBeGreaterThan(0);
    expect(screen.getAllByRole("navigation", { name: "Breadcrumb" })[0]).toHaveTextContent("Business");
    expect(screen.queryAllByRole("heading", { level: 2, name: "Business" })).toHaveLength(0);
  });

  it("switch on, no section passed: renders nothing in its place (and nothing breaks)", () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
    show("s=business", null);
    expect(screen.queryAllByTestId("business-section")).toHaveLength(0);
    expect(screen.getAllByRole("navigation", { name: "Breadcrumb" })[0]).toHaveTextContent("Business");
  });

  it("other leaves never render the section", () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
    show("s=contact");
    expect(screen.queryAllByTestId("business-section")).toHaveLength(0);
  });
});
