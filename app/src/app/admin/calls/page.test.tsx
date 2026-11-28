/**
 * /admin/calls server page (plan C3, C4; brief §0.15, §9.1, §9.15; BB-wave1-041126/04c1-build), the /admin/cohorts
 * shape: the switch first — off → 404 before the admin check or any read — then the admin (not one → 404), then the
 * Calls tab's one read and, for `?openCall=<user id>`, her drawer. A failed read says so; it never renders empty.
 *
 * 04c-2 (BB-wave1-041126/04c2-build): the Calendar tab's read runs alongside, after the switch and the admin proof
 * (neither → zero reads); `?tab=calendar` opens it; each tab says when its own read failed.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  gate: { userId: "a0400000-0000-4000-8000-000000000001", error: null as string | null },
  gateCalls: 0,
  dashboard: null as unknown,
  dashboardCalls: 0,
  panel: null as unknown,
  panelCalls: [] as string[],
  calendar: null as unknown,
  calendarCalls: 0,
  search: "",
  unmatched: null as unknown,
  unmatchedCalls: [] as unknown[],
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(h.search),
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
vi.mock("@/lib/justcall/admin", () => ({
  listUnmatched: async (proof: unknown) => {
    h.unmatchedCalls.push(proof);
    return h.unmatched;
  },
}));
vi.mock("./justcall-actions", () => ({
  saveJustCallOutcomeAction: vi.fn(),
  attachJustCallAction: vi.fn(),
  dismissJustCallAction: vi.fn(),
  searchFamiliesForCallAction: vi.fn(),
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
  h.search = "";
  h.unmatched = { ok: true, value: { total: 1, calls: [{ callSid: "CAun0001", number: "+44 (0) 7700 900 599", when: "Tue 9 Feb, 14:03 (London time)", direction: "Outgoing", result: "Answered", duration: "6 min 12 s", reason: "No family with this number", resultCode: "answered", matchNote: "none" }] } };
  h.unmatchedCalls = [];
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
    h.search = new URLSearchParams([tab].flat().map((t) => ["tab", t])).toString();
    render(await AdminCallsPage({ searchParams: { tab } }));
    expect(screen.getByRole("tab", { name: "Calendar" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { level: 2, name: "Next 7 days (London time)" })).toBeInTheDocument();
  });

  it("any other ?tab is the Calls tab", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    h.search = "tab=%3Cscript%3E";
    render(await AdminCallsPage({ searchParams: { tab: "<script>" } }));
    expect(screen.getByRole("tab", { name: "Calls" })).toHaveAttribute("aria-selected", "true");
  });

  it("the calendar couldn't be read → its tab says so; the calls read stands", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    h.calendar = { ok: false, error: "error" };
    h.search = "tab=calendar";
    render(await AdminCallsPage({ searchParams: { tab: "calendar" } }));
    expect(screen.getByRole("alert")).toHaveTextContent("The calendar could not be read — reload to try again.");
  });

  it("the calls couldn't be read → the Calendar tab still opens", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    h.dashboard = { ok: false, error: "error" };
    h.search = "tab=calendar";
    render(await AdminCallsPage({ searchParams: { tab: "calendar" } }));
    expect(screen.getByRole("heading", { level: 2, name: "Next 7 days (London time)" })).toBeInTheDocument();
  });
});

/**
 * Brief 05 §0.11–§0.12, plan §9 row 1 (05a-2): with JustCall logging off, /admin/calls is today's tree exactly. The
 * snapshots were taken at `1e79240`, before 05a-2 changed any file; React's generated ids are normalised so the
 * snapshot doesn't depend on test order.
 */
describe("/admin/calls — today's tree while JustCall logging is off", () => {
  const tree = () => document.body.innerHTML.replace(/:r[0-9a-z]+:/g, ":r:");

  it.each([
    ["switch unset", ""],
    ["switch on, call booking's on too, but logging isn't 'true'", "TRUE"],
  ])("the Calls tab (%s)", async (_label, logging) => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    vi.stubEnv("JUSTCALL_WEBHOOK_ENABLED", logging);
    render(await AdminCallsPage({}));
    expect(tree()).toMatchSnapshot();
  });

  it("her drawer", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    vi.stubEnv("JUSTCALL_WEBHOOK_ENABLED", "");
    render(await AdminCallsPage({ searchParams: { openCall: AVA } }));
    expect(tree()).toMatchSnapshot();
  });
});

