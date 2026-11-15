/**
 * The hub on arrival from "Add family" (06b-4 rework addition, BAI 2026-11-12; ledger B06 "What to build" 2–4):
 * - `?tab=children` (`initialTab`) starts an unlocked nanny (verification level 3 and up) on the Children tab;
 *   `?add=child` (`openAddChild`) opens her add-child sheet once, on arrival.
 * - A nanny with locked tabs gets today's default page, and no sheet.
 * - With no parameters the hub is exactly today's (the other hub tests are unchanged).
 * - `add` is removed from the address on arrival (keeping `tab=children`), so a refresh doesn't open the sheet again;
 *   coming back to the Children tab doesn't either.
 *
 * BB-wave1-041126/06b4-ui, 2026-11-12.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn() }),
  usePathname: () => "/nanny",
  useSearchParams: () => new URLSearchParams(),
}));

import { NannyHubClient } from "./NannyHubClient";

const ARRIVAL = { initialTab: "children", openAddChild: true } as const;

function hub(level: number, arrival: Partial<{ initialTab: "children"; openAddChild: boolean }> = {}) {
  return render(
    <NannyHubClient
      firstName="Jane" lastName="Doe" profilePictureUrl={null}
      verificationLevel={level}
      verificationData={null}
      nannyProfile={null}
      placements={[]} upcomingIntros={[]} dfyNotifications={[]} openPositions={[]} nannyApplications={[]}
      babysittingJobs={[]} bsrBanned={false} bsrBanUntil={null} shareUnlocked={false} educationChildren={[]}
      {...arrival}
    />,
  );
}

/** The page's markup with React's generated ids evened out, to compare two renders. */
const markup = (container: HTMLElement): string => container.innerHTML.replace(/:r[0-9a-z]+:/g, ":r:");
const sheet = () => screen.queryByRole("dialog", { name: "Add a Child" });

beforeEach(() => window.history.replaceState(null, "", "/nanny"));
afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("NannyHubClient — arriving from Add family", () => {
  it("an unlocked nanny with ?tab=children&add=child: the Children tab, the add-child sheet open", () => {
    window.history.replaceState(null, "", "/nanny?tab=children&add=child");
    hub(3, ARRIVAL);
    expect(screen.getByRole("dialog", { name: "Add a Child" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Connections" })).toBeNull();
  });

  it("?tab=children alone: the Children tab, no sheet", () => {
    hub(3, { initialTab: "children" });
    expect(screen.getByRole("button", { name: "Add Child" })).toBeInTheDocument();
    expect(sheet()).toBeNull();
  });

  it("a nanny with locked tabs: today's default page, no sheet", () => {
    const today = markup(hub(2).container);
    cleanup();
    const arrived = hub(2, ARRIVAL);
    expect(sheet()).toBeNull();
    expect(markup(arrived.container)).toBe(today);
  });

  it("no parameters: today's default (Nannying), no sheet", () => {
    hub(3);
    expect(screen.getByRole("button", { name: "Connections" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Add Child" })).toBeNull();
    expect(sheet()).toBeNull();
  });

  it("add=child without tab=children: today's default, and the Children tab later opens no sheet", async () => {
    hub(3, { openAddChild: true });
    expect(screen.getByRole("button", { name: "Connections" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Children" }));
    expect(screen.getByRole("button", { name: "Add Child" })).toBeInTheDocument();
    expect(sheet()).toBeNull();
  });

  it("add is removed from the address on arrival, tab=children kept; back on Children later, no sheet", async () => {
    window.history.replaceState(null, "", "/nanny?tab=children&add=child#top");
    hub(3, ARRIVAL);
    await waitFor(() => expect(window.location.search).toBe("?tab=children"));
    expect(window.location.pathname).toBe("/nanny");
    expect(window.location.hash).toBe("#top");
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(sheet()).toBeNull());
    await userEvent.click(screen.getByRole("button", { name: "Nannying" }));
    await userEvent.click(screen.getByRole("button", { name: "Children" }));
    expect(screen.getByRole("button", { name: "Add Child" })).toBeInTheDocument();
    expect(sheet()).toBeNull();
  });

  it("no add in the address: it is left as it is", () => {
    window.history.replaceState(null, "", "/nanny?tab=children&x=1");
    hub(3, { initialTab: "children" });
    expect(window.location.search).toBe("?tab=children&x=1");
  });
});
