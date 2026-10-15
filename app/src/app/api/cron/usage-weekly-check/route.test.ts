/**
 * usage-weekly-check route (4e brief step 3; offer §7.4, SOP 16, card 7a). BB-LDN-4e-151026.
 * Raise only: one admin email + `usage.low` rows; nothing to parents or nannies, nothing in-app.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { USAGE_CHECK_WINDOW_DAYS, USAGE_LOW_THRESHOLD_PER_CHILD_PER_WEEK as T } from "@/config/offer";
import { fakeAdmin, writesTo, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";

const h = vi.hoisted(() => ({ fake: null as unknown as FakeAdmin, alert: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.fake.client }));
vi.mock("@/lib/email/usage-emails", () => ({ sendUsageLowAdminAlert: h.alert }));

import { GET } from "./route";

const req = (auth?: string) =>
  new NextRequest("http://localhost/api/cron/usage-weekly-check", {
    headers: auth ? { authorization: auth } : {},
  });
const AUTH = "Bearer test-secret";

function seed(over: Record<string, unknown> = {}) {
  return fakeAdmin({
    parent_subscriptions: [
      { parent_user_id: "p1", status: "placed", access_toggled_on: null },
      { parent_user_id: "p2", status: "trial", access_toggled_on: null },
      { parent_user_id: "p3", status: "deposit_paid", access_toggled_on: null },
      { parent_user_id: "p4", status: "placed", access_toggled_on: null },
    ],
    user_profiles: [
      { user_id: "p1", first_name: "Ann", last_name: "Lee", email: "ann@example.com", is_test_user: false },
      { user_id: "p2", first_name: "Bo", last_name: null, email: "bo@example.com", is_test_user: false },
      { user_id: "p4", first_name: "Tess", last_name: null, email: "t@example.com", is_test_user: true },
    ],
    activity_logs: [],
    child_client: [
      { id: "c1", parent_user_id: "p1", first_name: "Mila" },
      { id: "c2", parent_user_id: "p2", first_name: "Leo" },
      { id: "c4", parent_user_id: "p4", first_name: "Kit" },
    ],
    bapp_logs: Array.from({ length: T }, () => ({ child_client_id: "c2" })),
    ...over,
  });
}

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", "test-secret");
  h.fake = seed();
  h.alert.mockReset();
  h.alert.mockResolvedValue(undefined);
});
afterEach(() => vi.unstubAllEnvs());

const selectOn = (table: string) => h.fake.ops.find((o) => o.table === table && o.kind === "select")!;

describe("usage-weekly-check", () => {
  it("refuses without the cron bearer, and when CRON_SECRET is unset", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer wrong"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(req("Bearer "))).status).toBe(401);
    expect(h.fake.ops).toHaveLength(0);
    expect(h.alert).not.toHaveBeenCalled();
  });

  it("flags the family whose child is below the threshold: one email, one usage.low row", async () => {
    const res = await GET(req(AUTH));
    expect(await res.json()).toEqual({ ok: true, checked: 2, low: 1, skipped: 0 });
    expect(h.alert).toHaveBeenCalledTimes(1);
    const [families, days] = h.alert.mock.calls[0];
    expect(days).toBe(USAGE_CHECK_WINDOW_DAYS);
    expect(families).toEqual([
      expect.objectContaining({
        parentUserId: "p1",
        name: "Ann Lee",
        email: "ann@example.com",
        children: [{ childId: "c1", firstName: "Mila", posts: 0 }],
      }),
    ]);
    const rows = writesTo(h.fake, "activity_logs");
    expect(rows).toHaveLength(1);
    expect(rows[0].kind).toBe("insert");
    expect(rows[0].payload).toEqual([
      {
        user_id: "p1",
        action_type: "usage.low",
        action_details: expect.objectContaining({
          children: [{ child_client_id: "c1", first_name: "Mila", posts: 0 }],
          window_days: USAGE_CHECK_WINDOW_DAYS,
          threshold_per_child: T,
        }),
      },
    ]);
  });

  it("writes nothing anywhere but activity_logs (no parent/nanny surface)", async () => {
    await GET(req(AUTH));
    const tables = new Set(h.fake.ops.filter((o) => o.kind !== "select").map((o) => o.table));
    expect([...tables]).toEqual(["activity_logs"]);
  });

  it("counts only active posts inside the window, for the families' linked, open children", async () => {
    await GET(req(AUTH));
    const logs = selectOn("bapp_logs");
    expect(logs.filters).toEqual(
      expect.arrayContaining([
        ["eq", "is_active", true],
        ["gte", "created_at", expect.any(String)],
        ["in", "child_client_id", ["c1", "c2"]],
      ]),
    );
    const since = logs.filters.find((f) => f[0] === "gte")![2] as string;
    const ageDays = (Date.now() - Date.parse(since)) / 86_400_000;
    expect(Math.round(ageDays)).toBe(USAGE_CHECK_WINDOW_DAYS);
    expect(selectOn("child_client").filters).toContainEqual(["neq", "status", "closed"]);
  });

  it("skips a family already stamped usage.low this week — no second email", async () => {
    h.fake = seed({ activity_logs: [{ user_id: "p1" }] });
    const res = await GET(req(AUTH));
    expect(await res.json()).toEqual({ ok: true, checked: 2, low: 0, skipped: 1 });
    expect(h.alert).not.toHaveBeenCalled();
    expect(writesTo(h.fake, "activity_logs")).toHaveLength(0);
    const recent = selectOn("activity_logs");
    expect(recent.filters).toEqual(
      expect.arrayContaining([["eq", "action_type", "usage.low"], ["gte", "created_at", expect.any(String)]]),
    );
  });

  it("no low family → no email, no row", async () => {
    h.fake = seed({ bapp_logs: [...Array.from({ length: T }, () => ({ child_client_id: "c1" })), ...Array.from({ length: T }, () => ({ child_client_id: "c2" }))] });
    const res = await GET(req(AUTH));
    expect(await res.json()).toEqual({ ok: true, checked: 2, low: 0, skipped: 0 });
    expect(h.alert).not.toHaveBeenCalled();
    expect(writesTo(h.fake, "activity_logs")).toHaveLength(0);
  });

  it("the email goes first: a failed send stamps nothing and answers 500", async () => {
    h.alert.mockRejectedValue(new Error("down"));
    const res = await GET(req(AUTH));
    expect(res.status).toBe(500);
    expect(writesTo(h.fake, "activity_logs")).toHaveLength(0);
  });

  it("no family with access → ok, nothing read further", async () => {
    h.fake = seed({ parent_subscriptions: [{ parent_user_id: "p3", status: "lapsed", access_toggled_on: null }] });
    const res = await GET(req(AUTH));
    expect(await res.json()).toEqual({ ok: true, checked: 0, low: 0, skipped: 0 });
    expect(h.fake.ops.map((o) => o.table)).toEqual(["parent_subscriptions"]);
  });
});
