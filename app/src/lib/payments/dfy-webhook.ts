/**
 * The done-for-you payment-link webhook handler (4c, brief step 5). **4c writes it, 4d wires it**:
 * the `checkout.session.completed` case in `api/webhooks/stripe/*` calls
 * `if (session.metadata?.link_kind) return handleDfyLinkCompleted(admin, session)` first.
 *
 * Contract
 * - Input: the service-role client and a completed Checkout Session minted by `createDfyPaymentLink`
 *   (metadata `{ user_id, link_kind, pence }`, plus `first_week_wages_pence` on a balance link).
 * - `deposit` → `family_type='dfy'`, deposit columns, `status='deposit_paid'` unless already `placed` or a
 *   live self-serve trial/paid state (that access is kept; review HIGH).
 *   Opens **no** access (ADR-097) — no toggle or access column is written. Logs `dfy.deposit_paid`.
 * - `balance-after-week-1` / `custom` → `bill_paid_at`, `bill_stripe_payment_intent_id`, `balance_pence`
 *   (+ `first_week_wages_pence` when the link carried it). Status untouched. Logs `dfy.bill_paid`.
 * - Returns `"ignored"` for: an unknown kind, no `user_id`, not yet paid, the same payment intent already
 *   recorded (Stripe retry), or a bill for a family with no subscription row. Otherwise `"applied"`.
 * - Throws on a database write error so the route records the event unresolved and Stripe retries.
 * - Never: emails anyone, reads an amount from anywhere but the session, or changes access by itself.
 *
 * BB-LDN-4c-151026.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import type Stripe from "stripe";
import { PAYMENT_LINK_PRESETS, type PaymentLinkPreset } from "@/config/offer";
import { isLiveSelfServe } from "./dfy-access";

export type DfyLinkOutcome = "applied" | "ignored";

interface SubRow {
  id: string;
  status: string;
  family_type: string | null;
  trial_ends_at: string | null;
  paid_period_ends_at: string | null;
  past_due_grace_ends_at: string | null;
  deposit_stripe_payment_intent_id: string | null;
  bill_stripe_payment_intent_id: string | null;
}

function isPreset(v: unknown): v is PaymentLinkPreset {
  return typeof v === "string" && (PAYMENT_LINK_PRESETS as readonly string[]).includes(v);
}

function intentId(session: Stripe.Checkout.Session): string | null {
  const pi = session.payment_intent;
  if (!pi) return null;
  return typeof pi === "string" ? pi : pi.id;
}

/** Whole non-negative pence from Stripe's total, else the metadata the link was minted with. */
function chargedPence(session: Stripe.Checkout.Session): number | null {
  const total = session.amount_total;
  if (typeof total === "number" && Number.isInteger(total) && total >= 0) return total;
  const meta = Number(session.metadata?.pence);
  return Number.isInteger(meta) && meta >= 0 ? meta : null;
}

function optionalPence(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : undefined;
}

async function log(admin: SupabaseClient, userId: string, actionType: string, details: Record<string, unknown>) {
  const { error } = await admin.from("activity_logs").insert({ user_id: userId, action_type: actionType, action_details: details });
  // The payment is already recorded; a lost history row is reported, not thrown (the retry would be a no-op).
  if (error) console.error(`[dfy-webhook] could not write ${actionType}:`, error.message);
}

async function must(promise: PromiseLike<{ error: { message: string } | null }>, what: string): Promise<void> {
  const { error } = await promise;
  if (error) throw new Error(`[dfy-webhook] ${what} failed: ${error.message}`);
}

export async function handleDfyLinkCompleted(
  admin: SupabaseClient,
  session: Stripe.Checkout.Session,
): Promise<DfyLinkOutcome> {
  const kind = session.metadata?.link_kind;
  const userId = session.metadata?.user_id;
  if (!isPreset(kind) || !userId) return "ignored";
  if (session.payment_status !== "paid" || session.mode !== "payment") return "ignored";
  // Minted by createDfyPaymentLink: client_reference_id is the same parent (security review MEDIUM).
  if (session.client_reference_id !== userId) return "ignored";

  const pi = intentId(session);
  const pence = chargedPence(session);
  if (!pi || pence === null) return "ignored";

  const { data: row, error: readErr } = await admin
    .from("parent_subscriptions")
    .select(
      "id, status, family_type, trial_ends_at, paid_period_ends_at, past_due_grace_ends_at, deposit_stripe_payment_intent_id, bill_stripe_payment_intent_id",
    )
    .eq("parent_user_id", userId)
    .maybeSingle<SubRow>();
  if (readErr) throw new Error(`[dfy-webhook] read failed: ${readErr.message}`);

  const nowIso = new Date().toISOString();
  const details = { session_id: session.id, payment_intent_id: pi, link_kind: kind, pence };

  if (kind === "deposit") {
    if (row?.deposit_stripe_payment_intent_id === pi) return "ignored";
    const deposit = {
      family_type: "dfy",
      deposit_pence: pence,
      deposit_paid_at: nowIso,
      deposit_stripe_payment_intent_id: pi,
    };
    if (!row) {
      await must(
        admin.from("parent_subscriptions").insert({ parent_user_id: userId, status: "deposit_paid", ...deposit }),
        "deposit insert",
      );
    } else {
      // `placed` stays placed; a live self-serve family keeps the access it already pays for or is
      // trialling (code review HIGH) — the deposit itself still opens nothing (ADR-097), and
      // openDfyAccess moves the row to `placed` at placement because family_type is now dfy.
      const keepStatus = row.status === "placed" || isLiveSelfServe(row);
      const status = keepStatus ? {} : { status: "deposit_paid" };
      await must(admin.from("parent_subscriptions").update({ ...deposit, ...status }).eq("id", row.id), "deposit update");
    }
    await log(admin, userId, "dfy.deposit_paid", details);
    return "applied";
  }

  // balance-after-week-1 / custom — the bill. Minted only for a family with a row.
  if (!row) return "ignored";
  if (row.bill_stripe_payment_intent_id === pi) return "ignored";
  const wages = kind === "balance-after-week-1" ? optionalPence(session.metadata?.first_week_wages_pence) : undefined;
  await must(
    admin
      .from("parent_subscriptions")
      .update({
        bill_paid_at: nowIso,
        bill_stripe_payment_intent_id: pi,
        balance_pence: pence,
        ...(wages !== undefined ? { first_week_wages_pence: wages } : {}),
      })
      .eq("id", row.id),
    "bill update",
  );
  await log(admin, userId, "dfy.bill_paid", details);
  return "applied";
}
