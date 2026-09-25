/**
 * cancelSubscription server action — unit tests (S9).
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const state = vi.hoisted(() => ({
  authUser: { id: "parent-uuid" } as { id: string } | null,
  paymentsEnabled: true,
  subRow: null as null | {
    id: string;
    status: string;
    stripe_subscription_id: string | null;
    paid_period_ends_at: string | null;
  },
  stripeUpdateCalls: [] as Array<{ subId: string; args: unknown }>,
  stripeUpdateThrows: false,
  dbUpdateCalls: [] as Array<{
    table: string;
    payload: Record<string, unknown>;
  }>,
  dbUpdateError: null as null | { message: string },
  activityLogInserts: [] as Record<string, unknown>[],
  // T-018 — cancelInFlightCommission call tracking. (Supersedes
  // T-016's freezeInFlightCommissionForSubscription.) The parent
  // self-serve cancel path must invoke this so in-flight commission
  // rows don't survive a cancel+resub cycle.
  cancelCalls: [] as Array<{ subId: string; reason: string }>,
  cancelResult: { cancelled: 1 } as { cancelled: number },
  cancelThrows: false,
}));

beforeEach(() => {
  state.authUser = { id: "parent-uuid" };
  state.paymentsEnabled = true;
  state.subRow = {
    id: "sub-row-1",
    status: "active_monthly",
    stripe_subscription_id: "sub_stripe_1",
    paid_period_ends_at: "2026-06-15T00:00:00+01:00",
  };
  state.stripeUpdateCalls = [];
  state.stripeUpdateThrows = false;
  state.dbUpdateCalls = [];
  state.dbUpdateError = null;
  state.activityLogInserts = [];
  state.cancelCalls = [];
  state.cancelResult = { cancelled: 1 };
  state.cancelThrows = false;
  vi.clearAllMocks();
});

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: {
      getUser: async () => ({
        data: { user: state.authUser },
        error: state.authUser ? null : new Error("unauth"),
      }),
    },
  }),
}));

vi.mock("@/lib/payments/flags", () => ({
  PAYMENTS_ENABLED: true,
  get isPaymentsEnabled() {
    return state.paymentsEnabled;
  },
}));

vi.mock("@/lib/supabase/admin", () => ({
  /* eslint-disable @typescript-eslint/no-explicit-any */
  createAdminClient: () => ({
    from: (table: string) => {
      if (table === "parent_subscriptions") {
        return {
          select: () => ({
            eq: () => ({
              maybeSingle: async () => ({
                data: state.subRow,
                error: state.subRow ? null : new Error("not found"),
              }),
            }),
          }),
          update: (payload: Record<string, unknown>) => ({
            eq: async () => {
              state.dbUpdateCalls.push({ table, payload });
              return { data: null, error: state.dbUpdateError };
            },
          }),
        };
      }
      if (table === "activity_logs") {
        return {
          insert: async (row: Record<string, unknown>) => {
            state.activityLogInserts.push(row);
            return { data: null, error: null };
          },
        };
      }
      return { from: () => ({}) } as any;
    },
  }),
  /* eslint-enable @typescript-eslint/no-explicit-any */
}));

vi.mock("@/lib/stripe/client", () => ({
  getStripeClient: () => ({
    subscriptions: {
      update: async (subId: string, args: unknown) => {
        if (state.stripeUpdateThrows) throw new Error("stripe failure");
        state.stripeUpdateCalls.push({ subId, args });
        return { id: subId };
      },
    },
  }),
}));

vi.mock("@/lib/payments/commission-cancel", () => ({
  cancelInFlightCommission: async (subId: string, reason: string) => {
    if (state.cancelThrows) throw new Error("cancel failure");
    state.cancelCalls.push({ subId, reason });
    return state.cancelResult;
  },
}));

import { cancelSubscription } from "./cancelSubscription";

