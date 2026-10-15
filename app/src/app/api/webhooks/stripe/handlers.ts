/**
 * Stripe webhook event handlers — pure DB-touching functions extracted
 * from the route entry point so the route file stays focused on
 * dispatch + idempotency.
 *
 * Spec: `system/APP/PAYMENTS/04-stripe-integration.md` §5e–§5g
 *      `system/APP/PAYMENTS/09-server-actions.md` (Webhook handlers)
 *
 * Every exported handler takes the admin Supabase client + the strongly
 * typed Stripe event and either resolves (success → caller marks the
 * webhook processed) or throws (caller records the error + returns 500).
 *
 * LDN2 unit 4d (ADR-146/156): the seven kept handlers resolve to their
 * outcome — `"applied"` when they changed state, `"ignored"` on an
 * early-return branch (no metadata, unknown plan/subscription/family) —
 * which the route writes to `stripe_webhook_events.outcome`.
 *
 * Handlers MUST stay free of route-specific concerns (no NextResponse,
 * no signature verification, no idempotency table writes — those belong
 * to the route entrypoint).
 */

import type Stripe from "stripe";

import { createAdminClient } from "@/lib/supabase/admin";
import { getStripeClient } from "@/lib/stripe/client";
import { scheduleCommissionFor } from "@/lib/payments/commission-scheduler";
import { cancelInFlightCommission } from "@/lib/payments/commission-cancel";

const ONE_WEEK_MS = 7 * 24 * 60 * 60 * 1000;

export type AdminClient = ReturnType<typeof createAdminClient>;

/** What a kept handler did with its event (ADR-146/156). A throw is `unresolved`. */
export type HandlerOutcome = "applied" | "ignored";

// ---------------------------------------------------------------------------
// checkout.session.completed
// ---------------------------------------------------------------------------

export async function handleCheckoutCompleted(
  admin: AdminClient,
  event: Stripe.CheckoutSessionCompletedEvent,
): Promise<HandlerOutcome> {
  const session = event.data.object;
  const userId = session.metadata?.user_id;
  const planMetadata = session.metadata?.plan;

  if (!userId) {
    console.warn(
      "[stripe-webhook] checkout.session.completed missing metadata.user_id",
      session.id,
    );
    return "ignored";
  }

  if (planMetadata !== "monthly" && planMetadata !== "upfront") {
    console.warn(
      "[stripe-webhook] checkout.session.completed unknown plan",
      planMetadata,
    );
    return "ignored";
  }

  const plan = planMetadata;
  const customerId = stringOrNull(session.customer);

  // Single time anchor for every write triggered by this checkout
  // (H1 from the 2026-05-13 review). Both the subscription upsert
  // (`paid_period_starts_at`) and the unfreeze update (`period_start`,
  // `scheduled_release_at`) consume this same instant so the rows
  // tie together cleanly on reconciliation. Without it the two
  // writes drift by tens-to-hundreds of ms.
  const anchorNow = new Date();

  // Two-tab race defence: if a non-lapsed subscription exists for this
  // user with a different stripe_subscription_id, refund the duplicate.
  const { data: existing } = await admin
    .from("parent_subscriptions")
    .select("id, status, stripe_subscription_id, subscription_cycle")
    .eq("parent_user_id", userId)
    .maybeSingle();

  const sessionSubId = stringOrNull(session.subscription);
  // Two-tab race defence — only fire the duplicate-refund branch when
  // the existing row represents a CURRENTLY ACTIVE subscription that
  // would be duplicated by this checkout. The only statuses where
  // that's true are `active_monthly` and `active_upfront`.
  //
  // Trial / cancelled / past_due / lapsed are all states where the
  // parent SHOULD be able to (re)subscribe — they're not "active
  // duplicates," they're legitimate next-subscription attempts.
  //
  // Bailey bug 2026-05-13 (C): prior code refunded every trial→paid
  // conversion. Bailey bug 2026-05-14: a narrower fix (exclude
  // `trial`) still refunded cancelled→resub because cancelled rows
  // carry a historical `stripe_subscription_id` that the guard
  // mistook for an active one. Switching to an explicit allow-list
  // of "active" statuses is the only shape that's safe.
  const isCurrentlyActive =
    existing?.status === "active_monthly" ||
    existing?.status === "active_upfront";
  if (
    isCurrentlyActive &&
    existing.stripe_subscription_id !== null &&
    existing.stripe_subscription_id !== sessionSubId
  ) {
    const paymentIntentId = stringOrNull(session.payment_intent);
    if (paymentIntentId) {
      const stripe = getStripeClient();
      // C4 (2026-05-13): rethrow on failure rather than swallowing.
      // The duplicate-refund branch is the ONLY place where a paid
      // duplicate is reversed — silently swallowing the error
      // would leave the parent double-charged with no audit trail
      // beyond a console.error. Letting the webhook fail tells
      // Stripe to retry (which our idempotency key tolerates) and
      // surfaces the failure in the dashboard for follow-up.
      try {
        await stripe.refunds.create(
          { payment_intent: paymentIntentId },
          { idempotencyKey: `dup-refund-${session.id}` },
        );
      } catch (err: unknown) {
        console.error("[stripe-webhook] duplicate refund failed", err);
        throw err instanceof Error
          ? err
          : new Error(`duplicate refund failed: ${String(err)}`);
      }
    }
    await logActivity(admin, {
      action_type: "duplicate_checkout_refunded",
      user_id: userId,
      action_details: { session_id: session.id, plan },
    });
    return "applied";
  }

  if (plan === "monthly") {
    await upsertMonthlySubscription({
      admin,
      userId,
      sessionId: session.id,
      sessionSubId,
      customerId,
      existingCycle: existing?.subscription_cycle ?? 0,
      anchorNow,
    });
  } else {
    await upsertUpfrontSubscription({
      admin,
      userId,
      sessionId: session.id,
      paymentIntentId: stringOrNull(session.payment_intent),
      customerId,
      anchorNow,
    });
  }

  await logActivity(admin, {
    action_type: "subscription_started",
    user_id: userId,
    action_details: { plan, session_id: session.id },
  });

  // Schedule the trial-period commission row (Phase 7). Best-effort —
  // logged but not thrown, because:
  // - The subscription is already activated by this point; failing
  //   to schedule the commission row shouldn't reverse that.
  // - The cron-driven cycle-completed scheduling will fire later
  //   regardless, so worst case the nanny misses one cycle of
  //   trial-period commission. Bailey can manually backfill via
  //   the admin queue.
  // - `no_connected_nanny` is a benign reason (parent paid before
  //   linking a nanny); not an error.
  const { data: subRow } = await admin
    .from("parent_subscriptions")
    .select("id")
    .eq("parent_user_id", userId)
    .maybeSingle<{ id: string }>();
  if (subRow) {
    // T-018: schedule cycle 1 commission only when the Stripe sub is NOT
    // in trial. Trial signups produce no commission row — Lock 1 of the
    // four money-safety invariants (DB row exists ⇔ real money landed).
    // When the trial converts to paid, invoice.payment_succeeded fires
    // and that handler schedules the row. Direct-paid signups schedule
    // here (the same period_start collides with the invoice.* handler's
    // INSERT, so the unique partial index keeps it at one row).
    //
    // Skipping unfreeze entirely (T-016's logic) — under T-018 the
    // simpler model is: cancel = terminal, resub = fresh row created
    // by invoice.payment_succeeded.
    let isInTrial = false;
    if (plan === "monthly" && sessionSubId) {
      try {
        const stripe = getStripeClient();
        const stripeSub = await stripe.subscriptions.retrieve(sessionSubId);
        // Direct access — Stripe.Subscription types trial_end as
        // `number | null` natively. The previous `as` cast hid any
        // future SDK rename: if `trial_end` ever disappears, this
        // becomes a typecheck error rather than silently returning
        // undefined → isInTrial=false → committing a Lock 1
        // violation (commission row scheduled for trial subscriber).
        const trialEndUnix = stripeSub.trial_end ?? null;
        isInTrial =
          stripeSub.status === "trialing" ||
          (trialEndUnix !== null && trialEndUnix * 1000 > Date.now());
      } catch (err: unknown) {
        // CRITICAL fail-safe: if we can't determine trial state, assume
        // we ARE in trial and skip commission scheduling. Lock 1 (DB
        // row ⇔ real money landed) must not depend on a Stripe API
        // call succeeding. The guaranteed-firing `invoice.payment_succeeded`
        // path will schedule the row when an actual non-zero payment
        // lands, which is the only signal that real money exists.
        console.error(
          "[stripe-webhook] stripe.subscriptions.retrieve failed — defaulting to isInTrial=true (Lock 1 fail-safe)",
          err,
        );
        isInTrial = true;
      }
    }

    if (!isInTrial) {
      const result = await scheduleCommissionFor({
        parentSubscriptionId: subRow.id,
        cycleIndex: 1,
      });
      if (!result.ok && result.reason === "db_error") {
        console.error(
          "[stripe-webhook] scheduleCommissionFor failed",
          result.detail,
        );
      }
    }
  }
  return "applied";
}

