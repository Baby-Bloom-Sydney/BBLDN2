/**
 * The call slide carries no app chrome (brief 04 §0a.1; 04b rework W2): at `/matchmaking/call` there is no app header,
 * no Katie (aside or tabs), no footer and no landing header — the funnel's white page only, as the onboarding slides.
 * KatieShell renders its plain layout for any path outside `/parent` and `/nanny`; the MiniFooter hides itself there;
 * the `(funnel)` route group has no layout of its own (so no LandingHeader).
 */
import { render, screen } from "@testing-library/react";
import { existsSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";

const nav = vi.hoisted(() => ({ pathname: "/matchmaking/call", search: "" }));
vi.mock("next/navigation", () => ({
  usePathname: () => nav.pathname,
  useSearchParams: () => new URLSearchParams(nav.search),
}));
vi.mock("@/components/layout/DashboardNav", () => ({ DashboardNav: () => <nav data-testid="app-header" /> }));
vi.mock("@/components/katie/KatieDeck", () => ({ KatieDeck: () => <div data-testid="katie-deck" /> }));
vi.mock("@/components/katie/use-katie-realtime", () => ({ useKatieRealtime: () => {} }));
vi.mock("@/components/katie/use-mark-read-on-visibility", () => ({ useIsDesktop: () => true, useMarkReadOnVisibility: () => {} }));

import { KatieShell } from "@/components/katie/KatieShell";
import { MiniFooter } from "@/components/layout/MiniFooter";

beforeEach(() => {
  nav.pathname = "/matchmaking/call";
  nav.search = "";
});

describe("the call slide's chrome", () => {
  it.each(["/matchmaking/call", "/matchmaking/call?next=%2Fparent&change=1"])("%s: no app header, no Katie, no footer", (url) => {
    const [pathname, search = ""] = url.split("?");
    nav.pathname = pathname;
    nav.search = search;
    render(
      <KatieShell footer={<MiniFooter />}>
        <p>the slide</p>
      </KatieShell>,
    );
    expect(screen.getByText("the slide")).toBeInTheDocument();
    expect(screen.queryByTestId("app-header")).not.toBeInTheDocument();
    expect(screen.queryByTestId("katie-deck")).not.toBeInTheDocument();
    expect(screen.queryByRole("tablist")).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "About" })).not.toBeInTheDocument();
  });

  it("the footer still shows on other funnel pages (unchanged)", () => {
    nav.pathname = "/matchmaking/results";
    render(<MiniFooter />);
    expect(screen.getByRole("link", { name: "About" })).toBeInTheDocument();
  });

  it("the (funnel) route group has no layout above the call slide (so no landing header)", () => {
    const app = path.resolve(__dirname, "../../app");
    for (const dir of ["(funnel)", "(funnel)/matchmaking", "(funnel)/matchmaking/call"]) {
      expect(existsSync(path.join(app, dir, "layout.tsx"))).toBe(false);
    }
  });
});
