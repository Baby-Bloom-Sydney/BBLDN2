/**
 * Plan 06 step 18 (§14.6 c.2; brief §0.13, §3 admin 1): "Invoices" → /admin/invoices in both admin menus, between
 * Cohorts and Payouts (plan D4: after Guarantees, before Payouts), only while NANNY_INVOICES_ENABLED is "true". Off →
 * absent with the rest of the menu intact. Never in a parent's or a nanny's menu.
 *
 * BB-wave1-041126/06c, 2026-11-23.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render } from "@testing-library/react";

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

import { MobileNav } from "./MobileNav";
import { Sidebar } from "./Sidebar";

afterEach(() => {
  cleanup();
  vi.unstubAllEnvs();
});

const link = () => document.querySelector('a[href="/admin/invoices"]');
const hrefs = () => [...document.querySelectorAll("a")].map((a) => a.getAttribute("href"));

const menus = [
  ["Sidebar", (role: string) => render(<Sidebar role={role as "admin"} collapsed={false} onToggle={() => {}} />)],
  ["MobileNav", (role: string) => render(<MobileNav role={role as "admin"} open onOpenChange={() => {}} />)],
] as const;

describe.each(menus)("%s — admin Invoices entry", (_name, renderMenu) => {
  it.each(["", "false", "TRUE", "1"])("switch %j → absent, the rest of the admin menu intact", (value) => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", value);
    auth.role = "admin";
    renderMenu("admin");
    expect(link()).toBeNull();
    for (const href of ["/admin/subscriptions", "/admin/guarantees", "/admin/support", "/admin/settings"]) {
      expect(document.querySelector(`a[href="${href}"]`)).not.toBeNull();
    }
  });

  it.each(["admin", "super_admin"] as const)("switch on → present for %s, labelled Invoices, before Payouts", (role) => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
    vi.stubEnv("PAYOUTS_ENABLED", "true");
    vi.stubEnv("COHORTS_ENABLED", "true");
    auth.role = role;
    renderMenu(role);
    expect(link()).not.toBeNull();
    expect(link()?.textContent).toContain("Invoices");
    const order = hrefs();
    expect(order.indexOf("/admin/invoices")).toBe(order.indexOf("/admin/cohorts") + 1);
    expect(order.indexOf("/admin/payouts")).toBe(order.indexOf("/admin/invoices") + 1);
    expect(order).toContain("/admin/subscriptions");
  });

  it("switch on, Cohorts and Payouts off → still after Guarantees, the menu otherwise as before", () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
    auth.role = "admin";
    renderMenu("admin");
    const order = hrefs();
    expect(order.indexOf("/admin/invoices")).toBe(order.indexOf("/admin/guarantees") + 1);
    expect(order).toContain("/admin/subscriptions");
  });
});

describe("never in a parent's or a nanny's menu", () => {
  it.each(["parent", "nanny"] as const)("%s, even when on", (role) => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
    auth.role = role;
    render(<Sidebar role={role} collapsed={false} onToggle={() => {}} />);
    expect(link()).toBeNull();
    cleanup();
    render(<MobileNav role={role} open onOpenChange={() => {}} />);
    expect(link()).toBeNull();
  });
});