interface UpsertMonthlyArgs {
  admin: AdminClient;
  userId: string;
  sessionId: string;
  sessionSubId: string | null;
  customerId: string | null;
  existingCycle: number;
  /** Shared time anchor for this checkout — see H1 comment in
   *  handleCheckoutCompleted. Required, NOT optional: a `?? new Date()`
   *  fallback would silently reintroduce the drift H1 was meant to
   *  fix (review feedback 2026-05-13). */
  anchorNow: Date;
}

async function upsertMonthlySubscription(
  args: UpsertMonthlyArgs,
): Promise<void> {
  const {
    admin,
    userId,
    sessionId,
    sessionSubId,
    customerId,
    existingCycle,
    anchorNow,
  } = args;
  if (!sessionSubId) {
    throw new Error(
      `checkout.session.completed monthly missing subscription id (${sessionId})`,
    );
  }
  const stripe = getStripeClient();
  const stripeSub = await stripe.subscriptions.retrieve(sessionSubId);
  const periodEndUnix = readCurrentPeriodEnd(stripeSub);
  if (!periodEndUnix) {
    throw new Error(`Subscription ${sessionSubId} has no current_period_end`);
  }
  const nowIso = anchorNow.toISOString();
  const periodEndIso = new Date(periodEndUnix * 1000).toISOString();
  const { error } = await admin.from("parent_subscriptions").upsert(
    {
      parent_user_id: userId,
      status: "active_monthly",
      stripe_customer_id: customerId,
      stripe_subscription_id: sessionSubId,
      paid_period_starts_at: nowIso,
      paid_period_ends_at: periodEndIso,
      has_used_trial: true,
      subscription_cycle: existingCycle + 1,
    },
    { onConflict: "parent_user_id" },
  );
  if (error) {
    throw new Error(`parent_subscriptions upsert failed: ${error.message}`);
  }
}

interface UpsertUpfrontArgs {
  admin: AdminClient;
  userId: string;
  sessionId: string;
  paymentIntentId: string | null;
  customerId: string | null;
  /** Shared time anchor for this checkout — see H1 comment in
   *  handleCheckoutCompleted. Required, NOT optional (review
   *  feedback 2026-05-13). */
  anchorNow: Date;
}

async function upsertUpfrontSubscription(
  args: UpsertUpfrontArgs,
): Promise<void> {
  const { admin, userId, paymentIntentId, customerId, anchorNow } = args;
  const fifthBirthdayIso = await earliestChildFifthBirthdayIso(admin, userId);
  const nowIso = anchorNow.toISOString();
  const { error } = await admin.from("parent_subscriptions").upsert(
    {
      parent_user_id: userId,
      status: "active_upfront",
      stripe_customer_id: customerId,
      stripe_payment_intent_id: paymentIntentId,
      paid_period_starts_at: nowIso,
      paid_period_ends_at: fifthBirthdayIso,
      has_used_trial: true,
    },
    { onConflict: "parent_user_id" },
  );
  if (error) {
    throw new Error(
      `parent_subscriptions upsert (upfront) failed: ${error.message}`,
    );
  }
}

