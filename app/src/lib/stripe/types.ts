/**
 * Shared TypeScript shapes for the subset of Stripe APIs Baby Bloom uses.
 * These are input shapes for the wrapper functions in this folder. Stripe
 * SDK types are imported elsewhere — these types stay BB-flavoured so the
 * call sites read like product code, not Stripe boilerplate.
 *
 * Spec: `system/APP/PAYMENTS/04-stripe-integration.md` §4 (module structure).
 */

import type { PaidPlan, RefundReasonCategory } from "@/types/payments";

// ---------------------------------------------------------------------------
// Customer
// ---------------------------------------------------------------------------
export interface GetOrCreateCustomerInput {
  /** Email captured at signup. Required for receipts + tax invoices. */
  email: string;
  /** Display name. Optional — Stripe Tax address-collection fills the rest. */
  name?: string;
  /** Internal Supabase auth user id, used as the idempotency key seed + metadata. */
  userId: string;
}

export interface GetOrCreateCustomerOutput {
  customerId: string;
}

// ---------------------------------------------------------------------------
// Checkout
// ---------------------------------------------------------------------------
export interface CreateCheckoutSessionInput {
  plan: PaidPlan;
  customerId: string;
  parentUserId: string;
  successUrl: string;
  cancelUrl: string;
  /**
   * Optional bump used to scope the idempotency key. Defaults to 1. Bump it
   * when the parent has cancelled + is resubscribing — otherwise Stripe
   * returns the prior session.
   */
  cycleNumber?: number;
}

export interface CreateCheckoutSessionOutput {
  url: string;
  sessionId: string;
}

// ---------------------------------------------------------------------------
// Subscriptions (read + cancel)
// ---------------------------------------------------------------------------
export interface RetrievedSubscription {
  id: string;
  status: string;
  /** Unix seconds. Stripe's `current_period_end`. */
  currentPeriodEnd: number | null;
  customerId: string;
  cancelAtPeriodEnd: boolean;
}

// ---------------------------------------------------------------------------
// Refunds
// ---------------------------------------------------------------------------
export type StripeRefundReason =
  | "duplicate"
  | "fraudulent"
  | "requested_by_customer";

/**
 * BB's RefundReasonCategory is richer than Stripe's. The mapping lives at
 * the action layer (Phase 3); this type just lets call sites pass either.
 */
export interface CreateRefundInput {
  paymentIntentId: string;
  /** Optional partial-refund amount in the smallest unit (pence, GBP). Omit for full refund. */
  amountCents?: number;
  /** Stripe-native reason. */
  reason?: StripeRefundReason;
  /** BB-side reason category, attached as metadata for audit. */
  bbReasonCategory?: RefundReasonCategory;
  /** BB-side refund_request id. Powers the idempotency key. */
  refundRequestId: string;
}

export interface CreateRefundOutput {
  refundId: string;
  status: string;
}

// ---------------------------------------------------------------------------
// Connect — Express accounts + onboarding links
// ---------------------------------------------------------------------------
export interface CreateExpressAccountInput {
  email: string;
  /** ISO 3166-1 alpha-2. Locked to 'AU' for v1. */
  country: "AU";
  /** Free-form metadata. Should include `user_id` for traceability. */
  metadata: Record<string, string>;
  /** Powers the idempotency key. Must be the BB-side nanny user id. */
  nannyUserId: string;
  /** Optional pre-fill — anything we know lets Stripe skip that
   *  question during onboarding. We grab these from `user_profiles`
   *  before calling. */
  prefill?: {
    firstName?: string | null;
    lastName?: string | null;
    /** Mobile number — must be E.164-compatible. We pass through
     *  raw and let Stripe validate / reject as needed. */
    phone?: string | null;
    /** ISO date (YYYY-MM-DD). */
    dateOfBirth?: string | null;
    address?: {
      line1?: string | null;
      line2?: string | null;
      city?: string | null;
      state?: string | null;
      postalCode?: string | null;
      /** ISO 3166-1 alpha-2. Defaults to the account country. */
      country?: string | null;
    } | null;
    /** 11-digit ABN. Passed to Stripe as `individual.id_number` at
     *  create time. Stripe's AU sole-trader embed does NOT surface
     *  ABN as a required step (empirically verified 2026-05-18), so
     *  BB collects it upfront and pre-passes it here. */
    abn?: string | null;
  };
}

export interface CreateExpressAccountOutput {
  accountId: string;
}

export interface CreateAccountLinkInput {
  accountId: string;
  refreshUrl: string;
  returnUrl: string;
  type: "account_onboarding" | "account_update";
}

export interface CreateAccountLinkOutput {
  url: string;
  expiresAt: number;
}

// ---------------------------------------------------------------------------
// Transfers (commission payouts)
// ---------------------------------------------------------------------------
export interface SendTransferInput {
  destinationAccountId: string;
  amountCents: number;
  /**
   * BB-side `nanny_payouts.id` (UUID). Used as the transfer_group AND the
   * idempotency-key seed so Stripe returns the original transfer on retry
   * even if our code times out between API call + DB write.
   */
  transferId: string;
  metadata: Record<string, string>;
  /**
   * Optional override. Defaults to `transfer-${transferId}`. Provided for
   * cases where the caller needs a custom scoping (e.g. retry after a
   * different idempotent operation re-using the same transferId).
   */
  idempotencyKey?: string;
}

export interface SendTransferOutput {
  transferId: string;
  destination: string;
  amount: number;
  currency: string;
}

// ---------------------------------------------------------------------------
// Customer portal
// ---------------------------------------------------------------------------
export interface CreatePortalSessionInput {
  customerId: string;
  returnUrl: string;
}

export interface CreatePortalSessionOutput {
  url: string;
}
