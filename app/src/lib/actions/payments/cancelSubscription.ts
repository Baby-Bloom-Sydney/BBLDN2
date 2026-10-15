"use server";

/**
 * cancelSubscription — S9 parent self-serve cancel flow.
 *
 * Spec: `system/APP/PAYMENTS/FRONTEND/03-build-spec.md` §S9.
 *
 * Captures the cancellation reason BEFORE asking Stripe to end the
 * subscription. This gives us product-learning input without crossing
 * into dark-pattern territory (no "are you sure" guilt-trip).
 *
 * Two key behaviours:
 *   1. **Cancel at period-end**, not immediate. The parent paid for
 *      the current cycle; pulling access immediately would feel
 *      punitive (and is legally questionable under ACL). Stripe
 *      handles the actual period-end transition; our webhook handler
 *      flips status to `cancelled` then.
 *   2. **Reason stored on `parent_subscriptions`** (not a separate
 *      analytics table). Two columns: `cancellation_reason` (enum
 *      from the radio) and `cancellation_reason_text` (optional
 *      freeform). Both added in `payments-frontend.sql`.
 *
 * Per spec peak-end rule: every off-ramp gets graceful copy.
 */

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripeClient } from "@/lib/stripe/client";
import { PAYMENTS_ENABLED, payoutsEnabled } from "@/lib/payments/flags";
import { cancelInFlightCommission } from "@/lib/payments/commission-cancel";

/** Locked enum — schema CHECK constraint on parent_subscriptions
 *  rejects anything else. Adding a new reason = new column value +
 *  new radio label here. */
export type CancellationReason =
  | "too_expensive"
  | "not_using"
  | "service_issue"
  | "circumstances_changed"
  | "other";

const VALID_REASONS: ReadonlySet<string> = new Set([
  "too_expensive",
  "not_using",
  "service_issue",
  "circumstances_changed",
  "other",
]);

export interface CancelSubscriptionInput {
  reason: CancellationReason;
  /** Optional freeform expansion of the radio reason. Max 500 chars. */
  reasonText?: string;
}

export type CancelSubscriptionResult =
  | { success: true; data: { paidPeriodEndsAt: string | null } }
  | { success: false; error: string };

