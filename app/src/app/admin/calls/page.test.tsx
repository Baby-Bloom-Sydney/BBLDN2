/**
 * /admin/calls server page (plan C3, C4; brief §0.15, §9.1, §9.15; BB-wave1-041126/04c1-build), the /admin/cohorts
 * shape: the switch first — off → 404 before the admin check or any read — then the admin (not one → 404), then the
 * Calls tab's one read and, for `?openCall=<user id>`, her drawer. A failed read says so; it never renders empty.
 *
 * 04c-2 (BB-wave1-041126/04c2-build): the Calendar tab's read runs alongside, after the switch and the admin proof
 * (neither → zero reads); `?tab=calendar` opens it; each tab says when its own read failed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  gate: { userId: "a0400000-0000-4000-8000-000000000001", error: null as string | null },
  gateCalls: 0,
  dashboard: null as unknown,
  dashboardCalls: 0,
  panel: null as unknown,
  panelCalls: [] as string[],
  calendar: null as unknown,
  calendarCalls: 0,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));
vi.mock("@/lib/admin/require-admin", () => ({
  requireAdmin: async () => {
    h.gateCalls += 1;
    return h.gate;
  },
}));
vi.mock("@/lib/calls/dashboard", () => ({
  loadCallsDashboard: async () => {
    h.dashboardCalls += 1;
    return h.dashboard;
  },
}));
vi.mock("@/lib/calls/family-panel", () => ({
  loadFamilyPanel: async (_proof: unknown, id: string) => {
    h.panelCalls.push(id);
    return h.panel;
  },
}));
vi.mock("@/lib/calls/admin-calls", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/calls/admin-calls")>()),
  calendarWeek: async () => {
    h.calendarCalls += 1;
    return h.calendar;
  },
}));
vi.mock("./actions", () => ({
  holdCallForFamily: vi.fn(),
  confirmCallForFamily: vi.fn(),
  cancelCallForFamily: vi.fn(),
  reloadFamilySlots: vi.fn(),
  recordCallOutcomeAction: vi.fn(),
  saveCallSettingsAction: vi.fn(),
  saveWeeklyHoursAction: vi.fn(),
  addCallBlockAction: vi.fn(),
  removeCallBlockAction: vi.fn(),
  startCallBookingAction: vi.fn(),
}));

import AdminCallsPage from "./page";
import { CALENDAR } from "./calendar-fixtures.test-util";
import { AVA, DASHBOARD, PANEL } from "./calls-fixtures.test-util";

beforeEach(() => {
  h.gate = { userId: "a0400000-0000-4000-8000-000000000001", error: null };
  h.gateCalls = 0;
  h.dashboard = { ok: true, value: DASHBOARD };
  h.dashboardCalls = 0;
  h.panel = { ok: true, value: PANEL };
  h.panelCalls = [];
  h.calendar = { ok: true, value: CALENDAR };
  h.calendarCalls = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("/admin/calls", () => {
  it("flag unset → 404 before the admin check or any read (brief §0.15)", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    await expect(AdminCallsPage({})).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.gateCalls).toBe(0);
    expect(h.dashboardCalls).toBe(0);
  });

  it("flag on, not an admin → 404, no read", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    h.gate = { userId: "", error: "Not authorized — admin role required" };
    await expect(AdminCallsPage({})).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.gateCalls).toBe(1);
    expect(h.dashboardCalls).toBe(0);
  });

  it("flag on, admin → the Calls heading, the London note and the tab; no drawer read without ?openCall", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    render(await AdminCallsPage({}));
    expect(screen.getByRole("heading", { level: 1, name: "Calls" })).toBeInTheDocument();
    expect(screen.getByText(/Every time on this page is London time\./)).toBeInTheDocument();
    expect(screen.getByText("Calls still to make this week: 4 (2 booked · 2 not booked)")).toBeInTheDocument();
    expect(h.dashboardCalls).toBe(1);
    expect(h.panelCalls).toEqual([]);
  });

  it("?openCall=<user id> → her drawer is read and open", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    render(await AdminCallsPage({ searchParams: { openCall: AVA } }));
    expect(h.panelCalls).toEqual([AVA]);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  it("?openCall that isn't a user id is ignored (no read, no drawer)", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    render(await AdminCallsPage({ searchParams: { openCall: "../../etc" } }));
    expect(h.panelCalls).toEqual([]);
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("her drawer couldn't be read → the drawer says so", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    h.panel = { ok: false, error: "error" };
    render(await AdminCallsPage({ searchParams: { openCall: [AVA] } }));
    expect(screen.getByRole("alert")).toHaveTextContent("This family could not be read — reload to try again.");
  });

  it("a failed read says so, never an empty page", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    h.dashboard = { ok: false, error: "error" };
    render(await AdminCallsPage({}));
    expect(screen.getByRole("alert")).toHaveTextContent("The calls could not be read — reload to try again.");
    expect(screen.queryByText(/Calls still to make/)).toBeNull();
  });
});

describe("/admin/calls — the Calendar tab (04c-2)", () => {
  it("flag off, or not an admin → the calendar is never read", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    await expect(AdminCallsPage({ searchParams: { tab: "calendar" } })).rejects.toThrow("NEXT_NOT_FOUND");
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    h.gate = { userId: "", error: "Not authorized — admin role required" };
    await expect(AdminCallsPage({ searchParams: { tab: "calendar" } })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.calendarCalls).toBe(0);
  });

  it("an admin: the calendar is read once, alongside the calls; with no ?tab the Calls tab is open", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    render(await AdminCallsPage({}));
    expect(h.calendarCalls).toBe(1);
    expect(h.dashboardCalls).toBe(1);
    expect(screen.getByRole("tab", { name: "Calls" })).toHaveAttribute("aria-selected", "true");
  });

  it.each([["calendar"], [["calendar", "calls"]]])("?tab=%j opens the Calendar tab", async (tab) => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    render(await AdminCallsPage({ searchParams: { tab } }));
    expect(screen.getByRole("tab", { name: "Calendar" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { level: 2, name: "Next 7 days (London time)" })).toBeInTheDocument();
  });

  it("any other ?tab is the Calls tab", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    render(await AdminCallsPage({ searchParams: { tab: "<script>" } }));
    expect(screen.getByRole("tab", { name: "Calls" })).toHaveAttribute("aria-selected", "true");
  });

  it("the calendar couldn't be read → its tab says so; the calls read stands", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    h.calendar = { ok: false, error: "error" };
    render(await AdminCallsPage({ searchParams: { tab: "calendar" } }));
    expect(screen.getByRole("alert")).toHaveTextContent("The calendar could not be read — reload to try again.");
  });

  it("the calls couldn't be read → the Calendar tab still opens", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    h.dashboard = { ok: false, error: "error" };
    render(await AdminCallsPage({ searchParams: { tab: "calendar" } }));
    expect(screen.getByRole("heading", { level: 2, name: "Next 7 days (London time)" })).toBeInTheDocument();
  });
});
