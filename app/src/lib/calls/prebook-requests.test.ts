/**
 * 04's pending cohort pre-book requests, wired to brief 03 (04 plan §7, §12 R10; plan 03 §8, row A8, D9). While the
 * deposit switch is off, no family has one: an empty map, and no client is even created. On, it is 03's reader over
 * its open pre-bookings with no booking and no call logged since. A failed read rejects, which 04's `to-call.ts`
 * turns into its error path.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const supabase = vi.hoisted(() => ({ created: 0, client: null as unknown }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    supabase.created += 1;
    if (supabase.client === null) throw new Error("Missing Supabase admin credentials");
    return supabase.client;
  },
}));

import { fakeAdmin, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";
import { readPendingPrebookRequests } from "./prebook-requests";

const PARENT = "b0400000-0000-4000-8000-000000000001";
const CALLED = "b0400000-0000-4000-8000-000000000002";

let fake: FakeAdmin;
beforeEach(() => {
  fake = fakeAdmin({
    deposit_prebookings: [
      { parent_user_id: PARENT, cohort_start_date: "2027-02-08", created_at: "2027-02-03T10:00:00+00:00" },
      { parent_user_id: CALLED, cohort_start_date: "2027-02-08", created_at: "2027-02-03T10:00:00+00:00" },
    ],
    call_log_entries: [{ parent_user_id: CALLED, occurred_at: "2027-02-03T11:00:00+00:00" }],
  });
  supabase.client = fake.client;
  supabase.created = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const on = () => {
  vi.stubEnv("DEPOSIT_LINK_ENABLED", "true");
  vi.stubEnv("COHORTS_ENABLED", "true");
};

describe("readPendingPrebookRequests — the deposit switch off", () => {
  it.each([
    ["unset", "", "true"],
    ["set but cohorts off", "true", ""],
  ])("%s → an empty map for any families, with no client created", async (_label, deposit, cohorts) => {
    vi.stubEnv("DEPOSIT_LINK_ENABLED", deposit);
    vi.stubEnv("COHORTS_ENABLED", cohorts);
    const requests = await readPendingPrebookRequests([PARENT]);
    expect(requests.size).toBe(0);
    expect(supabase.created).toBe(0);
    expect(fake.ops).toHaveLength(0);
  });
});

describe("readPendingPrebookRequests — the deposit switch on (03's reader)", () => {
  it("a family with an open pre-booking and no call since has a request for that cohort's day", async () => {
    on();
    const requests = await readPendingPrebookRequests([PARENT, CALLED]);
    expect([...requests.entries()]).toEqual([[PARENT, { londonDate: "2027-02-08" }]]);
    expect(supabase.created).toBe(1);
    expect(fake.ops.map((o) => o.table)).toEqual(["deposit_prebookings", "call_log_entries"]);
  });

  it("no families → an empty map with no read", async () => {
    on();
    expect((await readPendingPrebookRequests([])).size).toBe(0);
    expect(fake.ops).toHaveLength(0);
  });

  it("a failed read rejects (04's error path)", async () => {
    on();
    fake.readErrors.deposit_prebookings = { message: "boom", code: "XX000" };
    await expect(readPendingPrebookRequests([PARENT])).rejects.toThrow("[deposit] pending pre-book requests could not be read");
  });

  it("no admin client (missing credentials) rejects too, never a silent empty map", async () => {
    on();
    supabase.client = null;
    await expect(readPendingPrebookRequests([PARENT])).rejects.toThrow();
  });
});
