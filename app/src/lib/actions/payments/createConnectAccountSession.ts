"use server";

/**
 * createConnectAccountSession — S13 v2 server action.
 *
 * Mints (or reuses) the nanny's Stripe Express account, then issues
 * a short-lived Account Session client secret for the embedded
 * `<ConnectAccountOnboarding />` component.
 *
 * Spec: `system/APP/PAYMENTS/FRONTEND/03-build-spec.md` §S13.
 *
 * Different from `startConnectOnboarding` (hosted v1): instead of
 * returning a redirect URL, this returns a client secret that the
 * embedded Connect component consumes. Same prerequisite — the
 * Express account must exist; we mint it on first call.
 *
 * Reuses the existing `createExpressAccount` wrapper which has
 * idempotency keyed on nannyUserId.
 */

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { createExpressAccount } from "@/lib/stripe/connect";
import { getStripeClient } from "@/lib/stripe/client";
import { PAYMENTS_ENABLED, payoutsEnabled } from "@/lib/payments/flags";

export type CreateConnectAccountSessionResult =
  | { success: true; data: { clientSecret: string } }
  | { success: false; error: string };

export interface CreateConnectAccountSessionInput {
  /** 11-digit ABN. Required when the nanny doesn't yet have a
   *  stripe_connect_account_id — passed to Stripe at account
   *  creation so the embed doesn't have to ask. Ignored when an
   *  account already exists. */
  abn?: string;
}

export async function createConnectAccountSession(
  input?: CreateConnectAccountSessionInput,
): Promise<CreateConnectAccountSessionResult> {
  try {
    // 4a-i (P-23): Connect is hidden unless PAYOUTS_ENABLED — refuse before auth or any Stripe call.
    if (!payoutsEnabled()) {
      return { success: false, error: "payouts_disabled" };
    }
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
    const { data: nanny, error: nannyErr } = await admin
      .from("nannies")
      .select("id, stripe_connect_account_id")
      .eq("user_id", user.id)
      .maybeSingle<{ id: string; stripe_connect_account_id: string | null }>();
    if (nannyErr || !nanny) {
      return { success: false, error: "nanny_record_not_found" };
    }

    let accountId = nanny.stripe_connect_account_id;
    if (!accountId) {
      // Pull every field Stripe might ask for so the embedded
      // onboarding form is reduced to bank + address only. Anything
      // unknown stays null and Stripe collects it inline. Bailey
      // 2026-05-13.
      const [{ data: profile }, { data: verification }] = await Promise.all([
        admin
          .from("user_profiles")
          .select(
            "first_name, last_name, mobile_number, date_of_birth, address_line1, address_line2, suburb, postcode, state",
          )
          .eq("user_id", user.id)
          .maybeSingle<{
            first_name: string | null;
            last_name: string | null;
            mobile_number: string | null;
            date_of_birth: string | null;
            address_line1: string | null;
            address_line2: string | null;
            suburb: string | null;
            postcode: string | null;
            state: string | null;
          }>(),
        // Verification stores the canonical street address (the one
        // the nanny submitted with ID). `user_profiles` carries a
        // separate copy that nannies often skip. Bailey 2026-05-13:
        // prefer verification's address when present so Stripe gets
        // the real residential address.
        admin
          .from("verifications")
          .select("address_line, city, state, postcode")
          .eq("user_id", user.id)
          .maybeSingle<{
            address_line: string | null;
            city: string | null;
            state: string | null;
            postcode: string | null;
          }>(),
      ]);

      const line1 =
        verification?.address_line ?? profile?.address_line1 ?? null;
      const city = verification?.city ?? profile?.suburb ?? null;
      const stateValue = verification?.state ?? profile?.state ?? null;
      const postalCode = verification?.postcode ?? profile?.postcode ?? null;

      const created = await createExpressAccount({
        email: user.email ?? "",
        country: "AU",
        nannyUserId: user.id,
        metadata: { onboarding_source: "embedded_connect_session" },
        prefill: {
          firstName: profile?.first_name ?? null,
          lastName: profile?.last_name ?? null,
          phone: profile?.mobile_number ?? null,
          dateOfBirth: profile?.date_of_birth ?? null,
          address: {
            line1,
            line2: profile?.address_line2 ?? null,
            city,
            state: stateValue,
            postalCode,
            country: "AU",
          },
          // T-020 (2026-05-18): when ABN provided, createExpressAccount
          // switches to the AU sole_proprietorship branch
          // (business_type=company + company.tax_id=ABN).
          abn: input?.abn ?? null,
        },
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
          "[createConnectAccountSession] failed to persist account id",
          updateErr,
        );
        return { success: false, error: "db_update_failed" };
      }
    }

    // Mint an Account Session — short-lived client secret for the
    // embedded onboarding component to consume. Single-use; mint a
    // fresh one each time the user enters the flow.
    const stripe = getStripeClient();
    try {
      const session = await stripe.accountSessions.create({
        account: accountId,
        components: {
          account_onboarding: {
            enabled: true,
            features: {
              external_account_collection: true,
            },
          },
        },
      });
      return {
        success: true,
        data: { clientSecret: session.client_secret },
      };
    } catch (err) {
      console.error(
        "[createConnectAccountSession] stripe.accountSessions.create failed",
        err,
      );
      return { success: false, error: "stripe_session_failed" };
    }
  } catch (err) {
    console.error("[createConnectAccountSession] unexpected", err);
    return { success: false, error: "unexpected_error" };
  }
}
