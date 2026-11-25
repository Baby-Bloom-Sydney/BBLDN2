/**
 * The deposit-link webhook branch (plan 03 row A7, D4, D6, D7; brief 03 §4 "Retries"). `dfy-webhook.ts` calls
 * `recordDepositLinkPayment` from its deposit case for a session carrying `metadata.deposit_link_id`, after every
 * existing guard (paid, payment mode, the reference matches, the amount from `amount_total`) and its row read.
 * Never flag-gated (plan 03 §6): it acts only on sessions brief 03 made.
 *
 * - The money and the place are ONE database step (`deposit_record_card_payment`), with the amount `dfy-webhook`
 *   computed from `amount_total` (never metadata) and the session's customer.
 *   recorded → "applied" (a refused place is logged with its status as the code: 02's warnings box lists her);
 *   already_recorded → "ignored" (a replay changes nothing); duplicate → "applied" (the first deposit unchanged, the
 *   duplicate kept for BAI); invalid / error → THROW, so the route records the event unresolved. A malformed session
 *   also throws: a paid session is never silently dropped.
 * - Then the card (D7): the payment's method, read from Stripe, saved with brand, last four and expiry only. Any
 *   failure is logged by code and never throws (the money is already recorded; brief §4 "Retries").
 * - Server-only, deliberately NOT `"use server"` (`src/lib/invite/mint.ts:1-9`). Thrown messages and logs carry no
 *   family detail.
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */

import type Stripe from "stripe";
import { z } from "zod";
import { logFailure, type AdminClient } from "@/lib/cohorts/db";
import type { DfyLinkOutcome } from "@/lib/payments/dfy-webhook";
import { getStripeClient } from "@/lib/stripe/client";
import { UUID_RE } from "./code";
import { recordCardPayment } from "./record";

/** The one status rule, re-exported so `dfy-webhook.ts` needs a single import. */
export { keepStatusFor } from "./record";

const SESSION_ID_RE = /^cs_[A-Za-z0-9_]{1,252}$/;

/** What `dfy-webhook.ts` already verified and computed for this session. */
export interface DepositPaymentFacts {
  /** `metadata.user_id`, equal to `client_reference_id`. */
  readonly userId: string;
  readonly paymentIntentId: string;
  /** `amount_total`: what Stripe charged. */
  readonly pence: number;
  /** `keepStatusFor(row)` for the family's row. */
  readonly keepStatus: boolean;
}

const depositIds = z.object({ deposit_link_id: z.string().regex(UUID_RE), hold_id: z.string().regex(UUID_RE) });

const cardMethod = z.object({
  id: z.string().min(1).max(255),
  type: z.literal("card"),
  card: z.object({
    brand: z.string().min(1).max(40),
    last4: z.string().regex(/^[0-9]{4}$/),
    exp_month: z.number().int().min(1).max(12),
    exp_year: z.number().int().min(2000).max(2100),
  }),
});

function customerOf(session: Stripe.Checkout.Session): string | null {
  const c = session.customer;
  if (!c) return null;
  return typeof c === "string" ? c : c.id;
}

/** Brief 07's saved card: brand, last four and expiry only — never more card data. Logs; never throws. */
async function saveCard(admin: AdminClient, parentUserId: string, customerId: string | null, paymentIntentId: string): Promise<void> {
  if (customerId === null) {
    logFailure("deposit card save", { code: "no_customer" });
    return;
  }
  try {
    const intent = await getStripeClient().paymentIntents.retrieve(paymentIntentId, { expand: ["payment_method"] });
    const method = cardMethod.safeParse(intent.payment_method);
    if (!method.success) {
      logFailure("deposit card save", { code: "not_a_card" });
      return;
    }
    const { id, card } = method.data;
    const { error } = await admin.from("family_saved_cards").upsert(
      {
        parent_user_id: parentUserId,
        stripe_customer_id: customerId,
        stripe_payment_method_id: id,
        brand: card.brand,
        last4: card.last4,
        exp_month: card.exp_month,
        exp_year: card.exp_year,
        source_payment_intent_id: paymentIntentId,
        saved_at: new Date().toISOString(),
      },
      { onConflict: "parent_user_id" },
    );
    if (error) logFailure("deposit card save", error);
  } catch (thrown) {
    logFailure("deposit card save", thrown);
  }
}

/** A paid brief 03 session: the deposit and the place in one step, then the card. */
export async function recordDepositLinkPayment(
  admin: AdminClient,
  session: Stripe.Checkout.Session,
  facts: DepositPaymentFacts,
): Promise<DfyLinkOutcome> {
  const ids = depositIds.safeParse(session.metadata ?? {});
  if (!ids.success || !SESSION_ID_RE.test(session.id)) throw new Error("[deposit-webhook] a deposit session carries malformed ids");
  const customerId = customerOf(session);
  const result = await recordCardPayment(admin, {
    parentUserId: facts.userId,
    linkId: ids.data.deposit_link_id,
    holdId: ids.data.hold_id,
    sessionId: session.id,
    paymentIntentId: facts.paymentIntentId,
    pence: facts.pence,
    customerId,
    keepStatus: facts.keepStatus,
  });
  switch (result.status) {
    case "already_recorded":
      return "ignored";
    case "duplicate":
      return "applied";
    case "recorded":
      if (result.place.status !== "taken") logFailure("deposit webhook place", { code: result.place.status });
      await saveCard(admin, facts.userId, customerId, facts.paymentIntentId);
      return "applied";
    default: {
      // exhaustive: a new status in CardPaymentResult fails this assignment at compile time
      const failed: "invalid" | "error" = result.status;
      throw new Error(`[deposit-webhook] deposit_record_card_payment answered ${failed}`);
    }
  }
}
