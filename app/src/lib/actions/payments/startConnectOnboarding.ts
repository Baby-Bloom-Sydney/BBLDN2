"use server";

/**
 * startConnectOnboarding — server action launching the nanny Connect
 * Express onboarding flow (S13).
 *
 * v1 = hosted redirect. The nanny clicks "Set up your payout account"
 * → this action mints the Express account if it doesn't exist + an
 * Account Link, then returns the hosted URL for the client to
 * redirect to. Stripe handles the form; returns to /nanny/payouts.
 *
 * v2 (deferred) = embedded `<ConnectAccountOnboarding />` component.
 * Requires `@stripe/react-connect-js` dependency + accountSessions
 * API plumbing. The Express account creation here is reusable for
 * that path — only the rendering layer changes.
 *
 * Spec: `system/APP/PAYMENTS/FRONTEND/03-build-spec.md` §S13.
 */

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createExpressAccount, createAccountLink } from "@/lib/stripe/connect";
import { PAYMENTS_ENABLED } from "@/lib/payments/flags";
import { SITE_URL } from "@/lib/constants";

export type StartConnectOnboardingResult =
  | { success: true; data: { url: string } }
  | { success: false; error: string };

export async function startConnectOnboarding(): Promise<StartConnectOnboardingResult> {
  try {
    if (!PAYMENTS_ENABLED) {
      return { success: false, error: "payments_disabled" };
    }

    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "not_authenticated" };
    }

    const admin = createAdminClient();

    // Look up nanny row + check we don't already have a Stripe
    // Connect account id (would be a bug to mint a second one).
    const { data: nanny, error: nannyErr } = await admin
      .from("nannies")
      .select("id, stripe_connect_account_id")
      .eq("user_id", user.id)
      .maybeSingle<{
        id: string;
        stripe_connect_account_id: string | null;
      }>();
    if (nannyErr || !nanny) {
      return { success: false, error: "nanny_record_not_found" };
    }

    let accountId = nanny.stripe_connect_account_id;
    if (!accountId) {
      // Mint a new Express account. createExpressAccount has
      // idempotency keyed on nannyUserId so concurrent retries
      // can't double-create.
      const created = await createExpressAccount({
        email: user.email ?? "",
        country: "AU",
        nannyUserId: user.id,
        metadata: { onboarding_source: "nanny_payouts_onboarding_page" },
      });
      if (!created.success) {
        return { success: false, error: created.error };
      }
      accountId = created.data.accountId;
      const { error: updateErr } = await admin
        .from("nannies")
        .update({ stripe_connect_account_id: accountId })
        .eq("id", nanny.id);
      if (updateErr) {
        console.error(
          "[startConnectOnboarding] failed to persist connect account id",
          updateErr,
        );
        return { success: false, error: "db_update_failed" };
      }
    }

    // Mint an Account Link — short-lived URL for the hosted
    // onboarding form. Account Links are single-use; mint a fresh
    // one every time the nanny re-enters the flow.
    const baseUrl =
      SITE_URL;
    const link = await createAccountLink({
      accountId,
      refreshUrl: `${baseUrl}/nanny/payouts/onboarding`,
      returnUrl: `${baseUrl}/nanny/payouts?onboarded=true`,
      type: "account_onboarding",
    });
    if (!link.success) {
      return { success: false, error: link.error };
    }

    return { success: true, data: { url: link.data.url } };
  } catch (err) {
    console.error("[startConnectOnboarding] unexpected", err);
    return { success: false, error: "unexpected_error" };
  }
}