export async function cancelSubscription(
  input: CancelSubscriptionInput,
): Promise<CancelSubscriptionResult> {
  try {
    if (!PAYMENTS_ENABLED) {
      return { success: false, error: "payments_disabled" };
    }

    if (!VALID_REASONS.has(input.reason)) {
      return { success: false, error: "invalid_reason" };
    }
    const reasonText = (input.reasonText ?? "").slice(0, 500).trim() || null;

    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "not_authenticated" };
    }

    const admin = createAdminClient();
    const { data: sub, error: subErr } = await admin
      .from("parent_subscriptions")
      .select("id, status, stripe_subscription_id, paid_period_ends_at")
      .eq("parent_user_id", user.id)
      .maybeSingle<{
        id: string;
        status:
          | "trial"
          | "active_monthly"
          | "active_upfront"
          | "past_due"
          | "cancelled"
          | "lapsed";
        stripe_subscription_id: string | null;
        paid_period_ends_at: string | null;
      }>();

    if (subErr || !sub) {
      return { success: false, error: "no_subscription" };
    }

    // Only active states can be cancelled. Lapsed / already-cancelled
    // return a no-op success so the UI can navigate forward without
    // flashing an error.
    if (sub.status !== "active_monthly" && sub.status !== "active_upfront") {
      // Capture reason anyway — useful product input even when the
      // sub is technically already cancelled.
      const { error: noopUpdateErr } = await admin
        .from("parent_subscriptions")
        .update({
          cancellation_reason: input.reason,
          cancellation_reason_text: reasonText,
        })
        .eq("id", sub.id);
      if (noopUpdateErr) {
        console.error(
          "[cancelSubscription] no-op reason capture DB update failed",
          noopUpdateErr,
        );
        return { success: false, error: "db_update_failed" };
      }
      return {
        success: true,
        data: { paidPeriodEndsAt: sub.paid_period_ends_at },
      };
    }

    // Monthly: flag Stripe to cancel at period end. This fires a
    // customer.subscription.updated event (with cancel_at_period_end
    // set), which our webhook handler currently ignores for status
    // purposes — status is flipped locally below to `cancelled`.
    // Stripe later fires customer.subscription.deleted when the
    // period actually ends; our handler treats that as idempotent.
    if (sub.status === "active_monthly") {
      if (!sub.stripe_subscription_id) {
        return { success: false, error: "no_stripe_sub_id" };
      }
      try {
        const stripe = getStripeClient();
        await stripe.subscriptions.update(sub.stripe_subscription_id, {
          cancel_at_period_end: true,
          metadata: {
            cancellation_reason: input.reason,
          },
        });
      } catch (err: unknown) {
        console.error("[cancelSubscription] stripe.subscriptions.update", err);
        return { success: false, error: "stripe_update_failed" };
      }
    }
    // Upfront: there's no recurring Stripe subscription to update.
    // The row just becomes `cancelled` with paid_period_ends_at
    // preserved. The cron + access-gate handle the transition to
    // lapsed at the end of the upfront period.

    // Capture reason + flip status to cancelled immediately. The
    // webhook for monthly will arrive shortly and idempotently land
    // on the same state.
    const nowIso = new Date().toISOString();
    const { error: updateErr } = await admin
      .from("parent_subscriptions")
      .update({
        status: "cancelled",
        cancelled_at: nowIso,
        cancellation_reason: input.reason,
        cancellation_reason_text: reasonText,
      })
      .eq("id", sub.id);

    if (updateErr) {
      console.error("[cancelSubscription] DB update", updateErr);
      return { success: false, error: "db_update_failed" };
    }

    // Activity log is best-effort — failure must NOT surface as a
    // cancel error (the cancel itself already succeeded). Pre-T-018
    // this insert was unguarded; a failure here would propagate to
    // the outer catch and return `{success: false, error: "unexpected_error"}`
    // for a cancel that actually succeeded in Stripe + DB.
    try {
      await admin.from("activity_logs").insert({
        user_id: user.id,
        action_type: "subscription_cancelled",
        action_details: {
          reason: input.reason,
          reason_text_present: reasonText !== null,
          plan: sub.status === "active_monthly" ? "monthly" : "upfront",
        },
      });
    } catch (logErr: unknown) {
      console.error(
        "[cancelSubscription] subscription_cancelled log insert failed",
        logErr,
      );
    }

    // T-018 — cancel in-flight commission rows so a subsequent resub
    // creates a fresh row rather than reviving a dead one.
    //
    // The DB trigger `trg_cancel_inflight_commission_on_terminal_status`
    // is the universal safeguard — it fires synchronously within the
    // `parent_subscriptions` UPDATE transaction above and cancels the
    // rows before this code runs. In normal operation this app-level
    // call therefore matches zero rows (`cancelled` returns 0) and the
    // `commission_cancelled` log entry below does NOT fire — the
    // forensic signal lives on `nanny_payouts.failure_reason` tagged
    // `sub_status_trigger:cancelled`.
    //
    // This call is retained for two scenarios:
    //   1. Environments where the trigger migration has not yet been
    //      applied (e.g. fresh dev branches before the migration runs).
    //   2. Future scenarios where the trigger is rolled back.
    //
    // Posture: best-effort. The cancel has already succeeded by this
    // point; a failure here must not surface as a cancel failure to
    // the caller. Trigger is the real guarantee.
    //
    // 4-w5fix (W5-M1, P-23): commission is hidden unless PAYOUTS_ENABLED — no freeze is called.
    if (payoutsEnabled()) {
      try {
        const { cancelled } = await cancelInFlightCommission(
          sub.id,
          "parent_cancelled",
        );
        if (cancelled > 0) {
          try {
            await admin.from("activity_logs").insert({
              user_id: user.id,
              action_type: "commission_cancelled",
              action_details: {
                parent_subscription_id: sub.id,
                cancelled_count: cancelled,
                reason: "parent_cancelled",
              },
            });
          } catch (logErr: unknown) {
            // Nested catch so a failed activity_log insert isn't
            // misattributed to the cancel-in-flight call itself (the
            // cancel succeeded and returned a non-zero count).
            console.error(
              "[cancelSubscription] commission_cancelled log insert failed",
              logErr,
            );
          }
        }
      } catch (cancelErr: unknown) {
        console.error("[cancelSubscription] cancel-in-flight failed", cancelErr);
      }
    }

    return {
      success: true,
      data: { paidPeriodEndsAt: sub.paid_period_ends_at },
    };
  } catch (err: unknown) {
    console.error("[cancelSubscription] unexpected", err);
    return { success: false, error: "unexpected_error" };
  }
}
