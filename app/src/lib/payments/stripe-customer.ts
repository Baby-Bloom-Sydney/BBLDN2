/**
 * The family's Stripe customer — every DFY link and brief 03's deposit session is made on it (4-w5fix, W5-M3), so a
 * refund traces back to the family and brief 07 can charge the saved card.
 *
 * Server-only, deliberately NOT `"use server"` (`src/lib/invite/mint.ts:1-9`): it writes any family's row with the
 * service role, so it must never become a callable action. Moved unchanged out of `actions/admin/dfy.ts` for brief 03
 * (plan 03 row A3), which calls it from its public deposit page after the code is verified.
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */

import type { createAdminClient } from "@/lib/supabase/admin";
import { getStripeClient } from "@/lib/stripe/client";

type Admin = ReturnType<typeof createAdminClient>;

/** The two columns of the family's `parent_subscriptions` row this reads; null when she has no row yet. */
export type CustomerRow = { readonly id: string; readonly stripe_customer_id: string | null } | null;

/**
 * Reuses the row's customer; else creates one with the parent's email (idempotent per parent for Stripe's 24 h key
 * window, so a double click makes one customer) and stores it on the row — never over an existing id. A failed store
 * throws: no link without a traceable customer. With no row, the customer is not stored (the deposit webhook does).
 */
export async function customerFor(
  admin: Admin,
  parentUserId: string,
  sub: CustomerRow,
  email: string | null,
): Promise<string> {
  if (sub?.stripe_customer_id) return sub.stripe_customer_id;
  const customer = await getStripeClient().customers.create(
    { ...(email ? { email } : {}), metadata: { user_id: parentUserId } },
    { idempotencyKey: `dfy-customer-${parentUserId}` },
  );
  if (sub) {
    const { error } = await admin
      .from("parent_subscriptions")
      .update({ stripe_customer_id: customer.id })
      .eq("id", sub.id)
      .is("stripe_customer_id", null);
    // A concurrent mint that stored first matches zero rows here; the idempotency key gave it this same customer.
    if (error) throw new Error(`customer store failed: ${error.message}`);
  }
  return customer.id;
}
