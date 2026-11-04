/**
 * A full Stripe refund re-opens the deposit's place (brief §6, §0.9; plan 02 step 6). Called from the existing
 * refund handler (`src/app/api/webhooks/stripe/handlers.ts`, `recordDashboardRefund`, after the deposit stamp).
 *
 * - **Logs, never throws.** It runs after the money is recorded; a throw would leave the event `unresolved`, and
 *   Stripe's retry is answered as a duplicate without dispatch (`route.ts:104-107,165-166`), so it would never run
 *   again. A miss is caught by the warnings box ("Deposit refunded but place still held").
 * - "Full" = Stripe's `charge.refunded`, true only once the charge is fully refunded. A partial refund keeps the
 *   place and reads nothing (brief Q5, default accepted). The deposit stamp still happens in the handler.
 * - **Not flag-gated** (brief §8; the `PAYMENTS_ENABLED` principle, `payments/flags.ts:38-40`): with no place for
 *   the payment it does nothing. Only reads the charge's type — it never talks to Stripe, so it can't refund.
 * - The re-open has no actor: amendment 17 logs it with source `stripe_refund`.
 *
 * BB-wave1-041126/02-build, 2026-11-04.
 */

import type Stripe from "stripe";
import { REFUND_REOPEN_REASON } from "./constants";
import { callRpc, type AdminClient } from "./db";
import { findPlaceByPaymentIntent, parseReopenResult } from "./places";
import { isFullyRefunded } from "./rules";

type RefundedCharge = {
  readonly refunded?: Stripe.Charge["refunded"] | null;
  readonly payment_intent?: string | { readonly id: string } | null;
};

const intentOf = (charge: RefundedCharge): string | null =>
  typeof charge.payment_intent === "string" ? charge.payment_intent : charge.payment_intent?.id ?? null;

export async function reopenPlaceAfterFullRefund(admin: AdminClient, charge: RefundedCharge): Promise<void> {
  try {
    if (!isFullyRefunded(charge)) return;
    const intentId = intentOf(charge);
    if (!intentId) return;
    const place = await findPlaceByPaymentIntent(admin, intentId);
    if (!place.ok) {
      console.error("[cohorts/refund-hook] the place could not be looked up", { status: "error" });
      return;
    }
    if (place.value === null || place.value.state !== "taken") return;
    const called = await callRpc(admin, "cohort_reopen_place", { p_place_id: place.value.id, p_actor: null, p_reason: REFUND_REOPEN_REASON });
    const result = called.ok ? parseReopenResult(called.value) : ({ ok: false, status: "error" } as const);
    if (!result.ok) console.error("[cohorts/refund-hook] the place was not re-opened", { status: result.status });
  } catch (thrown) {
    console.error("[cohorts/refund-hook] failed", { name: thrown instanceof Error ? thrown.name : typeof thrown });
  }
}
