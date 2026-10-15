/**
 * dfy-access — openDfyAccess (N7, N8; idempotent per placement), isDfyFamily (trial guard, ADR-093),
 * balanceAfterWeek1Pence (ADR-094/097/100). BB-LDN-4c-151026.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PRICES } from "@/config/prices";
import { BILL_AFTER_START_DAYS, FIRST_WEEK_DISCOUNT_CAP, G2 } from "@/config/offer";
import { balanceAfterWeek1Pence, isDfyFamily, openDfyAccess } from "./dfy-access";
import { fakeAdmin, writesTo } from "./fake-admin.test-util";

const PLACEMENT = "22222222-2222-4222-8222-222222222222";
const PARENT_USER = "11111111-1111-4111-8111-111111111111";
const DAY = 86_400_000;
const FUTURE = new Date(Date.now() + DAY).toISOString();
const PAST = new Date(Date.now() - DAY).toISOString();

function reads(sub: Record<string, unknown> | null, start: string | null = "2026-11-02") {
  return {
    nanny_placements: { id: PLACEMENT, parent_id: "parent-row", start_date: start, hired_at: "2026-10-20T10:00:00Z" },
    parents: { user_id: PARENT_USER },
    parent_subscriptions: sub,
  };
}

beforeEach(() => vi.spyOn(console, "error").mockImplementation(() => {}));
afterEach(() => vi.restoreAllMocks());

describe("openDfyAccess", () => {
  it("no row → inserts dfy / placed with due date start + BILL_AFTER_START_DAYS and window start + G2", async () => {
    const f = fakeAdmin(reads(null));
    expect(await openDfyAccess(f.client, PLACEMENT)).toBe("opened");
    const [ins] = writesTo(f, "parent_subscriptions");
    expect(ins.kind).toBe("insert");
    const start = Date.parse("2026-11-02T00:00:00Z");
    expect(ins.payload).toMatchObject({
      parent_user_id: PARENT_USER,
      family_type: "dfy",
      status: "placed",
      placement_id: PLACEMENT,
      payment_due_at: new Date(start + BILL_AFTER_START_DAYS * DAY).toISOString(),
      satisfaction_window_ends_at: new Date(start + G2.windowDays * DAY).toISOString(),
    });
    expect(writesTo(f, "activity_logs")[0].payload).toMatchObject({
      user_id: PARENT_USER,
      action_type: "dfy_access.opened",
    });
  });

  it("deposit_paid row → updated to placed", async () => {
    const f = fakeAdmin(reads({ id: "s1", status: "deposit_paid", family_type: "dfy", placement_id: null }));
    expect(await openDfyAccess(f.client, PLACEMENT)).toBe("opened");
    const [up] = writesTo(f, "parent_subscriptions");
    expect(up.kind).toBe("update");
    expect(up.payload).toMatchObject({ status: "placed", placement_id: PLACEMENT });
    expect(up.filters).toContainEqual(["eq", "id", "s1"]);
  });

  it("no start date → the hire time is the start", async () => {
    const f = fakeAdmin(reads(null, null));
    await openDfyAccess(f.client, PLACEMENT);
    const start = Date.parse("2026-10-20T10:00:00Z");
    expect(writesTo(f, "parent_subscriptions")[0].payload).toMatchObject({
      payment_due_at: new Date(start + BILL_AFTER_START_DAYS * DAY).toISOString(),
    });
  });

  it.each([
    ["trial", { trial_ends_at: FUTURE }],
    ["active_monthly", { paid_period_ends_at: FUTURE }],
    ["active_upfront", { paid_period_ends_at: FUTURE }],
    ["past_due", { past_due_grace_ends_at: FUTURE }],
    ["cancelled", { paid_period_ends_at: FUTURE }],
  ])("self-serve with a live %s → no change, logs dfy_access.skipped_self_serve", async (status, clocks) => {
    const f = fakeAdmin(reads({ id: "s1", status, family_type: "self_serve", placement_id: null, ...clocks }));
    expect(await openDfyAccess(f.client, PLACEMENT)).toBe("skipped_self_serve");
    expect(writesTo(f, "parent_subscriptions")).toHaveLength(0);
    expect(writesTo(f, "activity_logs")[0].payload).toMatchObject({ action_type: "dfy_access.skipped_self_serve" });
  });

  it("self-serve whose trial has ended → becomes dfy / placed", async () => {
    const f = fakeAdmin(reads({ id: "s1", status: "trial", family_type: "self_serve", placement_id: null, trial_ends_at: PAST }));
    expect(await openDfyAccess(f.client, PLACEMENT)).toBe("opened");
    expect(writesTo(f, "parent_subscriptions")[0].payload).toMatchObject({ family_type: "dfy", status: "placed" });
  });

  it("same placement again → no-op", async () => {
    const f = fakeAdmin(reads({ id: "s1", status: "placed", family_type: "dfy", placement_id: PLACEMENT }));
    expect(await openDfyAccess(f.client, PLACEMENT)).toBe("already_open");
    expect(f.ops.filter((o) => o.kind !== "select")).toHaveLength(0);
  });

  it("a write failure is logged and returned, never thrown (the placement stands)", async () => {
    const f = fakeAdmin(reads(null));
    f.writeErrors.parent_subscriptions = { message: "boom" };
    await expect(openDfyAccess(f.client, PLACEMENT)).resolves.toBe("failed");
    expect(console.error).toHaveBeenCalled();
  });

  it("an unknown placement → failed, nothing written", async () => {
    const f = fakeAdmin({ nanny_placements: null });
    expect(await openDfyAccess(f.client, PLACEMENT)).toBe("failed");
    expect(f.ops.filter((o) => o.kind !== "select")).toHaveLength(0);
  });
});

describe("isDfyFamily", () => {
  it.each([
    [{ family_type: "dfy", status: "lapsed" }, true],
    [{ family_type: "self_serve", status: "deposit_paid" }, true],
    [{ family_type: "self_serve", status: "placed" }, true],
    [{ family_type: "self_serve", status: "trial" }, false],
    [null, false],
  ])("%j → %s", async (row, expected) => {
    const f = fakeAdmin({ parent_subscriptions: row });
    expect(await isDfyFamily(f.client, PARENT_USER)).toBe(expected);
  });
});

describe("balanceAfterWeek1Pence", () => {
  const cap = FIRST_WEEK_DISCOUNT_CAP.hourlyPence * FIRST_WEEK_DISCOUNT_CAP.maxHours;

  it("fee − deposit − wages (walk step 4: wages 30000 → fee − deposit − 30000)", () => {
    expect(balanceAfterWeek1Pence({ depositPaid: true, firstWeekWagesPence: 30_000 })).toBe(
      PRICES.dfy.feePence - PRICES.dfy.depositPence - 30_000,
    );
    expect(balanceAfterWeek1Pence({ depositPaid: true, firstWeekWagesPence: 30_000 })).toBe(105_000);
  });

  it("no deposit paid → nothing credited", () => {
    expect(balanceAfterWeek1Pence({ depositPaid: false, firstWeekWagesPence: 0 })).toBe(PRICES.dfy.feePence);
  });

  it("wages above the cap are capped (ADR-100)", () => {
    expect(balanceAfterWeek1Pence({ depositPaid: true, firstWeekWagesPence: cap + 50_000 })).toBe(
      PRICES.dfy.feePence - PRICES.dfy.depositPence - cap,
    );
  });

  it("never below zero; rejects a negative or fractional wage", () => {
    expect(balanceAfterWeek1Pence({ depositPaid: true, firstWeekWagesPence: cap })).toBeGreaterThanOrEqual(0);
    expect(() => balanceAfterWeek1Pence({ depositPaid: true, firstWeekWagesPence: -1 })).toThrow();
    expect(() => balanceAfterWeek1Pence({ depositPaid: true, firstWeekWagesPence: 1.5 })).toThrow();
  });
});

describe("wagesPenceFromSnapshot", () => {
  it("hours × pounds-per-hour → pence (numeric strings from PostgREST too)", async () => {
    const { wagesPenceFromSnapshot } = await import("./dfy-access");
    expect(wagesPenceFromSnapshot(20, 16)).toBe(32_000);
    expect(wagesPenceFromSnapshot("37.5", "15.50")).toBe(58_125);
    expect(wagesPenceFromSnapshot(null, 16)).toBeNull();
    expect(wagesPenceFromSnapshot(20, "abc")).toBeNull();
    expect(wagesPenceFromSnapshot(0, 16)).toBeNull();
  });
});
