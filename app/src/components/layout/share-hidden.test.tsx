/**
 * Unit 5b (BB-LDN-5b-151026) — the nanny "Share Profile" nav entry is not rendered while `SHARE_LOOP_ENABLED` is off
 * (P-23, Stage 5 ruling 2). The rest of the nanny menu (babysitting included — 5c's) is untouched. Flag on → as before.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/nanny", useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: { id: "u1", email: "someone@example.test" },
    profile: { first_name: "Sam", last_name: "Lee" },
    role: "nanny",
    signOut: vi.fn(),
  }),
}));
vi.mock("@/lib/analytics/trackEvent", () => ({ trackEvent: vi.fn() }));

import { MobileNav } from "./MobileNav";
import { Sidebar } from "./Sidebar";

afterEach(() => vi.unstubAllEnvs());

const shareLink = () => document.querySelector('a[href="/nanny/share"]');
const NAVS: Array<[string, () => void]> = [
  ["Sidebar", () => render(<Sidebar role="nanny" collapsed={false} onToggle={() => {}} />)],
  ["MobileNav", () => render(<MobileNav role="nanny" open onOpenChange={() => {}} />)],
];

describe.each(NAVS)("%s — nanny Share Profile entry", (_name, renderNav) => {
  it("absent when off; the rest of the nanny menu intact", () => {
    vi.stubEnv("SHARE_LOOP_ENABLED", "");
    renderNav();
    expect(shareLink()).toBeNull();
    expect(document.querySelector('a[href="/nanny/verification"]')).not.toBeNull();
    expect(document.querySelector('a[href="/nanny/inbox"]')).not.toBeNull();
  });
  it("present when on", () => {
    vi.stubEnv("SHARE_LOOP_ENABLED", "true");
    renderNav();
    expect(shareLink()).not.toBeNull();
  });
});
