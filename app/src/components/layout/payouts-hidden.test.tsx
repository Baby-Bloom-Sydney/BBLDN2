/**
 * Unit 4a-i (BB-LDN-4a-i-151026) — the nanny earnings badge and the admin "Payouts" menu entry render nothing
 * while `PAYOUTS_ENABLED` is off (P-23, card 4b, Stage 5 ruling 3: badge + menus). Flag on → as before.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";

const auth = vi.hoisted(() => ({ role: "admin" as string }));

vi.mock("next/navigation", () => ({ usePathname: () => "/admin/dashboard", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "someone@example.test" },
    profile: { first_name: "Sam", last_name: "Lee" },
    role: auth.role,
    signOut: vi.fn(),
  }),
}));
vi.mock("@/lib/analytics/trackEvent", () => ({ trackEvent: vi.fn() }));
vi.mock("./NannyEarningsBadge", () => ({ NannyEarningsBadge: () => <span data-testid="earnings-badge" /> }));

import { DashboardNav } from "./DashboardNav";
import { MobileNav } from "./MobileNav";
import { Sidebar } from "./Sidebar";

afterEach(() => vi.unstubAllEnvs());

const payoutsLink = () => document.querySelector('a[href="/admin/payouts"]');

describe("DashboardNav — nanny earnings badge", () => {
  it("not rendered when off", () => {
    vi.stubEnv("PAYOUTS_ENABLED", "");
    auth.role = "nanny";
    render(<DashboardNav role="nanny" />);
    expect(screen.queryByTestId("earnings-badge")).toBeNull();
  });
  it("rendered when on", () => {
    vi.stubEnv("PAYOUTS_ENABLED", "true");
    auth.role = "nanny";
    render(<DashboardNav role="nanny" />);
    expect(screen.getByTestId("earnings-badge")).toBeInTheDocument();
  });
});

describe("Sidebar — admin Payouts entry", () => {
  it("absent when off, the rest of the admin menu intact", () => {
    vi.stubEnv("PAYOUTS_ENABLED", "");
    auth.role = "admin";
    render(<Sidebar role="admin" collapsed={false} onToggle={() => {}} />);
    expect(payoutsLink()).toBeNull();
    expect(document.querySelector('a[href="/admin/subscriptions"]')).not.toBeNull();
  });
  it("present when on", () => {
    vi.stubEnv("PAYOUTS_ENABLED", "true");
    auth.role = "admin";
    render(<Sidebar role="admin" collapsed={false} onToggle={() => {}} />);
    expect(payoutsLink()).not.toBeNull();
  });
});

describe("MobileNav — admin Payouts entry", () => {
  it("absent when off, the rest of the admin menu intact", () => {
    vi.stubEnv("PAYOUTS_ENABLED", "");
    auth.role = "admin";
    render(<MobileNav role="admin" open onOpenChange={() => {}} />);
    expect(payoutsLink()).toBeNull();
    expect(document.querySelector('a[href="/admin/subscriptions"]')).not.toBeNull();
  });
  it("present when on", () => {
    vi.stubEnv("PAYOUTS_ENABLED", "true");
    auth.role = "admin";
    render(<MobileNav role="admin" open onOpenChange={() => {}} />);
    expect(payoutsLink()).not.toBeNull();
  });
});
