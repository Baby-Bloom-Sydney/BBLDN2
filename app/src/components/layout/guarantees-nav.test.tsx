/**
 * Unit 4e (BB-LDN-4e-151026) — the admin menus carry "Guarantees" → /admin/guarantees on desktop and mobile;
 * no other role sees it.
 */
import { describe, it, expect, vi } from "vitest";
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

import { MobileNav } from "./MobileNav";
import { Sidebar } from "./Sidebar";

const link = () => document.querySelector('a[href="/admin/guarantees"]');

describe("Guarantees admin menu entry", () => {
  it("desktop sidebar (admin)", () => {
    auth.role = "admin";
    render(<Sidebar role="admin" collapsed={false} onToggle={() => {}} />);
    expect(link()).not.toBeNull();
    expect(screen.getByText("Guarantees")).toBeInTheDocument();
  });
  it("mobile nav (super_admin)", () => {
    auth.role = "super_admin";
    render(<MobileNav role="super_admin" open onOpenChange={() => {}} />);
    expect(link()).not.toBeNull();
  });
  it("not in a parent's menu", () => {
    auth.role = "parent";
    render(<Sidebar role="parent" collapsed={false} onToggle={() => {}} />);
    expect(link()).toBeNull();
  });
});