// ---------------------------------------------------------------------------
// customer.subscription.updated
// ---------------------------------------------------------------------------

export async function handleSubscriptionUpdated(
  admin: AdminClient,
  event: Stripe.CustomerSubscriptionUpdatedEvent,
): Promise<HandlerOutcome> {
  const sub = event.data.object;
  const periodEndUnix = readCurrentPeriodEnd(sub);
  const updates: Record<string, unknown> = {};
  if (periodEndUnix) {
    updates.paid_period_ends_at = new Date(periodEndUnix * 1000).toISOString();
  }
  if (Object.keys(updates).length === 0) {
    // Period-end probe missed on both SDK shapes — leaves us with
    // nothing to update. Log a warning so future Stripe-API-shape
    // drifts (per readCurrentPeriodEnd's SDK-gap note) are visible
    // rather than swallowed.
    console.warn(
      "[stripe-webhook] sub.updated had no current_period_end probe match",
      sub.id,
    );
    return "ignored";
  }

  // Read current status before writing. If the row is in a terminal
  // state (`cancelled` or `lapsed`), a stale customer.subscription.updated
  // replay must NOT silently refresh paid_period_ends_at — that would
  // mask a cancellation from the rest of the app (Katie chokepoint,
  // banners, dashboards). Skip when the Stripe-side subscription is
  // already in an inactive state too.
  //
  // Capture the read error: a transient DB failure here would otherwise
  // be misread as "no row → no-op" and Stripe would acknowledge a
  // legitimate event without applying it. Throw so the webhook retries.
  const { data: existing, error: existingErr } = await admin
    .from("parent_subscriptions")
    .select("status")
    .eq("stripe_subscription_id", sub.id)
    .maybeSingle<{ status: string }>();
  if (existingErr) {
    throw new Error(
      `parent_subscriptions status read (sub.updated) failed: ${existingErr.message}`,
    );
  }
  if (!existing) {
    // No row yet → nothing to update. Checkout completion creates the
    // row; if a stray sub.updated arrives before that, it's not ours
    // to act on.
    return "ignored";
  }
  const terminalLocalStatuses = new Set<string>(["cancelled", "lapsed"]);
  // Typed against Stripe.Subscription.Status so a Stripe API update
  // that renames any of these literals fails to compile rather than
  // silently dropping the guard.
  const inactiveStripeStatuses = new Set<Stripe.Subscription.Status>([
    "canceled",
    "unpaid",
    "incomplete_expired",
  ]);
  if (
    terminalLocalStatuses.has(existing.status) ||
    inactiveStripeStatuses.has(sub.status)
  ) {
    return "ignored";
  }

  const { error } = await admin
    .from("parent_subscriptions")
    .update(updates)
    .eq("stripe_subscription_id", sub.id);
  if (error) {
    throw new Error(
      `parent_subscriptions update (sub.updated) failed: ${error.message}`,
    );
  }
  return "applied";
}

// ---------------------------------------------------------------------------
// customer.subscription.deleted
// ---------------------------------------------------------------------------

export async function handleSubscriptionDeleted(
  admin: AdminClient,
  event: Stripe.CustomerSubscriptionDeletedEvent,
): Promise<HandlerOutcome> {
  const sub = event.data.object;
  const nowIso = new Date().toISOString();
  const { data: row, error } = await admin
    .from("parent_subscriptions")
    .update({ status: "cancelled", cancelled_at: nowIso })
    .eq("stripe_subscription_id", sub.id)
    .select("id, parent_user_id")
    .maybeSingle<{ id: string; parent_user_id: string | null }>();
  if (error) {
    throw new Error(
      `parent_subscriptions update (sub.deleted) failed: ${error.message}`,
    );
  }
  if (!row) return "ignored";
  if (row.parent_user_id) {
    await logActivity(admin, {
      action_type: "subscription_cancelled",
      user_id: row.parent_user_id,
      action_details: { stripe_subscription_id: sub.id },
    });

    // Phase 10.5 — freeze in-flight commission rows. Past `paid` rows
    // are NEVER touched (those are the nanny's). Reclaimable on
    // resubscription via unfreezeEarningsOnResubscribe.
    try {
      const { cancelled } = await cancelInFlightCommission(
        row.id,
        "parent_cancelled",
      );
      if (cancelled > 0) {
        await logActivity(admin, {
          action_type: "commission_cancelled",
          user_id: row.parent_user_id,
          action_details: {
            parent_subscription_id: row.id,
            cancelled_count: cancelled,
            reason: "parent_cancelled",
          },
        });
      }
    } catch (err: unknown) {
      console.error(
        "[stripe-webhook] cancel-in-flight on subscription delete failed",
        err,
      );
    }
  }
  return "applied";
}

// ---------------------------------------------------------------------------
// invoice.payment_succeeded
// ---------------------------------------------------------------------------

