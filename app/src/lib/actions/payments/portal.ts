"use server";

/**
 * Parent-side server action: create a Stripe Customer Portal session so
 * the parent can manage their subscription (cancel, update card, view
 * billing history).
 *
 * Spec: `system/APP/PAYMENTS/04-stripe-integration.md` §5d
 *      `system/APP/PAYMENTS/09-server-actions.md` (Parent-payment actions)
 */

import { headers } from "next/headers";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createPortalSession as createStripePortalSession } from "@/lib/stripe/portal";
import { SITE_URL } from "@/lib/constants";

export interface CreatePortalSessionResult {
  success: boolean;
  data: { url: string } | null;
  error: string | null;
}

/**
 * Returns the Customer Portal URL for the current parent.
 *
 * Behaviour (per spec §5d):
 * 1. Auth check.
 * 2. Look up `parents.stripe_customer_id`.
 * 3. Call the Phase-2 Portal wrapper with a return URL pointing back to
 *    the in-app subscription page.
 *
 * No kill-switch on this surface — even when payments are paused, an
 * existing customer must be able to cancel / update their card.
 * Disabling the portal would be hostile + potentially regulator-relevant.
 */
export async function createPortalSession(): Promise<CreatePortalSessionResult> {
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

  const { data: parentRow, error: parentError } = await admin
    .from("parents")
    .select("stripe_customer_id")
    .eq("user_id", user.id)
    .maybeSingle();

  if (parentError) {
    console.error("[createPortalSession] parents read failed", parentError);
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

  if (!parentRow.stripe_customer_id) {
    return {
      success: false,
      data: null,
      error: "no_stripe_customer",
    };
  }

  const origin = resolveOrigin();

  try {
    const session = await createStripePortalSession({
      customerId: parentRow.stripe_customer_id,
      returnUrl: `${origin}/parent/subscription`,
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
    console.error("[createPortalSession] Stripe call failed", err);
    return {
      success: false,
      data: null,
      error: getErrorMessage(err),
    };
  }
}

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
    // headers() throws outside a request context — fall through.
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