describe("cancelSubscription", () => {
  it("rejects when unauth'd", async () => {
    state.authUser = null;
    const r = await cancelSubscription({ reason: "other" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("not_authenticated");
  });

  it("rejects invalid reasons", async () => {
    const r = await cancelSubscription({
      // @ts-expect-error — testing runtime guard
      reason: "made_up_reason",
    });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("invalid_reason");
  });

  it("returns no_subscription when row missing", async () => {
    state.subRow = null;
    const r = await cancelSubscription({ reason: "other" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("no_subscription");
  });

  it("monthly active: calls Stripe with cancel_at_period_end + flips DB to cancelled", async () => {
    const r = await cancelSubscription({
      reason: "too_expensive",
      reasonText: "rent went up",
    });
    expect(r.success).toBe(true);
    if (r.success)
      expect(r.data.paidPeriodEndsAt).toBe("2026-06-15T00:00:00+01:00");
    expect(state.stripeUpdateCalls).toHaveLength(1);
    expect(state.stripeUpdateCalls[0]?.subId).toBe("sub_stripe_1");
    expect(state.stripeUpdateCalls[0]?.args).toMatchObject({
      cancel_at_period_end: true,
      metadata: { cancellation_reason: "too_expensive" },
    });
    expect(state.dbUpdateCalls[0]?.payload).toMatchObject({
      status: "cancelled",
      cancellation_reason: "too_expensive",
      cancellation_reason_text: "rent went up",
    });
    const cancelLog = state.activityLogInserts.find(
      (row) => row.action_type === "subscription_cancelled",
    );
    expect(cancelLog).toBeDefined();
    expect(cancelLog).toMatchObject({
      action_type: "subscription_cancelled",
    });
  });

  it("upfront active: skips Stripe, still flips DB + captures reason", async () => {
    state.subRow!.status = "active_upfront";
    state.subRow!.stripe_subscription_id = null;
    const r = await cancelSubscription({ reason: "circumstances_changed" });
    expect(r.success).toBe(true);
    expect(state.stripeUpdateCalls).toHaveLength(0);
    expect(state.dbUpdateCalls[0]?.payload).toMatchObject({
      status: "cancelled",
      cancellation_reason: "circumstances_changed",
    });
  });

  it("monthly with missing stripe_subscription_id returns error", async () => {
    state.subRow!.stripe_subscription_id = null;
    const r = await cancelSubscription({ reason: "other" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("no_stripe_sub_id");
  });

  it("already cancelled / lapsed: returns success no-op + captures reason for product learning", async () => {
    state.subRow!.status = "cancelled";
    const r = await cancelSubscription({ reason: "not_using" });
    expect(r.success).toBe(true);
    expect(state.stripeUpdateCalls).toHaveLength(0);
    // Reason still saved
    expect(state.dbUpdateCalls[0]?.payload).toMatchObject({
      cancellation_reason: "not_using",
    });
    // No status flip
    expect(state.dbUpdateCalls[0]?.payload).not.toHaveProperty("status");
  });

  it("Stripe update failure → stripe_update_failed", async () => {
    state.stripeUpdateThrows = true;
    const r = await cancelSubscription({ reason: "service_issue" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("stripe_update_failed");
  });

  it("reasonText is trimmed + capped at 500 chars", async () => {
    const long = "a".repeat(600);
    await cancelSubscription({ reason: "other", reasonText: long });
    const saved = state.dbUpdateCalls[0]?.payload.cancellation_reason_text;
    expect(typeof saved).toBe("string");
    expect((saved as string).length).toBe(500);
  });

  it("empty reasonText stored as null", async () => {
    await cancelSubscription({ reason: "other", reasonText: "   " });
    expect(state.dbUpdateCalls[0]?.payload.cancellation_reason_text).toBeNull();
  });

  it("active-branch DB UPDATE failure → db_update_failed (was unchecked before C6)", async () => {
    state.dbUpdateError = { message: "rls_denied" };
    const r = await cancelSubscription({ reason: "other" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("db_update_failed");
  });

  it("no-op-branch (cancelled): DB UPDATE failure now surfaces failure — silent before C6", async () => {
    state.subRow!.status = "cancelled";
    state.dbUpdateError = { message: "rls_denied" };
    const r = await cancelSubscription({ reason: "other" });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error).toBe("db_update_failed");
  });

  it("no-op-branch (lapsed): DB UPDATE success still returns success + captures reason", async () => {
    state.subRow!.status = "lapsed";
    const r = await cancelSubscription({ reason: "not_using" });
    expect(r.success).toBe(true);
    expect(state.dbUpdateCalls[0]?.payload).toMatchObject({
      cancellation_reason: "not_using",
    });
    // Status NOT touched in no-op branch
    expect(state.dbUpdateCalls[0]?.payload).not.toHaveProperty("status");
  });

  // ---------------------------------------------------------------------
  // T-018 regression — cancel in-flight commission rows.
  //
  // Bug 2026-05-14: parent self-serve cancel flipped status='cancelled'
  // but did NOT call cancelInFlightCommission. If the
  // parent resubscribed before period-end (Stripe's
  // customer.subscription.deleted hadn't fired yet), the new commission
  // row was created alongside the prior `held`/`pending` row →
  // dashboard summed $200 for one family. Each cancel+resub stacked
  // another $100.
  //
  // Spec: `system/APP/PAYMENTS/06-commission-system.md` §1.5 stage 5.
  // Webhook handler `handleSubscriptionDeleted` already implements the
  // same cancel pattern — this brings the self-serve path to parity.
  // ---------------------------------------------------------------------

  it("monthly active: cancels in-flight commission rows with reason='parent_cancelled' (T-018)", async () => {
    const r = await cancelSubscription({ reason: "too_expensive" });
    expect(r.success).toBe(true);
    expect(state.cancelCalls).toHaveLength(1);
    expect(state.cancelCalls[0]).toEqual({
      subId: "sub-row-1",
      reason: "parent_cancelled",
    });
  });

  it("upfront active: cancels in-flight commission rows (T-018)", async () => {
    state.subRow!.status = "active_upfront";
    state.subRow!.stripe_subscription_id = null;
    const r = await cancelSubscription({ reason: "circumstances_changed" });
    expect(r.success).toBe(true);
    expect(state.cancelCalls).toHaveLength(1);
    expect(state.cancelCalls[0]).toEqual({
      subId: "sub-row-1",
      reason: "parent_cancelled",
    });
  });

  it("commission_cancelled activity log emitted when cancelled > 0 (T-018 — log parity with webhook handler)", async () => {
    state.cancelResult = { cancelled: 1 };
    await cancelSubscription({ reason: "service_issue" });
    const heldLog = state.activityLogInserts.find(
      (row) => row.action_type === "commission_cancelled",
    );
    expect(heldLog).toBeDefined();
    expect(heldLog?.action_details).toMatchObject({
      parent_subscription_id: "sub-row-1",
      cancelled_count: 1,
      reason: "parent_cancelled",
    });
  });

  it("commission_cancelled log NOT emitted when cancelled=0 (no in-flight rows to cancel) (T-018)", async () => {
    state.cancelResult = { cancelled: 0 };
    await cancelSubscription({ reason: "not_using" });
    const heldLog = state.activityLogInserts.find(
      (row) => row.action_type === "commission_cancelled",
    );
    expect(heldLog).toBeUndefined();
  });

  it("cancel throw is logged but does NOT fail the cancel (T-018 — matches webhook handler best-effort posture)", async () => {
    state.cancelThrows = true;
    const r = await cancelSubscription({ reason: "other" });
    // Cancel still succeeds — cancel-in-flight is best-effort; the DB trigger is
    // the universal safeguard. App-level cancel call is forensics parity
    // with the webhook, not a hard dependency.
    expect(r.success).toBe(true);
    expect(state.dbUpdateCalls[0]?.payload).toMatchObject({
      status: "cancelled",
    });
  });

  it("no-op branch (already cancelled): does NOT call cancel-in-flight (already idempotent at trigger layer) (T-018)", async () => {
    state.subRow!.status = "cancelled";
    await cancelSubscription({ reason: "not_using" });
    // Sub is already cancelled — the trigger fired at the prior
    // transition. No need to re-fire from the app layer.
    expect(state.cancelCalls).toHaveLength(0);
  });

  it("no-op branch (lapsed): does NOT call cancel-in-flight (T-018)", async () => {
    state.subRow!.status = "lapsed";
    await cancelSubscription({ reason: "not_using" });
    expect(state.cancelCalls).toHaveLength(0);
  });
});