export async function handleInvoiceSucceeded(
  admin: AdminClient,
  event: Stripe.InvoicePaymentSucceededEvent,
): Promise<HandlerOutcome> {
  const invoice = event.data.object;
  const subId = stringOrNull(getInvoiceSubscription(invoice));
  if (!subId) {
    // Some invoices (e.g. one-off Stripe Tax) lack a subscription.
    return "ignored";
  }

  // T-018 Lock 1 enforcement: only proceed if a real, non-zero amount
  // was paid. Stripe sometimes fires invoice.payment_succeeded for
  // $0 trial-end-marker invoices; those must not produce commission rows.
  const amountPaid = invoice.amount_paid ?? 0;
  if (amountPaid <= 0) {
    return "ignored";
  }

  const stripe = getStripeClient();
  const stripeSub = await stripe.subscriptions.retrieve(subId);
  const periodEndUnix = readCurrentPeriodEnd(stripeSub);
  const nowIso = new Date().toISOString();

  const updates: Record<string, unknown> = {
    paid_period_starts_at: nowIso,
  };
  if (periodEndUnix) {
    updates.paid_period_ends_at = new Date(periodEndUnix * 1000).toISOString();
  }

  const { data: existing } = await admin
    .from("parent_subscriptions")
    .select("status, parent_user_id")
    .eq("stripe_subscription_id", subId)
    .maybeSingle();
  // No row for this subscription → nothing to extend (the update below would
  // match zero rows); the outcome says so.
  if (!existing) return "ignored";

  const wasRecoveryFromPastDue = existing?.status === "past_due";
  if (wasRecoveryFromPastDue) {
    updates.status = "active_monthly";
    updates.past_due_grace_ends_at = null;
  }

  const { error } = await admin
    .from("parent_subscriptions")
    .update(updates)
    .eq("stripe_subscription_id", subId);
  if (error) {
    throw new Error(
      `parent_subscriptions update (invoice.succeeded) failed: ${error.message}`,
    );
  }

  if (wasRecoveryFromPastDue && existing?.parent_user_id) {
    await logActivity(admin, {
      action_type: "subscription_recovered",
      user_id: existing.parent_user_id,
      action_details: { stripe_subscription_id: subId },
    });

    // T-018: clear past_due_release_deferred tag from in-flight rows so
    // the dashboard stops showing the amber "deferred" indicator after
    // the parent has paid. scheduled_release_at stays at the deferred
    // date (already a safe window after the recovery payment).
    const { data: recoveredSubRow } = await admin
      .from("parent_subscriptions")
      .select("id")
      .eq("stripe_subscription_id", subId)
      .maybeSingle<{ id: string }>();
    if (recoveredSubRow) {
      const { error: clearErr } = await admin
        .from("nanny_payouts")
        .update({ failure_reason: null })
        .eq("parent_subscription_id", recoveredSubRow.id)
        .in("status", ["pending", "held"])
        .eq("failure_reason", "past_due_release_deferred");
      if (clearErr) {
        console.error(
          "[stripe-webhook] past_due recovery — clear deferred tag failed",
          clearErr,
        );
      }
    }
  } else if (existing?.parent_user_id) {
    await logActivity(admin, {
      action_type: "subscription_renewed",
      user_id: existing.parent_user_id,
      action_details: { stripe_subscription_id: subId },
    });

    // Schedule the commission row for the cycle just completed (Phase 7).
    // Only fire on a normal renewal — not on a past_due → active recovery
    // (the cycle wasn't fully completed in good standing).
    const { data: subRow } = await admin
      .from("parent_subscriptions")
      .select("id")
      .eq("stripe_subscription_id", subId)
      .maybeSingle<{ id: string }>();
    if (subRow) {
      // Monthly always cycle 1 (each renewal is a fresh cycle from
      // commission's POV). Upfront cycles 2 + 3 fire from a separate
      // end-of-cycle cron — see C2 in 2026-05-13 review batch.
      const result = await scheduleCommissionFor({
        parentSubscriptionId: subRow.id,
        cycleIndex: 1,
      });
      if (!result.ok && result.reason === "db_error") {
        console.error(
          "[stripe-webhook] scheduleCommissionFor (renewal) failed",
          result.detail,
        );
      }
    }
  }
  return "applied";
}

// ---------------------------------------------------------------------------
// invoice.payment_failed
// ---------------------------------------------------------------------------

export async function handleInvoiceFailed(
  admin: AdminClient,
  event: Stripe.InvoicePaymentFailedEvent,
): Promise<HandlerOutcome> {
  const invoice = event.data.object;
  const subId = stringOrNull(getInvoiceSubscription(invoice));
  if (!subId) {
    return "ignored";
  }
  const graceEndsAtIso = new Date(Date.now() + ONE_WEEK_MS).toISOString();
  const { data: row, error } = await admin
    .from("parent_subscriptions")
    .update({
      status: "past_due",
      past_due_grace_ends_at: graceEndsAtIso,
    })
    .eq("stripe_subscription_id", subId)
    .select("id, parent_user_id")
    .maybeSingle<{ id: string; parent_user_id: string | null }>();
  if (error) {
    throw new Error(
      `parent_subscriptions update (invoice.failed) failed: ${error.message}`,
    );
  }
  if (!row) return "ignored";
  if (row.parent_user_id) {
    await logActivity(admin, {
      action_type: "subscription_past_due",
      user_id: row.parent_user_id,
      action_details: { stripe_subscription_id: subId },
    });

    // T-018: defer any in-flight pending/held nanny_payouts rows by
    // 14 days from today. Rationale: if the parent recovers (pays
    // the late invoice), the new release date gives BB the same
    // 14-day safeguard window. If they lapse, the trigger cancels
    // the rows when status flips to 'lapsed' via the expire-past-due
    // cron. Non-fatal — past_due itself is already set above.
    //
    // Two writes to avoid clobbering prior `failure_reason` tags
    // (e.g. `parent_cancelled` or `parent_refunded` from earlier paths):
    //   1. Always defer the date.
    //   2. Tag failure_reason ONLY if currently null.
    const fourteenDaysFromNow = new Date(
      Date.now() + 14 * 24 * 60 * 60 * 1000,
    ).toISOString();
    const { error: deferErr } = await admin
      .from("nanny_payouts")
      .update({ scheduled_release_at: fourteenDaysFromNow })
      .eq("parent_subscription_id", row.id)
      .in("status", ["pending", "held"]);
    if (deferErr) {
      console.error("[stripe-webhook] past_due release defer failed", deferErr);
    }
    const { error: tagErr } = await admin
      .from("nanny_payouts")
      .update({ failure_reason: "past_due_release_deferred" })
      .eq("parent_subscription_id", row.id)
      .in("status", ["pending", "held"])
      .is("failure_reason", null);
    if (tagErr) {
      console.error("[stripe-webhook] past_due defer tag failed", tagErr);
    }
  }
  return "applied";
}

// ---------------------------------------------------------------------------
// payment_intent.payment_failed
// ---------------------------------------------------------------------------

