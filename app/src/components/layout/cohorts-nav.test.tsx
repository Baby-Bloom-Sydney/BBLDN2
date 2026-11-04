/**
 * Brief 02 (BB-wave1-041126/02-build): "Cohorts" → /admin/cohorts in both admin menus, after Guarantees, only while
 * COHORTS_ENABLED is "true" (brief §0.13; plan 02 step 9). Off → absent with the rest of the menu intact. Never in a
 * parent's or a nanny's menu.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";

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

afterEach(() => vi.unstubAllEnvs());

const link = () => document.querySelector('a[href="/admin/cohorts"]');
const hrefs = () => [...document.querySelectorAll("a")].map((a) => a.getAttribute("href"));

const menus = [
  ["Sidebar", (role: "admin" | "super_admin") => render(<Sidebar role={role} collapsed={false} onToggle={() => {}} />)],
  ["MobileNav", (role: "admin" | "super_admin") => render(<MobileNav role={role} open onOpenChange={() => {}} />)],
] as const;

describe.each(menus)("%s — admin Cohorts entry", (_name, renderMenu) => {
  it("absent when off, the rest of the admin menu intact", () => {
    vi.stubEnv("COHORTS_ENABLED", "");
    auth.role = "admin";
    renderMenu("admin");
    expect(link()).toBeNull();
    expect(document.querySelector('a[href="/admin/subscriptions"]')).not.toBeNull();
    expect(document.querySelector('a[href="/admin/guarantees"]')).not.toBeNull();
  });

  it.each(["admin", "super_admin"] as const)("present when on, right after Guarantees (%s)", (role) => {
    vi.stubEnv("COHORTS_ENABLED", "true");
    auth.role = role;
    renderMenu(role);
    expect(link()).not.toBeNull();
    expect(link()?.textContent).toContain("Cohorts");
    const order = hrefs();
    expect(order.indexOf("/admin/cohorts")).toBe(order.indexOf("/admin/guarantees") + 1);
  });
});

describe("never in a parent's or a nanny's menu", () => {
  it.each(["parent", "nanny"] as const)("%s, even when on", (role) => {
    vi.stubEnv("COHORTS_ENABLED", "true");
    auth.role = role;
    render(<Sidebar role={role} collapsed={false} onToggle={() => {}} />);
    expect(link()).toBeNull();
    render(<MobileNav role={role} open onOpenChange={() => {}} />);
    expect(link()).toBeNull();
  });
});
