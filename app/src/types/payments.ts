/**
 * Top-level payment types — mirrored from the SQL CHECK constraints in
 * `supabase/migrations/payments-foundation.sql`.
 *
 * Spec references:
 * - `system/APP/PAYMENTS/03-data-model.md` — table shapes
 * - `system/APP/PAYMENTS/04-stripe-integration.md` §5–§6 — flows
 *
 * These types are the contract between the database and the application
 * layer. They MUST stay in sync with the migration's CHECK constraints.
 * Add a value here without adding it to the migration (or vice versa)
 * and one of the two layers will silently misbehave.
 */

// ---------------------------------------------------------------------------
// Subscription state machine — `parent_subscriptions.status`
// ---------------------------------------------------------------------------
export type SubscriptionStatus =
  | "trial"
  | "active_monthly"
  | "active_upfront"
  | "past_due"
  | "cancelled"
  | "lapsed"
  // London done-for-you (4c, amendment 12): paid, no access (ADR-097) / access on at placement (ADR-093).
  | "deposit_paid"
  | "placed";

export type ActiveSubscriptionStatus = Extract<
  SubscriptionStatus,
  "active_monthly" | "active_upfront"
>;

export type PaidPlan = "monthly" | "upfront";

// ---------------------------------------------------------------------------
// Payout state machine — `nanny_payouts.status`
// ---------------------------------------------------------------------------
export type PayoutStatus =
  | "pending"
  | "held"
  | "sending"
  | "sent"
  | "paid"
  | "failed"
  | "cancelled"
  | "frozen";

export type CommissionModelVersion = "v1_flat" | "v2_engagement";

// ---------------------------------------------------------------------------
// Refund state machine — `refund_requests.status`
// ---------------------------------------------------------------------------
export type RefundStatus =
  | "pending_review"
  | "pending_processing"
  | "approved"
  | "denied"
  | "partially_approved"
  | "cancelled_by_user";

export type RefundReasonCategory =
  | "major_problem"
  | "reasonable_cause"
  | "change_of_mind"
  | "other";

// ---------------------------------------------------------------------------
// Payout application state — `nannies.payout_application_status`
// ---------------------------------------------------------------------------
export type PayoutApplicationStatus =
  | "not_applied"
  | "in_progress"
  | "pending_review"
  | "approved"
  | "requires_action"
  | "rejected";

// ---------------------------------------------------------------------------
// Earnings ledger — `earnings_events.event_kind`
// ---------------------------------------------------------------------------
export type EarningsEventKind =
  | "activity_logged"
  | "observation_logged"
  | "report_completed"
  | "diary_entry"
  | "progress_update"
  | "photo_uploaded";

// ---------------------------------------------------------------------------
// Stripe environment mode (gates UI badges + secrets per env var)
// ---------------------------------------------------------------------------
export type StripeMode = "test" | "live";

// ---------------------------------------------------------------------------
// Common envelope used by every Stripe wrapper function (per §4 / §5).
// `success: true` ⇒ data is present. `success: false` ⇒ error string is set.
// Wrappers that throw (e.g. webhook signature verify) are exempt.
// ---------------------------------------------------------------------------
export type StripeResult<T> =
  | { success: true; data: T }
  | { success: false; error: string };