export async function handlePaymentIntentFailed(
  admin: AdminClient,
  event: Stripe.PaymentIntentPaymentFailedEvent,
): Promise<HandlerOutcome> {
  const intent = event.data.object;
  // Initial-charge failure on upfront plan. No DB write — the parent
  // never finished paying, so nothing was created. Log for forensics.
  // Still logged (as before) with no family on the intent, but then the
  // outcome is `ignored` — nothing was recorded against a family.
  const userId = intent.metadata?.user_id ?? null;
  await logActivity(admin, {
    action_type: "stripe_webhook_received",
    user_id: userId,
    action_details: {
      event: "payment_intent.payment_failed",
      payment_intent_id: intent.id,
      last_error: intent.last_payment_error?.message ?? null,
    },
  });
  return userId ? "applied" : "ignored";
}

// ---------------------------------------------------------------------------
// account.updated — Connect Express account verification state changes
// ---------------------------------------------------------------------------

export async function handleAccountUpdated(
  admin: AdminClient,
  event: Stripe.AccountUpdatedEvent,
): Promise<void> {
  const account = event.data.object;
  // Verification is "ready for payouts" when the transfers capability
  // is active AND there are no current/past-due/disabled requirements
  // blocking. Stripe consolidates this into payouts_enabled.
  const payoutsEnabled = account.payouts_enabled === true;
  const chargesEnabled = account.charges_enabled === true;
  const detailsSubmitted = account.details_submitted === true;

  // Find the nanny row by the connect account id.
  const { data: nanny } = await admin
    .from("nannies")
    .select("id, user_id, connect_onboarded_at, payout_application_status")
    .eq("stripe_connect_account_id", account.id)
    .maybeSingle<{
      id: string;
      user_id: string;
      connect_onboarded_at: string | null;
      payout_application_status: string | null;
    }>();
  if (!nanny) {
    console.warn(
      "[stripe-webhook] account.updated for unknown connect account",
      account.id,
    );
    return;
  }

  // Mark onboarded when first time the account passes both gates.
  // Idempotent: don't overwrite an existing onboarded timestamp.
  // Also sync the live capability flags onto our row — the
  // release-cron gates on `nannies.payouts_enabled`, so without
  // this sync a verified-on-Stripe nanny would never be paid.
  if (payoutsEnabled && detailsSubmitted && !nanny.connect_onboarded_at) {
    const nowIso = new Date().toISOString();
    const { error } = await admin
      .from("nannies")
      .update({
        connect_onboarded_at: nowIso,
        payout_application_status: "verified",
        payouts_enabled: payoutsEnabled,
        charges_enabled: chargesEnabled,
      })
      .eq("id", nanny.id);
    if (error) {
      throw new Error(
        `nannies update (account.updated) failed: ${error.message}`,
      );
    }
    // CRITICAL fix (2026-05-18 audit): promote any `held` commission
    // rows for this nanny to `pending`. Rows scheduled while the
    // nanny was unverified are stuck at `held` because the
    // release-cron only picks `pending`. Without this promotion the
    // commissions are forfeited even though the parent paid + the
    // nanny is now verified. `paid`/`sending`/`failed`/`cancelled`
    // rows are untouched (terminal or in-flight states owned elsewhere).
    const { error: promoteErr } = await admin
      .from("nanny_payouts")
      .update({ status: "pending" })
      .eq("nanny_user_id", nanny.user_id)
      .eq("status", "held");
    if (promoteErr) {
      // Don't fail the verification path on a promotion error — the
      // nanny IS verified, that side-effect succeeded. Log loud so
      // admin can manually flip the stuck rows. The cron will resume
      // releasing once the rows are pending.
      console.error(
        "[stripe-webhook] held→pending promotion failed",
        promoteErr.message,
      );
    }
    await logActivity(admin, {
      action_type: "payout_application_status_changed",
      user_id: null,
      action_details: {
        nanny_id: nanny.id,
        connect_account_id: account.id,
        new_status: "verified",
        payouts_enabled: payoutsEnabled,
      },
    });
    return;
  }

  // Previously-onboarded account just lost payouts_enabled — Stripe has
  // restricted the account (e.g. dispute, missing info, sanctions hit).
  // Flip our payout_application_status to "restricted" so the admin
  // dashboard surfaces the nanny + we stop scheduling new payouts to
  // a frozen Stripe account. Leave connect_onboarded_at populated —
  // it's the historical marker, not the live capability flag.
  if (
    !payoutsEnabled &&
    nanny.connect_onboarded_at &&
    nanny.payout_application_status !== "restricted"
  ) {
    const { error } = await admin
      .from("nannies")
      .update({
        payout_application_status: "restricted",
        payouts_enabled: payoutsEnabled,
        charges_enabled: chargesEnabled,
      })
      .eq("id", nanny.id);
    if (error) {
      throw new Error(
        `nannies update (account.updated → restricted) failed: ${error.message}`,
      );
    }
    await logActivity(admin, {
      action_type: "payout_application_status_changed",
      user_id: null,
      action_details: {
        nanny_id: nanny.id,
        connect_account_id: account.id,
        new_status: "restricted",
        payouts_enabled: payoutsEnabled,
        requirements_currently_due: account.requirements?.currently_due ?? null,
      },
    });
    return;
  }

  // Stripe re-enables a previously-restricted account (admin or nanny
  // resolved the outstanding requirements). Restore "verified" so we
  // resume normal payout flow.
  if (
    payoutsEnabled &&
    detailsSubmitted &&
    nanny.connect_onboarded_at &&
    nanny.payout_application_status === "restricted"
  ) {
    const { error } = await admin
      .from("nannies")
      .update({
        payout_application_status: "verified",
        payouts_enabled: payoutsEnabled,
        charges_enabled: chargesEnabled,
      })
      .eq("id", nanny.id);
    if (error) {
      throw new Error(
        `nannies update (account.updated → re-verified) failed: ${error.message}`,
      );
    }
    // Same held→pending promotion on re-verification. Restricted
    // accounts may have accumulated held rows during the restricted
    // window; unlock them now.
    const { error: promoteErr } = await admin
      .from("nanny_payouts")
      .update({ status: "pending" })
      .eq("nanny_user_id", nanny.user_id)
      .eq("status", "held");
    if (promoteErr) {
      console.error(
        "[stripe-webhook] held→pending promotion (re-verified) failed",
        promoteErr.message,
      );
    }
    await logActivity(admin, {
      action_type: "payout_application_status_changed",
      user_id: null,
      action_details: {
        nanny_id: nanny.id,
        connect_account_id: account.id,
        new_status: "verified",
        payouts_enabled: payoutsEnabled,
        reason: "restored_from_restricted",
      },
    });
    return;
  }

  // For ongoing capability changes that don't flip the actionable
  // state (e.g. Stripe asks for more info but payouts still enabled),
  // surface as an activity log for admin visibility.
  await logActivity(admin, {
    action_type: "nanny_account_updated",
    user_id: null,
    action_details: {
      nanny_id: nanny.id,
      connect_account_id: account.id,
      payouts_enabled: payoutsEnabled,
      details_submitted: detailsSubmitted,
      requirements_currently_due: account.requirements?.currently_due ?? null,
    },
  });
}

