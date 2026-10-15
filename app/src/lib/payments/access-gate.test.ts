/**
 * The family access gate — the full state table (4c, brief step 2; B6, ADR-093/097).
 *
 * Every subscription status × admin toggle (null / true / false) × test user, against the order
 * test user → toggle (not null wins) → `placed` → Sydney's clauses. Mirrors `family_has_access()`
 * after amendment 12. BB-LDN-4c-151026.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  profile: null as { is_test_user: boolean } | null,
  sub: null as Record<string, unknown> | null,
  child: null as { parent_user_id: string | null } | null,
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () => ({
            data:
              table === "user_profiles"
                ? db.profile
                : table === "parent_subscriptions"
                  ? db.sub
                  : db.child,
            error: null,
          }),
        }),
      }),
    }),
  }),
}));

import {
  hasFamilyAccess,
  requireChildFamilyAccess,
  requireFamilyAccess,
  type AccessGateReason,
} from "./access-gate";

const FUTURE = new Date(Date.now() + 86_400_000).toISOString();
const PAST = new Date(Date.now() - 86_400_000).toISOString();

type Toggle = boolean | null;
const STATUSES = [
  "trial",
  "active_monthly",
  "active_upfront",
  "past_due",
  "cancelled",
  "lapsed",
  "deposit_paid",
  "placed",
] as const;

/** Sydney's verdict for a status whose clock is live (FUTURE) — the toggle-null, non-test-user column. */
const LIVE: Record<(typeof STATUSES)[number], AccessGateReason> = {
  trial: "ok",
  active_monthly: "ok",
  active_upfront: "ok",
  past_due: "ok",
  cancelled: "ok",
  lapsed: "subscription_lapsed",
  deposit_paid: "awaiting_placement",
  placed: "ok",
};

/** …and when its clock has run out (PAST). */
const ENDED: Record<(typeof STATUSES)[number], AccessGateReason> = {
  trial: "trial_expired",
  active_monthly: "subscription_lapsed",
  active_upfront: "subscription_lapsed",
  past_due: "past_due_grace_expired",
  cancelled: "subscription_cancelled_window_ended",
  lapsed: "subscription_lapsed",
  deposit_paid: "awaiting_placement",
  placed: "ok",
};

function row(status: string, clock: string, toggle: Toggle) {
  return {
    status,
    trial_ends_at: clock,
    paid_period_ends_at: clock,
    past_due_grace_ends_at: clock,
    access_toggled_on: toggle,
  };
}

beforeEach(() => {
  db.profile = { is_test_user: false };
  db.sub = null;
  db.child = null;
});

describe("requireFamilyAccess — state table", () => {
  for (const status of STATUSES) {
    for (const [clockName, clock, table] of [
      ["live", FUTURE, LIVE],
      ["ended", PAST, ENDED],
    ] as const) {
      it(`${status} (${clockName} clock), toggle null → ${table[status]}`, async () => {
        db.sub = row(status, clock, null);
        const res = await requireFamilyAccess("p1");
        expect(res.reason).toBe(table[status]);
        expect(res.hasAccess).toBe(table[status] === "ok");
      });

      it(`${status} (${clockName} clock), toggle on → ok`, async () => {
        db.sub = row(status, clock, true);
        expect(await requireFamilyAccess("p1")).toEqual({ hasAccess: true, reason: "ok" });
      });

      it(`${status} (${clockName} clock), toggle off → access_off_by_admin`, async () => {
        db.sub = row(status, clock, false);
        expect(await requireFamilyAccess("p1")).toEqual({
          hasAccess: false,
          reason: "access_off_by_admin",
        });
      });

      for (const toggle of [null, true, false] as const) {
        it(`${status} (${clockName} clock), toggle ${String(toggle)}, test user → ok`, async () => {
          db.profile = { is_test_user: true };
          db.sub = row(status, clock, toggle);
          expect(await requireFamilyAccess("p1")).toEqual({ hasAccess: true, reason: "ok" });
        });
      }
    }
  }

  it("no subscription row → no_subscription", async () => {
    expect(await requireFamilyAccess("p1")).toEqual({ hasAccess: false, reason: "no_subscription" });
  });

  it("empty parent id → no_subscription without a read", async () => {
    expect(await requireFamilyAccess("")).toEqual({ hasAccess: false, reason: "no_subscription" });
  });

  it("deposit paid opens no access (ADR-097)", async () => {
    db.sub = row("deposit_paid", FUTURE, null);
    expect(await hasFamilyAccess("p1")).toBe(false);
  });

  it("placed opens access with no clock at all (ADR-093)", async () => {
    db.sub = { status: "placed", access_toggled_on: null };
    expect(await hasFamilyAccess("p1")).toBe(true);
  });
});

describe("requireChildFamilyAccess", () => {
  it("resolves the parent and applies the toggle", async () => {
    db.child = { parent_user_id: "p1" };
    db.sub = row("placed", FUTURE, false);
    expect((await requireChildFamilyAccess("c1")).reason).toBe("access_off_by_admin");
  });

  it("a nanny-only child stays ungated", async () => {
    db.child = { parent_user_id: null };
    expect(await requireChildFamilyAccess("c1")).toEqual({ hasAccess: true, reason: "ok" });
  });
});