describe("/admin/calls — JustCall logging on (05a-2, plan §5 B7)", () => {
  it("logging off → the Unmatched list is never read (the snapshots above are today's tree)", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    vi.stubEnv("JUSTCALL_WEBHOOK_ENABLED", "");
    render(await AdminCallsPage({}));
    expect(h.unmatchedCalls).toEqual([]);
    expect(screen.queryByText(/Unmatched JustCall calls/)).toBeNull();
  });

  it("logging on, call booking off → 404, nothing read", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    vi.stubEnv("JUSTCALL_WEBHOOK_ENABLED", "true");
    await expect(AdminCallsPage({})).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.unmatchedCalls).toEqual([]);
  });

  it("logging on → the Unmatched list is read once with the admin's proof, alongside the rest, and shown in the Calls tab", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    vi.stubEnv("JUSTCALL_WEBHOOK_ENABLED", "true");
    render(await AdminCallsPage({}));
    expect(h.unmatchedCalls).toHaveLength(1);
    expect(h.unmatchedCalls[0]).toMatchObject({ kind: "admin_proof" });
    expect(screen.getByRole("heading", { level: 2, name: "Unmatched JustCall calls (1)" })).toBeInTheDocument();
    expect(screen.getByText("Calls still to make this week: 4 (2 booked · 2 not booked)")).toBeInTheDocument();
  });

  it("logging on, not an admin → 404 before the list is read", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    vi.stubEnv("JUSTCALL_WEBHOOK_ENABLED", "true");
    h.gate = { userId: "", error: "Not authorized — admin role required" };
    await expect(AdminCallsPage({})).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.unmatchedCalls).toEqual([]);
  });

  it("the Unmatched read failed → that section says so; the page stands", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    vi.stubEnv("JUSTCALL_WEBHOOK_ENABLED", "true");
    h.unmatched = { ok: false, error: "error" };
    render(await AdminCallsPage({}));
    expect(screen.getByRole("alert")).toHaveTextContent("The JustCall calls could not be read — reload to try again.");
    expect(screen.getByText("Calls still to make this week: 4 (2 booked · 2 not booked)")).toBeInTheDocument();
  });
});

describe("/admin/calls — the dialer switch (05b, plan D1, §9 row 1)", () => {
  const tree = () => document.body.innerHTML.replace(/:r[0-9a-z]+:/g, ":r:");

  it.each([
    ["unset", undefined],
    ["not the literal 'true'", "TRUE"],
  ])("dialer %s, logging off → today's tree exactly (the same as with the switch unset)", async (_label, dialer) => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    vi.stubEnv("JUSTCALL_WEBHOOK_ENABLED", "");
    vi.stubEnv("JUSTCALL_ENABLED", "");
    render(await AdminCallsPage({ searchParams: { openCall: AVA } }));
    const today = tree();
    cleanup();
    vi.stubEnv("JUSTCALL_ENABLED", dialer as string);
    render(await AdminCallsPage({ searchParams: { openCall: AVA } }));
    expect(tree()).toBe(today);
    expect(screen.queryByRole("button", { name: "Call next" })).toBeNull();
  });

  it("dialer on, logging off → the JustCall page with Call next; the Unmatched list never read or shown", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    vi.stubEnv("JUSTCALL_WEBHOOK_ENABLED", "");
    vi.stubEnv("JUSTCALL_ENABLED", "true");
    render(await AdminCallsPage({}));
    expect(screen.getByRole("button", { name: "Call next" })).toBeInTheDocument();
    expect(h.unmatchedCalls).toEqual([]);
    expect(screen.queryByText(/Unmatched JustCall calls/)).toBeNull();
    expect(screen.getByText("Calls still to make this week: 4 (2 booked · 2 not booked)")).toBeInTheDocument();
  });

  it("both on → Call next and the Unmatched list (read once)", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    vi.stubEnv("JUSTCALL_WEBHOOK_ENABLED", "true");
    vi.stubEnv("JUSTCALL_ENABLED", "true");
    render(await AdminCallsPage({}));
    expect(screen.getByRole("button", { name: "Call next" })).toBeInTheDocument();
    expect(h.unmatchedCalls).toHaveLength(1);
    expect(screen.getByRole("heading", { level: 2, name: "Unmatched JustCall calls (1)" })).toBeInTheDocument();
  });

  it("dialer on, call booking off → 404; not an admin → 404", async () => {
    vi.stubEnv("JUSTCALL_ENABLED", "true");
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    await expect(AdminCallsPage({})).rejects.toThrow("NEXT_NOT_FOUND");
    vi.stubEnv("CALL_BOOKING_ENABLED", "true");
    h.gate = { userId: "", error: "Not authorized — admin role required" };
    await expect(AdminCallsPage({})).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.dashboardCalls).toBe(0);
  });
});