// ---------------------------------------------------------------------------
// account.application.deauthorized — nanny revoked Connect access
// ---------------------------------------------------------------------------

export async function handleAccountDeauthorized(
  admin: AdminClient,
  event: Stripe.AccountApplicationDeauthorizedEvent,
): Promise<void> {
  // Account id is on event.account when the application is the
  // platform's own Connect app (which it is for our Express flow).
  const accountId = event.account ?? null;
  if (!accountId) {
    console.warn(
      "[stripe-webhook] account.application.deauthorized no account",
    );
    return;
  }

  const { data: nanny } = await admin
    .from("nannies")
    .select("id")
    .eq("stripe_connect_account_id", accountId)
    .maybeSingle<{ id: string }>();
  if (!nanny) return;

  const { error } = await admin
    .from("nannies")
    .update({
      payout_application_status: "not_applied",
      connect_onboarded_at: null,
    })
    .eq("id", nanny.id);
  if (error) {
    throw new Error(
      `nannies update (account.deauthorized) failed: ${error.message}`,
    );
  }

  await logActivity(admin, {
    action_type: "payout_application_status_changed",
    user_id: null,
    action_details: {
      nanny_id: nanny.id,
      connect_account_id: accountId,
      new_status: "deauthorized",
    },
  });
}

// ---------------------------------------------------------------------------
// capability.updated — granular Connect capability changes
// ---------------------------------------------------------------------------

export async function handleCapabilityUpdated(
  admin: AdminClient,
  event: Stripe.CapabilityUpdatedEvent,
): Promise<void> {
  const cap = event.data.object;
  const accountId = stringOrNull(cap.account);
  if (!accountId) return;

  // Audit-only — actionable state flips are picked up by account.updated.
  await logActivity(admin, {
    action_type: "nanny_account_updated",
    user_id: null,
    action_details: {
      connect_account_id: accountId,
      capability: cap.id,
      status: cap.status,
    },
  });
}

// ---------------------------------------------------------------------------
// payout.created / payout.paid / payout.failed — Stripe transferring to bank
// ---------------------------------------------------------------------------

export async function handlePayoutCreated(
  admin: AdminClient,
  event: Stripe.PayoutCreatedEvent,
): Promise<void> {
  // Audit-only event — actual state transition happens in handlePayoutPaid.
  // The action_type was `payout_paid` previously, which mis-labelled the
  // forensic log + would have mis-counted payout success in any future
  // dashboard. Correct it to `payout_created`.
  await logActivity(admin, {
    action_type: "payout_created",
    user_id: null,
    action_details: {
      stripe_payout_id: event.data.object.id,
      stripe_account: event.account ?? null,
      amount: event.data.object.amount,
      status: event.data.object.status,
      created_at: event.data.object.created,
    },
  });
}

export async function handlePayoutPaid(
  admin: AdminClient,
  event: Stripe.PayoutPaidEvent,
): Promise<void> {
  // Mark any matching nanny_payouts row as paid. Stripe's payout id
  // is stored on `stripe_transfer_id` in our schema.
  //
  // Throw on DB failure — Stripe will retry the webhook + the missing
  // state transition is high-stakes (nanny + admin both rely on
  // `nanny_payouts.status` to determine whether the parent's money
  // has landed). Silently logging would mark the event delivered
  // while leaving the row stuck on `processing`.
  const stripePayoutId = event.data.object.id;
  const arrival = event.data.object.arrival_date * 1000;
  const arrivalIso = new Date(arrival).toISOString();

  const { error } = await admin
    .from("nanny_payouts")
    .update({
      status: "paid",
      paid_at: arrivalIso,
    })
    .eq("stripe_transfer_id", stripePayoutId);
  if (error) {
    throw new Error(
      `nanny_payouts update (payout.paid) failed: ${error.message}`,
    );
  }

  await logActivity(admin, {
    action_type: "payout_paid",
    user_id: null,
    action_details: {
      stripe_payout_id: stripePayoutId,
      stripe_account: event.account ?? null,
      arrival_date: arrivalIso,
    },
  });
}

export async function handlePayoutFailed(
  admin: AdminClient,
  event: Stripe.PayoutFailedEvent,
): Promise<void> {
  // Throw on DB failure — see handlePayoutPaid rationale. A failed
  // payout that isn't reflected in our row would leave the nanny seeing
  // "scheduled" while Stripe shows "failed", which is exactly the
  // dashboard divergence we can't ship.
  const stripePayoutId = event.data.object.id;
  const failureMessage =
    event.data.object.failure_message ?? "(no message provided)";

  const { error } = await admin
    .from("nanny_payouts")
    .update({
      status: "failed",
      failed_at: new Date().toISOString(),
      failure_reason: failureMessage,
    })
    .eq("stripe_transfer_id", stripePayoutId);
  if (error) {
    throw new Error(
      `nanny_payouts update (payout.failed) failed: ${error.message}`,
    );
  }

  await logActivity(admin, {
    action_type: "payout_failed",
    user_id: null,
    action_details: {
      stripe_payout_id: stripePayoutId,
      stripe_account: event.account ?? null,
      failure_message: failureMessage,
    },
  });
}

