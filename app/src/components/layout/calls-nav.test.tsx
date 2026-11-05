/**
 * Brief 04 §0.8 (plan C1; BB-wave1-041126/04c1-build): "Calls" → /admin/calls in both admin menus, right after
 * Contacts, only while CALL_BOOKING_ENABLED is "true". Off → absent with the rest of the menu intact (brief §0.15).
 * Never in a parent's or a nanny's menu.
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

const link = () => document.querySelector('a[href="/admin/calls"]');
const hrefs = () => [...document.querySelectorAll("a")].map((a) => a.getAttribute("href"));

const menus = [
  ["Sidebar", (role: "admin" | "super_admin") => render(<Sidebar role={role} collapsed={false} onToggle={() => {}} />)],
  ["MobileNav", (role: "admin" | "super_admin") => render(<MobileNav role={role} open onOpenChange={() => {}} />)],
] as const;

describe.each(menus)("%s — admin Calls entry", (_name, renderMenu) => {
  it("absent when off, the rest of the admin menu intact and in today's order", () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    auth.role = "admin";
    renderMenu("admin");
    expect(link()).toBeNull();
    const order = hrefs();
    expect(order).toContain("/admin/leads");
    expect(order).toContain("/admin/users");
    expect(order.indexOf("/admin/users")).toBeGreaterThan(order.indexOf("/admin/leads"));
  });

  it.each(["admin", "super_admin"] as const)("present when on, right after Contacts (%s)", (role) => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    auth.role = role;
    renderMenu(role);
    expect(link()).not.toBeNull();
    expect(link()?.textContent).toContain("Calls");
    const order = hrefs();
    expect(order.indexOf("/admin/calls")).toBe(order.indexOf("/admin/leads") + 1);
  });

  it("only a literal \"true\" switches it on", () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "TRUE");
    auth.role = "admin";
    renderMenu("admin");
    expect(link()).toBeNull();
  });
});

describe("never in a parent's or a nanny's menu", () => {
  it.each(["parent", "nanny"] as const)("%s, even when on", (role) => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    auth.role = role;
    render(<Sidebar role={role} collapsed={false} onToggle={() => {}} />);
    expect(link()).toBeNull();
    render(<MobileNav role={role} open onOpenChange={() => {}} />);
    expect(link()).toBeNull();
  });
});
