/**
 * The ways in to the nanny's invoices (plan 06 old step 16, §14.6 b4.6, R11; brief §3 nanny 1, §8, §9.1), each hidden
 * while `NANNY_INVOICES_ENABLED` is off (P-23) — the `payouts-hidden` pattern:
 * - **Avatar menu:** "Invoices" by Settings, for a nanny only, with the switch on; never for a parent.
 * - **A family's popup** (`NannyPositionsClient`): "Create invoice" under "Estimated weekly pay", opening the form for
 *   that placement (the popup is opened here, which `share-cta-default.test.tsx` never does).
 * - **Katie's tabs** are hidden on `/nanny/invoices` with the switch on, as on Settings; with it off the hidden paths
 *   are today's. The switch is read at call time, so both states are tested without module resets (R11).
 *
 * BB-wave1-041126/06b4, 2026-11-12.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const nav = vi.hoisted(() => ({ pathname: "/nanny/invoices" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u1", email: "someone@example.test" }, profile: { first_name: "Sam", last_name: "Lee" }, role: "nanny", signOut: vi.fn() }),
}));
vi.mock("@/lib/analytics/trackEvent", () => ({ trackEvent: vi.fn() }));
vi.mock("./NannyEarningsBadge", () => ({ NannyEarningsBadge: () => null }));
vi.mock("@/components/katie/KatieDeck", () => ({ KatieDeck: () => <div data-testid="katie-deck" /> }));
vi.mock("@/components/katie/use-katie-realtime", () => ({ useKatieRealtime: () => {} }));
vi.mock("@/components/katie/use-mark-read-on-visibility", () => ({ useIsDesktop: () => true, useMarkReadOnVisibility: () => {} }));
vi.mock("@/lib/actions/babysitting", () => ({ requestBabysittingJob: vi.fn(), declineBabysittingRequest: vi.fn(), nannyCancelBabysittingRequest: vi.fn() }));
vi.mock("@/lib/legal/record-consent", () => ({ recordInformedAction: vi.fn() }));

import { KatieShell } from "@/components/katie/KatieShell";
import { CreateInvoiceLink } from "@/app/nanny/invoices/CreateInvoiceLink";
import { NannyPositionsClient, type Placement } from "@/app/nanny/positions/NannyPositionsClient";
import { DashboardNav } from "./DashboardNav";

const PLACEMENT_ID = "b0600000-0000-4000-8000-000000000411";
const PLACEMENT: Placement = {
  id: PLACEMENT_ID, parentName: "Olivia Hartley", parentLastName: "Hartley", parentSuburb: "Islington", parentPhoto: null,
  weeklyHours: 30, hourlyRate: 18, hiredAt: "2027-01-20T10:00:00Z", startDate: "2027-02-08", status: "active", positionId: null,
  parentEmail: null, parentPhone: null, positionFormData: null, rosterNotes: null, nannyNotes: null,
};

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
  nav.pathname = "/nanny/invoices";
});

async function openAvatarMenu(role: "nanny" | "parent") {
  render(<DashboardNav role={role} />);
  await userEvent.click(screen.getAllByRole("button")[0]!);
  return screen.findByRole("menu");
}

describe("avatar menu — Invoices", () => {
  it("a nanny with the switch on: Invoices, after Settings", async () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
    const menu = within(await openAvatarMenu("nanny"));
    const items = menu.getAllByRole("menuitem").map((i) => i.textContent?.trim());
    expect(items).toEqual(["Settings", "Invoices", "Sign out"]);
    expect(menu.getByRole("menuitem", { name: "Invoices" })).toHaveAttribute("href", "/nanny/invoices");
  });

  it.each(["", "false", "TRUE", "1"])("switch %j → absent; the menu is today's", async (value) => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", value);
    const menu = within(await openAvatarMenu("nanny"));
    expect(menu.getAllByRole("menuitem").map((i) => i.textContent?.trim())).toEqual(["Settings", "Sign out"]);
  });

  it("never for a parent", async () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
    const menu = within(await openAvatarMenu("parent"));
    expect(menu.queryByRole("menuitem", { name: "Invoices" })).toBeNull();
  });
});

describe("CreateInvoiceLink", () => {
  it("on: Create invoice, for that placement", () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
    render(<CreateInvoiceLink placementId={PLACEMENT_ID} />);
    expect(screen.getByRole("link", { name: "Create invoice" })).toHaveAttribute("href", `/nanny/invoices/new?placement=${PLACEMENT_ID}`);
  });

  it.each(["", "false", "TRUE", "1"])("switch %j → nothing", (value) => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", value);
    const { container } = render(<CreateInvoiceLink placementId={PLACEMENT_ID} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe("a family's popup — Create invoice", () => {
  const openPopup = async () => {
    nav.pathname = "/nanny/positions";
    render(<NannyPositionsClient placements={[PLACEMENT]} />);
    await userEvent.click(screen.getByText("Islington"));
    return within(await screen.findByRole("dialog"));
  };

  it("on: under Estimated weekly pay, opening the form for this placement", async () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
    const popup = await openPopup();
    expect(popup.getByText("Estimated weekly pay")).toBeInTheDocument();
    expect(popup.getByRole("link", { name: "Create invoice" })).toHaveAttribute("href", `/nanny/invoices/new?placement=${PLACEMENT_ID}`);
  });

  it("off: the popup as today", async () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "");
    const popup = await openPopup();
    expect(popup.getByText("Estimated weekly pay")).toBeInTheDocument();
    expect(popup.queryByRole("link", { name: "Create invoice" })).toBeNull();
  });
});

describe("Katie's tabs on the invoice pages (R11)", () => {
  const shell = (pathname: string) => {
    nav.pathname = pathname;
    render(<KatieShell><p>page</p></KatieShell>);
  };

  it.each(["/nanny/invoices", "/nanny/invoices/new", `/nanny/invoices/${PLACEMENT_ID}/pdf`])("on: hidden on %s, as on Settings", (path) => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
    shell(path);
    expect(screen.getByText("page")).toBeInTheDocument();
    expect(screen.queryByRole("tablist")).toBeNull();
  });

  it("off: the hidden paths are today's (the 404 page keeps the tabs, as any unknown nanny path)", () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "");
    shell("/nanny/invoices");
    expect(screen.getByRole("tablist")).toBeInTheDocument();
  });

  it("either way, other pages are unchanged: Settings hidden, the hub shown", () => {
    for (const value of ["", "true"]) {
      vi.stubEnv("NANNY_INVOICES_ENABLED", value);
      shell("/nanny/settings");
      expect(screen.queryByRole("tablist")).toBeNull();
      cleanup();
      shell("/nanny");
      expect(screen.getByRole("tablist")).toBeInTheDocument();
      cleanup();
    }
  });
});