// ---------------------------------------------------------------------------
// charge.refunded
// ---------------------------------------------------------------------------

//
// London (LDN2 unit 4d; offer §3 "Refund", §4 G2): refunds are issued by hand
// in the Stripe Dashboard after a call — there is no refund engine and no
// self-serve refund. When no `refund_requests` row matches the refund (the
// London case) the handler records one from the charge. **A refund never
// changes access** ("full refund — and you keep the app"); the admin toggles
// access by hand.

export async function handleChargeRefunded(
  admin: AdminClient,
  event: Stripe.ChargeRefundedEvent,
): Promise<HandlerOutcome> {
  const charge = event.data.object;
  const refund = await newestRefund(charge);
  if (!refund) {
    console.warn("[stripe-webhook] charge.refunded with no refund", charge.id);
    return "ignored";
  }
  const refundId = refund.id;
  const nowIso = new Date().toISOString();
  const { data: row, error } = await admin
    .from("refund_requests")
    .update({ refund_processed_at: nowIso, status: "approved" })
    .eq("stripe_refund_id", refundId)
    .select("id, parent_user_id")
    .maybeSingle();
  if (error) {
    throw new Error(
      `refund_requests update (charge.refunded) failed: ${error.message}`,
    );
  }
  if (!row) {
    return recordDashboardRefund(admin, charge, refund, nowIso);
  }
  if (row.parent_user_id) {
    await logActivity(admin, {
      action_type: "refund_processed",
      user_id: row.parent_user_id,
      action_details: { refund_id: refundId, request_id: row.id },
    });

    // M3 (2026-05-13): a processed refund must also freeze the
    // parent's in-flight commission rows. Spec §"Frozen state on
    // parent cancellation" calls out BOTH cancellation AND refund as
    // freeze triggers; previously only cancellation was wired.
    // Look up the parent's current subscription, then freeze.
    //
    // FAIL-LOUD (2026-05-18 audit): previously wrapped in try/catch
    // that only `console.error`ed. A silent failure here is a real
    // wallet leak — refund_requests is marked approved (parent got
    // money back) but the commission row stays pending and the cron
    // later pays the nanny money BB no longer holds. Now: if the
    // commission cancel fails, throw → webhook 500s → Stripe retries
    // (idempotent — re-marking the refund as approved is a no-op,
    // and cancelInFlightCommission is idempotent via the status
    // filter). The DB trigger does NOT save us here: refunds don't
    // necessarily change subscription status.
    const { data: subRow, error: subLookupErr } = await admin
      .from("parent_subscriptions")
      .select("id")
      .eq("parent_user_id", row.parent_user_id)
      .in("status", [
        "trial",
        "active_monthly",
        "active_upfront",
        "past_due",
        "cancelled",
      ])
      .maybeSingle<{ id: string }>();
    if (subLookupErr) {
      throw new Error(
        `refund: parent_subscriptions lookup failed: ${subLookupErr.message}`,
      );
    }
    if (subRow) {
      const { cancelled } = await cancelInFlightCommission(
        subRow.id,
        "parent_refunded",
      );
      if (cancelled > 0) {
        await logActivity(admin, {
          action_type: "commission_cancelled",
          user_id: row.parent_user_id,
          action_details: {
            parent_subscription_id: subRow.id,
            cancelled_count: cancelled,
            reason: "parent_refunded",
            refund_id: refundId,
          },
        });
      }
    }
  }
  return "applied";
}

/**
 * The refund this `charge.refunded` is about: the newest one. On API
 * `2024-09-30.acacia` a Charge in an event payload no longer carries
 * `refunds` by default, so when it is absent the charge's newest refund is
 * listed (newest first is Stripe's list order).
 */
async function newestRefund(charge: Stripe.Charge): Promise<Stripe.Refund | null> {
  const fromPayload = charge.refunds?.data?.[0];
  if (fromPayload) return fromPayload;
  const stripe = getStripeClient();
  const listed = await stripe.refunds.list({ charge: charge.id, limit: 1 });
  return listed.data[0] ?? null;
}

/**
 * London: a refund made in the Stripe Dashboard has no `refund_requests` row.
 * Record one from the charge — parent via `parent_subscriptions.stripe_customer_id`.
 * Amounts are pence in the existing amount columns (the rename is cleanup's).
 * Writes no access field. No resolvable parent → `ignored`, logged.
 */
async function recordDashboardRefund(
  admin: AdminClient,
  charge: Stripe.Charge,
  refund: Stripe.Refund,
  nowIso: string,
): Promise<HandlerOutcome> {
  const customerId = stringOrNull(charge.customer);
  const parent = customerId ? await subscriptionForCustomer(admin, customerId) : null;
  if (!parent) {
    console.warn("[stripe-webhook] charge.refunded: no parent for the charge", charge.id);
    return "ignored";
  }
  const { error } = await admin.from("refund_requests").insert({
    parent_subscription_id: parent.id,
    parent_user_id: parent.parent_user_id,
    reason_category: "other",
    reason_text: "Refund issued in the Stripe Dashboard",
    calculated_refund_aud_cents: refund.amount,
    approved_amount_aud_cents: refund.amount,
    calculation_breakdown: {
      source: "stripe_dashboard",
      charge_id: charge.id,
      payment_intent_id: stringOrNull(charge.payment_intent),
      refund_id: refund.id,
      currency: refund.currency,
    },
    status: "approved",
    refund_processed_at: nowIso,
    stripe_refund_id: refund.id,
  });
  if (error) {
    throw new Error(`refund_requests insert (charge.refunded) failed: ${error.message}`);
  }
  await logActivity(admin, {
    action_type: "refund_processed",
    user_id: parent.parent_user_id,
    action_details: { refund_id: refund.id, source: "stripe_dashboard" },
  });
  await stampDepositRefund(admin, parent.id, stringOrNull(charge.payment_intent), nowIso);
  return "applied";
}

