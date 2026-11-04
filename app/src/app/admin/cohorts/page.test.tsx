/**
 * /admin/cohorts server page (plan 02 step 8; brief §0.13, §8): the switch first — off → 404 before any admin check
 * or client — then the admin (not one → 404), then one board read. A failed read says so; it never renders empty.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const h = vi.hoisted(() => ({
  gate: { userId: "a0000000-0000-4000-8000-000000000031", error: null as string | null },
  gateCalls: 0,
  clients: 0,
  board: { ok: true, value: null } as { ok: boolean; value: unknown },
  boardCalls: 0,
}));
vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  useRouter: () => ({ refresh: vi.fn() }),
}));
vi.mock("@/lib/admin/require-admin", () => ({
  requireAdmin: async () => {
    h.gateCalls += 1;
    return h.gate;
  },
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    h.clients += 1;
    return {};
  },
}));
vi.mock("@/lib/cohorts/board", () => ({
  loadCohortBoard: async () => {
    h.boardCalls += 1;
    return h.board;
  },
}));
vi.mock("./actions", () => ({ saveCohortSchedule: vi.fn(), setCohortPlaces: vi.fn(), reopenCohortPlace: vi.fn() }));

import AdminCohortsPage from "./page";
import { makeBoard } from "./board-fixture.test-util";

beforeEach(() => {
  h.gate = { userId: "a0000000-0000-4000-8000-000000000031", error: null };
  h.gateCalls = 0;
  h.clients = 0;
  h.boardCalls = 0;
  h.board = { ok: true, value: makeBoard() };
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("/admin/cohorts", () => {
  it("flag unset → 404 before the admin check, a client or any read (brief §0.13)", async () => {
    vi.stubEnv("COHORTS_ENABLED", "");
    await expect(AdminCohortsPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.gateCalls).toBe(0);
    expect(h.clients).toBe(0);
    expect(h.boardCalls).toBe(0);
  });

  it("flag on, not an admin → 404, no client", async () => {
    vi.stubEnv("COHORTS_ENABLED", "true");
    h.gate = { userId: "", error: "Not authorized — admin role required" };
    await expect(AdminCohortsPage()).rejects.toThrow("NEXT_NOT_FOUND");
    expect(h.gateCalls).toBe(1);
    expect(h.clients).toBe(0);
  });

  it("flag on, admin → the empty state of §0.1", async () => {
    vi.stubEnv("COHORTS_ENABLED", "true");
    render(await AdminCohortsPage());
    expect(screen.getByRole("heading", { level: 1, name: "Cohorts" })).toBeInTheDocument();
    expect(screen.getByText("No cohorts yet. Set the first start date to begin.")).toBeInTheDocument();
    expect(h.boardCalls).toBe(1);
  });

  it("a failed read says so, never an empty page", async () => {
    vi.stubEnv("COHORTS_ENABLED", "true");
    h.board = { ok: false, value: null };
    render(await AdminCohortsPage());
    expect(screen.getByRole("alert")).toHaveTextContent("The cohorts could not be read — reload to try again.");
    expect(screen.queryByText(/No cohorts yet/)).toBeNull();
  });
});
