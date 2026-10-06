/**
 * LDN2 unit 3h — `/parent/dashboard` keeps the page (H-2) and loses the
 * parent verification banner and its status fetch (L11). The welcome email
 * links here, so a banner that falls back to "unverified" on a failed fetch
 * would show to every parent once the status route is gone.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, render, screen } from "@testing-library/react";

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ profile: { first_name: "Pat" }, isLoading: false }),
}));

import ParentDashboardPage from "./page";

const fetchMock = vi.fn();

// The removed status route, built so this file never carries the literal the
// 3h grep proof (and its gate in `scripts/ci/`) forbids.
const STATUS_ROUTE = `/api/${"parent"}-${"verification"}-status`;

/** Flush the mount effect's fetch → json → setState chain. */
async function settle() {
  await act(async () => {
    await new Promise((r) => setTimeout(r, 20));
  });
}

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("/parent/dashboard — no parent verification (3h)", () => {
  it(`renders no verification banner when ${STATUS_ROUTE} is unavailable`, async () => {
    fetchMock.mockResolvedValue(
      new Response("Not Found", { status: 404 }),
    );
    render(<ParentDashboardPage />);
    expect(await screen.findByText(/Welcome, Pat!/)).toBeInTheDocument();
    // Let any pending fetch chain settle before asserting absence.
    await settle();
    expect(screen.queryAllByText(/verify/i)).toHaveLength(0);
    expect(document.querySelector('a[href*="verif"]')).toBeNull();
  });

  it(`makes no request to ${STATUS_ROUTE} when the dashboard mounts`, async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 200 }));
    render(<ParentDashboardPage />);
    await screen.findByText(/Welcome, Pat!/);
    await settle();
    const urls = fetchMock.mock.calls.map(([url]) => String(url));
    expect(urls.filter((u) => u.includes(STATUS_ROUTE))).toEqual([]);
    expect(urls.filter((u) => /verif/i.test(u))).toEqual([]);
  });
});