async function subscriptionForCustomer(
  admin: AdminClient,
  customerId: string,
): Promise<{ id: string; parent_user_id: string } | null> {
  const { data, error } = await admin
    .from("parent_subscriptions")
    .select("id, parent_user_id")
    .eq("stripe_customer_id", customerId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ id: string; parent_user_id: string }>();
  if (error) {
    throw new Error(`refund: parent_subscriptions lookup failed: ${error.message}`);
  }
  return data ?? null;
}

/**
 * When the refunded payment is the DFY deposit, stamp `deposit_refunded_at`
 * (4c's columns, amendment 12). Read defensively: before 4c's amendment the
 * column does not exist and the stamp is skipped, not failed.
 */
async function stampDepositRefund(
  admin: AdminClient,
  subscriptionId: string,
  paymentIntentId: string | null,
  nowIso: string,
): Promise<void> {
  if (!paymentIntentId) return;
  const { data, error } = await admin
    .from("parent_subscriptions")
    .select("deposit_stripe_payment_intent_id")
    .eq("id", subscriptionId)
    .maybeSingle<{ deposit_stripe_payment_intent_id: string | null }>();
  if (error) {
    console.warn("[stripe-webhook] deposit column not readable — stamp skipped", error.code);
    return;
  }
  if (data?.deposit_stripe_payment_intent_id !== paymentIntentId) return;
  const { error: stampErr } = await admin
    .from("parent_subscriptions")
    .update({ deposit_refunded_at: nowIso })
    .eq("id", subscriptionId);
  if (stampErr) {
    throw new Error(`deposit_refunded_at stamp failed: ${stampErr.message}`);
  }
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function stringOrNull(
  value: string | { id: string } | null | undefined,
): string | null {
  if (!value) return null;
  if (typeof value === "string") return value;
  if (typeof value === "object" && "id" in value) return value.id;
  return null;
}

/**
 * Reads `current_period_end` from a subscription. Stripe SDK shapes
 * differ across API versions — the field may live on the subscription
 * itself (legacy) or under the first item (newer). Probe both safely.
 *
 * SDK-gap note: this project pins `stripe@^17.x` against API version
 * `2024-09-30.acacia`. On that version, the Subscription type's
 * `current_period_end` was moved to per-item, so the top-level cast
 * is for legacy-shape compatibility (older raw events). Replace with
 * direct property access once the SDK + API version are advanced
 * past the migration.
 */
function readCurrentPeriodEnd(sub: Stripe.Subscription): number | null {
  const candidate = (sub as unknown as { current_period_end?: unknown })
    .current_period_end;
  if (typeof candidate === "number" && Number.isFinite(candidate)) {
    return candidate;
  }
  const itemEnd =
    sub.items?.data?.[0] &&
    (sub.items.data[0] as unknown as { current_period_end?: unknown })
      .current_period_end;
  if (typeof itemEnd === "number" && Number.isFinite(itemEnd)) {
    return itemEnd;
  }
  return null;
}

function getInvoiceSubscription(
  invoice: Stripe.Invoice,
): string | { id: string } | null {
  const value = (invoice as unknown as { subscription?: unknown }).subscription;
  if (typeof value === "string") return value;
  if (
    value &&
    typeof value === "object" &&
    "id" in value &&
    typeof (value as { id: unknown }).id === "string"
  ) {
    return value as { id: string };
  }
  return null;
}

/**
 * Returns the ISO timestamp for the earliest linked child's 5th birthday.
 * Used as `paid_period_ends_at` for the upfront plan.
 *
 * Throws on DB error — this runs in the upfront checkout completion
 * handler, where a misset `paid_period_ends_at` directly determines
 * how long the parent retains paid access for a real-money
 * subscription. Better to let Stripe retry the webhook than to silently
 * fall back to "now + 5 years" and lock in the wrong period.
 *
 * Falls back to "now + 5 years" only when the parent has NO linked
 * children — defensive; the upfront flow shouldn't be reachable
 * without at least one child connected.
 */
async function earliestChildFifthBirthdayIso(
  admin: AdminClient,
  parentUserId: string,
): Promise<string> {
  const { data: rows, error } = await admin
    .from("child_client")
    .select("date_of_birth")
    .eq("parent_user_id", parentUserId)
    .not("date_of_birth", "is", null)
    .order("date_of_birth", { ascending: true })
    .limit(1);
  if (error) {
    throw new Error(
      `child_client lookup (earliest fifth birthday) failed: ${error.message}`,
    );
  }
  const dob = rows?.[0]?.date_of_birth;
  if (typeof dob === "string" && dob.length > 0) {
    return addYearsIso(dob, 5);
  }
  const now = new Date();
  now.setFullYear(now.getFullYear() + 5);
  return now.toISOString();
}

function addYearsIso(dateIso: string, years: number): string {
  // dateIso may be 'YYYY-MM-DD' (DATE) or full timestamp. Normalise to
  // a Date and bump the year while keeping the same month/day.
  const d = new Date(dateIso);
  if (Number.isNaN(d.getTime())) {
    const fallback = new Date();
    fallback.setFullYear(fallback.getFullYear() + years);
    return fallback.toISOString();
  }
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString();
}

interface ActivityLogInput {
  action_type: string;
  user_id: string | null;
  action_details: Record<string, unknown>;
}

async function logActivity(
  admin: AdminClient,
  input: ActivityLogInput,
): Promise<void> {
  const { error } = await admin.from("activity_logs").insert({
    user_id: input.user_id,
    action_type: input.action_type,
    action_details: input.action_details,
  });
  if (error) {
    // Activity logging is best-effort — never block the handler on it.
    console.warn(
      "[stripe-webhook] activity_logs insert failed",
      error.code,
      input.action_type,
    );
  }
}
