/**
 * /admin/cohorts server actions (plan 02 step 7; brief §3.1, §3.5, §3.7, §3.9–3.10). Each checks the switch first,
 * then the admin (before any read or client), validates, calls one place operation, then revalidates the page.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { FakeAdmin } from "@/lib/payments/fake-admin.test-util";

const h = vi.hoisted(() => ({
  gate: { userId: "a0000000-0000-4000-8000-000000000031", error: null as string | null },
  gateCalls: 0,
  clients: 0,
  fake: null as FakeAdmin | null,
  revalidated: [] as string[],
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
    return h.fake!.client;
  },
}));
vi.mock("next/cache", () => ({ revalidatePath: (p: string) => h.revalidated.push(p) }));

import { fakeAdmin } from "@/lib/payments/fake-admin.test-util";
import { reopenCohortPlace, saveCohortSchedule, setCohortPlaces } from "./actions";

const PLACE = "c0200000-0000-4000-8000-000000000001";
const SCHEDULE = { firstStartDate: "2027-02-01", repeatWeeks: "1", defaultPlaces: "5" };

beforeEach(() => {
  vi.stubEnv("COHORTS_ENABLED", "true");
  vi.spyOn(console, "error").mockImplementation(() => {});
  h.gate = { userId: "a0000000-0000-4000-8000-000000000031", error: null };
  h.gateCalls = 0;
  h.clients = 0;
  h.revalidated = [];
  h.fake = fakeAdmin();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("every action: the switch, then the admin, before anything is read", () => {
  it.each([
    ["saveCohortSchedule", () => saveCohortSchedule(SCHEDULE)],
    ["setCohortPlaces", () => setCohortPlaces({ startDate: "2027-02-01", places: "7" })],
    ["reopenCohortPlace", () => reopenCohortPlace({ placeId: PLACE, reason: "moved abroad" })],
  ])("%s: off → cohorts_disabled, no admin check, no client", async (_name, act) => {
    vi.stubEnv("COHORTS_ENABLED", "");
    expect(await act()).toEqual({ ok: false, error: "cohorts_disabled", message: "Cohorts are switched off." });
    expect(h.gateCalls).toBe(0);
    expect(h.clients).toBe(0);
  });

  it.each([
    ["saveCohortSchedule", () => saveCohortSchedule(SCHEDULE)],
    ["setCohortPlaces", () => setCohortPlaces({ startDate: "2027-02-01", places: "7" })],
    ["reopenCohortPlace", () => reopenCohortPlace({ placeId: PLACE, reason: "moved abroad" })],
  ])("%s: not an admin → not_authorized, no client", async (_name, act) => {
    h.gate = { userId: "", error: "Not authorized — admin role required" };
    expect(await act()).toEqual({ ok: false, error: "not_authorized", message: "Admins only." });
    expect(h.clients).toBe(0);
  });
});

describe("saveCohortSchedule (brief §0.2)", () => {
  it("a good schedule: one save with the admin as actor, then the page is revalidated", async () => {
    h.fake!.rpcResults.cohort_save_schedule = { data: { status: "saved" }, error: null };
    expect(await saveCohortSchedule(SCHEDULE)).toEqual({ ok: true });
    expect(h.fake!.rpcCalls).toEqual([
      { fn: "cohort_save_schedule", args: { p_first: "2027-02-01", p_repeat_weeks: 1, p_places: 5, p_actor: "a0000000-0000-4000-8000-000000000031" } },
    ]);
    expect(h.revalidated).toEqual(["/admin/cohorts"]);
  });

  it("a bad one is refused with its message and nothing is written", async () => {
    expect(await saveCohortSchedule({ ...SCHEDULE, defaultPlaces: "100" })).toEqual({
      ok: false, error: "invalid_places", message: "Places must be a whole number from 0 to 99.",
    });
    expect(h.fake!.rpcCalls).toHaveLength(0);
    expect(h.revalidated).toEqual([]);
  });

  it("a failed save says so", async () => {
    h.fake!.rpcResults.cohort_save_schedule = { data: null, error: { message: "x", code: "57014" } };
    expect(await saveCohortSchedule(SCHEDULE)).toEqual({ ok: false, error: "save_failed", message: "That didn't save — try again." });
  });
});

describe("setCohortPlaces (brief §0.4)", () => {
  it("5 → 7: saved, 4 left", async () => {
    h.fake!.rpcResults.cohort_set_places = { data: { status: "updated", places: 7, left: 4 }, error: null };
    expect(await setCohortPlaces({ startDate: "2027-02-01", places: "7" })).toEqual({ ok: true });
    expect(h.fake!.rpcCalls[0].args).toEqual({ p_start: "2027-02-01", p_places: 7, p_actor: "a0000000-0000-4000-8000-000000000031" });
    expect(h.revalidated).toEqual(["/admin/cohorts"]);
  });

  it("→ 2 with 3 taken: the exact refusal, and the value stays (no revalidate)", async () => {
    h.fake!.rpcResults.cohort_set_places = { data: { status: "below_taken", taken_or_held: 3, places: 7 }, error: null };
    expect(await setCohortPlaces({ startDate: "2027-02-01", places: "2" })).toEqual({
      ok: false, error: "below_taken", message: "3 places are already taken or being paid for. Set at least 3.",
    });
    expect(h.revalidated).toEqual([]);
  });

  it("not a whole number 0–99, or not a date: refused before the database", async () => {
    expect(await setCohortPlaces({ startDate: "2027-02-01", places: "2.5" })).toMatchObject({ ok: false, error: "invalid_places" });
    expect(await setCohortPlaces({ startDate: "1 Feb", places: "2" })).toMatchObject({ ok: false, error: "invalid" });
    expect(await setCohortPlaces(null)).toMatchObject({ ok: false, error: "invalid" });
    expect(h.fake!.rpcCalls).toHaveLength(0);
  });

  it("a past cohort is read-only", async () => {
    h.fake!.rpcResults.cohort_set_places = { data: { status: "past_cohort" }, error: null };
    expect(await setCohortPlaces({ startDate: "2027-01-25", places: "6" })).toEqual({ ok: false, error: "past_cohort", message: "A past cohort can't be changed." });
  });
});

describe("reopenCohortPlace (brief §0.8, §3.7)", () => {
  it("re-opens with the reason", async () => {
    h.fake!.rpcResults.cohort_reopen_place = { data: { status: "reopened" }, error: null };
    expect(await reopenCohortPlace({ placeId: PLACE, reason: "moved abroad" })).toEqual({ ok: true });
    expect(h.fake!.rpcCalls[0].args).toEqual({ p_place_id: PLACE, p_actor: "a0000000-0000-4000-8000-000000000031", p_reason: "moved abroad" });
  });

  it("a reason of 2 characters is refused with the rule", async () => {
    expect(await reopenCohortPlace({ placeId: PLACE, reason: "ab" })).toEqual({
      ok: false, error: "invalid_reason", message: "A short reason is required (3 to 500 characters).",
    });
    expect(h.fake!.rpcCalls).toHaveLength(0);
  });

  it("a second click: 'Already re-opened', a no-op", async () => {
    h.fake!.rpcResults.cohort_reopen_place = { data: { status: "already_reopened" }, error: null };
    expect(await reopenCohortPlace({ placeId: PLACE, reason: "moved abroad" })).toEqual({ ok: true, message: "Already re-opened" });
  });

  it("not a place id → invalid; a database refusal has its message", async () => {
    expect(await reopenCohortPlace({ placeId: "nope", reason: "moved abroad" })).toMatchObject({ ok: false, error: "invalid" });
    h.fake!.rpcResults.cohort_reopen_place = { data: { status: "not_taken" }, error: null };
    expect(await reopenCohortPlace({ placeId: PLACE, reason: "moved abroad" })).toEqual({
      ok: false, error: "not_taken", message: "Only a taken place can be re-opened.",
    });
  });

  it("a client that can't be made is save_failed, never a throw", async () => {
    h.fake = null;
    expect(await reopenCohortPlace({ placeId: PLACE, reason: "moved abroad" })).toEqual({ ok: false, error: "save_failed", message: "That didn't save — try again." });
  });
});
