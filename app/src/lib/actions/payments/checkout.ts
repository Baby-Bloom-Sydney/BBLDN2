"use server";

/**
 * Parent-side server action: create a Stripe Checkout Session and return
 * its URL for client-side redirect.
 *
 * Spec: `system/APP/PAYMENTS/04-stripe-integration.md` §5b
 *      `system/APP/PAYMENTS/09-server-actions.md` (Parent-payment actions)
 */

import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createCheckoutSession as createStripeCheckoutSession } from "@/lib/stripe/checkout";
import { ensureStripeCustomer } from "@/lib/actions/payments/customer";
import { PAYMENTS_ENABLED } from "@/lib/payments/flags";
import type { PaidPlan } from "@/types/payments";
import { SITE_URL } from "@/lib/constants";

export interface CreateCheckoutSessionResult {
  success: boolean;
  data: { url: string } | null;
  error: string | null;
}

interface CreateCheckoutSessionInput {
  plan: PaidPlan;
}

/**
 * Returns a Stripe Checkout URL for the parent to complete payment.
 *
 * Behaviour (per spec §5b):
 * 1. Auth check + ensure parent role.
 * 2. Test-user check — `is_test_user = TRUE` rejects with
 *    `'test_users_cannot_pay'`.
 * 3. Kill-switch — `PAYMENTS_ENABLED = false` rejects with
 *    `'payments_disabled'`.
 * 4. `ensureStripeCustomer()`.
 * 5. Build success/cancel URLs from request origin.
 * 6. Delegate to the Phase-2 Stripe wrapper.
 */
export async function createCheckoutSession(
  input: CreateCheckoutSessionInput,
): Promise<CreateCheckoutSessionResult> {
  const { plan } = input;

  if (plan !== "monthly" && plan !== "upfront") {
    return {
      success: false,
      data: null,
      error: "invalid_plan",
    };
  }

  // Kill-switch first — cheaper than auth + DB read on a disabled
  // surface. Logs surface in Stripe dashboards via the activity log
  // when the matching webhook fails to land (defensive).
  if (!PAYMENTS_ENABLED) {
    return {
      success: false,
      data: null,
      error: "payments_disabled",
    };
  }

  const supabase = createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();

  if (authError || !user) {
    return {
      success: false,
      data: null,
      error: "not_authenticated",
    };
  }

  const admin = createAdminClient();

  // Confirm user is actually a parent + read test-user flag in one round.
  const { data: profile, error: profileError } = await admin
    .from("user_profiles")
    .select("is_test_user")
    .eq("user_id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("[createCheckoutSession] profile read failed", profileError);
    return {
      success: false,
      data: null,
      error: "profile_lookup_failed",
    };
  }

  if (profile?.is_test_user) {
    return {
      success: false,
      data: null,
      error: "test_users_cannot_pay",
    };
  }

  const { data: parentRow, error: parentError } = await admin
    .from("parents")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (parentError) {
    console.error("[createCheckoutSession] parents read failed", parentError);
    return {
      success: false,
      data: null,
      error: "parent_lookup_failed",
    };
  }

  if (!parentRow) {
    return {
      success: false,
      data: null,
      error: "not_a_parent",
    };
  }

  const customerResult = await ensureStripeCustomer();
  if (!customerResult.success || !customerResult.data) {
    return {
      success: false,
      data: null,
      error: customerResult.error ?? "customer_unavailable",
    };
  }

  // Look up the current subscription cycle for Stripe Session
  // metadata only. The number flows through to Stripe so support
  // can see which iteration of subscribing this is (first-time,
  // first resub, etc.). It is NOT part of any idempotency key —
  // see checkout.ts for why Session creation is idempotency-free.
  const { data: existingSub } = await admin
    .from("parent_subscriptions")
    .select("subscription_cycle")
    .eq("parent_user_id", user.id)
    .maybeSingle<{ subscription_cycle: number | null }>();
  const cycleNumber = (existingSub?.subscription_cycle ?? 0) + 1;

  const origin = resolveOrigin();

  try {
    const session = await createStripeCheckoutSession({
      plan,
      customerId: customerResult.data.stripeCustomerId,
      parentUserId: user.id,
      cycleNumber,
      successUrl: `${origin}/parent/subscription?status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancelUrl: `${origin}/parent/subscription?status=cancelled`,
    });
    if (!session.success) {
      return { success: false, data: null, error: session.error };
    }
    return {
      success: true,
      data: { url: session.data.url },
      error: null,
    };
  } catch (err) {
    console.error("[createCheckoutSession] Stripe call failed", err);
    return {
      success: false,
      data: null,
      error: getErrorMessage(err),
    };
  }
}

/**
 * Resolve the request origin for redirect URLs. Falls back to the env
 * variable when headers are unavailable (e.g. in tests). Never
 * hard-coded — preview deploys + local dev both flow through here.
 */
function resolveOrigin(): string {
  try {
    const headerStore = headers();
    const forwardedHost = headerStore.get("x-forwarded-host");
    const host = forwardedHost ?? headerStore.get("host");
    const proto = headerStore.get("x-forwarded-proto") ?? "https";
    if (host) {
      return `${proto}://${host}`;
    }
  } catch {
    // headers() may throw outside a request context — fall through.
  }
  const envOrigin = process.env.NEXT_PUBLIC_SITE_URL;
  if (envOrigin && envOrigin.length > 0) {
    return envOrigin.replace(/\/$/, "");
  }
  return SITE_URL;
}

function getErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "unknown_error";
}
