"use server";

/**
 * Admin-only done-for-you actions (4c; BB-LDN-4c-151026).
 *
 * `createDfyPaymentLink` — the manual payment portal (offer §3 mechanism, card 5a: the admin sends the
 * link by hand). Presets from `PAYMENT_LINK_PRESETS`:
 *   - `deposit` = `PRICES.dfy.depositPence` (ADR-097);
 *   - `balance-after-week-1` = fee − deposit (if paid) − min(first week's wages, cap) (ADR-094/100), refused
 *     before `payment_due_at` with `payment_not_due`; wages default to the placement's snapshot;
 *   - `custom` = the admin's pence.
 * A Stripe Checkout Session, `mode: "payment"`, inline `price_data` (no price id), tax-inclusive with Stripe
 * Tax on (M-1 1a/1c), metadata `{ user_id, link_kind, pence }` (+ `first_week_wages_pence` on a balance link,
 * so the webhook can record it). Every link carries a Stripe customer (4-w5fix, W5-M3): the family's
 * `stripe_customer_id`, else one created with the parent's email and stored on the family's row when it has
 * one (the deposit webhook stores it for a family with no row yet) — so a refund of it traces back to the
 * family. Returns the URL for the admin to copy.
 *
 * `setFamilyAccess` — the admin access toggle (ADR-093, card 7b): on / off / null (no override) with a reason,
 * written to the toggle columns and audited as `access.toggled`.
 *
 * Contract: `requireAdmin()` first, before any read, write or Stripe call. Never trusts a client amount except
 * `custom` (admin-typed, validated). Every amount comes from `@/config/prices` / `@/config/offer`.
 */
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { getStripeClient } from "@/lib/stripe/client";
import { PRICES, VAT } from "@/config/prices";
import { PAYMENT_LINK_PRESETS, type PaymentLinkPreset } from "@/config/offer";
import { SITE_NAME, SITE_URL } from "@/lib/constants";
import { balanceAfterWeek1Pence, wagesPenceFromSnapshot } from "@/lib/payments/dfy-access";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
/** Stripe's ceiling for one amount in the smallest unit (8 digits). */
const STRIPE_MAX_AMOUNT = 99_999_999;
const REASON_MAX = 500;

const PRESET_NAMES: Record<PaymentLinkPreset, string> = {
  deposit: "Deposit",
  "balance-after-week-1": "Balance after week one",
  custom: "Payment",
};

export type DfyLinkResult =
  | { success: true; data: { url: string; pence: number } }
  | { success: false; error: string };

interface SubRow {
  id: string;
  status: string;
  family_type: string | null;
  deposit_paid_at: string | null;
  payment_due_at: string | null;
  bill_paid_at: string | null;
  stripe_customer_id: string | null;
  placement_id: string | null;
  access_toggled_on: boolean | null;
}

type Admin = ReturnType<typeof createAdminClient>;

async function readSub(admin: Admin, parentUserId: string): Promise<SubRow | null> {
  const { data, error } = await admin
    .from("parent_subscriptions")
    .select(
      "id, status, family_type, deposit_paid_at, payment_due_at, bill_paid_at, stripe_customer_id, placement_id, access_toggled_on",
    )
    .eq("parent_user_id", parentUserId)
    .maybeSingle<SubRow>();
  if (error) throw new Error(`subscription read failed: ${error.message}`);
  return data;
}

/** First week's wages from the placement snapshot (`weekly_hours × hourly_rate`, rate in pounds). */
async function snapshotWagesPence(admin: Admin, placementId: string | null): Promise<number | null> {
  if (!placementId) return null;
  const { data } = await admin
    .from("nanny_placements")
    .select("weekly_hours, hourly_rate")
    .eq("id", placementId)
    .maybeSingle<{ weekly_hours: number | string | null; hourly_rate: number | string | null }>();
  return wagesPenceFromSnapshot(data?.weekly_hours, data?.hourly_rate);
}

/**
 * The Stripe customer every link is minted on (4-w5fix, W5-M3). Reuses the row's; else creates one with the
 * parent's email (idempotent per parent for Stripe's 24 h key window, so a double click mints one customer)
 * and stores it on the row — never over an existing id. A failed store throws: no link without a traceable
 * customer.
 */
async function customerFor(
  admin: Admin,
  parentUserId: string,
  sub: SubRow | null,
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
    if (error) throw new Error(`customer store failed: ${error.message}`);
  }
  return customer.id;
}

const isWholePence = (n: unknown): n is number =>
  typeof n === "number" && Number.isInteger(n) && n > 0 && n <= STRIPE_MAX_AMOUNT;

async function amountFor(
  admin: Admin,
  preset: PaymentLinkPreset,
  sub: SubRow | null,
  opts: { firstWeekWagesPence?: number; customPence?: number },
): Promise<{ pence: number; wages?: number } | { error: string }> {
  if (preset === "deposit") {
    // No double charge (code review MEDIUM): a paid deposit is never minted again; `custom` covers exceptions.
    return sub?.deposit_paid_at ? { error: "deposit_already_paid" } : { pence: PRICES.dfy.depositPence };
  }
  if (!sub) return { error: "no_subscription_row" };
  if (preset === "custom") {
    return isWholePence(opts.customPence) ? { pence: opts.customPence } : { error: "invalid_amount" };
  }
  if (sub.bill_paid_at) return { error: "bill_already_paid" };
  if (!sub.payment_due_at || Date.parse(sub.payment_due_at) > Date.now()) return { error: "payment_not_due" };
  const wages = opts.firstWeekWagesPence ?? (await snapshotWagesPence(admin, sub.placement_id));
  if (wages === null || wages === undefined) return { error: "wages_required" };
  if (!Number.isInteger(wages) || wages < 0 || wages > STRIPE_MAX_AMOUNT) return { error: "invalid_amount" };
  const pence = balanceAfterWeek1Pence({ depositPaid: !!sub.deposit_paid_at, firstWeekWagesPence: wages });
  return pence > 0 ? { pence, wages } : { error: "nothing_due" };
}

export async function createDfyPaymentLink(
  parentUserId: string,
  preset: PaymentLinkPreset,
  opts: { firstWeekWagesPence?: number; customPence?: number } = {},
): Promise<DfyLinkResult> {
  const { error: authErr } = await requireAdmin();
  if (authErr) return { success: false, error: authErr };
  if (typeof parentUserId !== "string" || !UUID_RE.test(parentUserId)) {
    return { success: false, error: "invalid_parent" };
  }
  if (!(PAYMENT_LINK_PRESETS as readonly string[]).includes(preset)) {
    return { success: false, error: "invalid_preset" };
  }

  try {
    const admin = createAdminClient();
    const sub = await readSub(admin, parentUserId);
    const amount = await amountFor(admin, preset, sub, opts);
    if ("error" in amount) return { success: false, error: amount.error };

    const { data: profile } = await admin
      .from("user_profiles")
      .select("email")
      .eq("user_id", parentUserId)
      .maybeSingle<{ email: string | null }>();

    const metadata: Record<string, string> = {
      user_id: parentUserId,
      link_kind: preset,
      pence: String(amount.pence),
      ...(amount.wages !== undefined ? { first_week_wages_pence: String(amount.wages) } : {}),
    };
    const customer = await customerFor(admin, parentUserId, sub, profile?.email ?? null);
    const session = await getStripeClient().checkout.sessions.create({
      mode: "payment",
      customer,
      customer_update: { address: "auto", name: "auto" },
      client_reference_id: parentUserId,
      line_items: [
        {
          quantity: 1,
          price_data: {
            currency: PRICES.currency,
            unit_amount: amount.pence,
            tax_behavior: VAT.inclusive ? "inclusive" : "exclusive",
            product_data: { name: `${SITE_NAME} — ${PRESET_NAMES[preset]}` },
          },
        },
      ],
      automatic_tax: { enabled: VAT.stripeTaxEnabled },
      billing_address_collection: "required",
      success_url: `${SITE_URL}/parent`,
      cancel_url: `${SITE_URL}/parent`,
      metadata,
      payment_intent_data: { metadata },
    });
    if (!session.url) return { success: false, error: "stripe_error" };
    return { success: true, data: { url: session.url, pence: amount.pence } };
  } catch (err) {
    console.error("[createDfyPaymentLink] failed:", err instanceof Error ? err.message : "unknown");
    return { success: false, error: "stripe_error" };
  }
}

export async function setFamilyAccess(
  parentUserId: string,
  on: boolean | null,
  reason: string,
): Promise<{ success: boolean; error: string | null }> {
  const { userId: adminId, error: authErr } = await requireAdmin();
  if (authErr) return { success: false, error: authErr };
  if (typeof parentUserId !== "string" || !UUID_RE.test(parentUserId)) {
    return { success: false, error: "invalid_parent" };
  }
  if (on !== true && on !== false && on !== null) return { success: false, error: "invalid_toggle" };
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  if (trimmed.length < 3 || trimmed.length > REASON_MAX) {
    return { success: false, error: "A short reason is required for the audit log." };
  }

  let admin: Admin;
  let sub: SubRow | null;
  try {
    admin = createAdminClient();
    sub = await readSub(admin, parentUserId);
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : "read failed" };
  }
  if (!sub) return { success: false, error: "no_subscription_row" };

  const { error: upErr } = await admin
    .from("parent_subscriptions")
    .update({
      access_toggled_on: on,
      access_toggled_at: new Date().toISOString(),
      access_toggled_by: adminId,
      access_toggle_reason: trimmed,
    })
    .eq("id", sub.id);
  if (upErr) return { success: false, error: `Update failed: ${upErr.message}` };

  const { error: logErr } = await admin.from("activity_logs").insert({
    user_id: parentUserId,
    action_type: "access.toggled",
    action_details: { admin_id: adminId, previous: sub.access_toggled_on, next: on, reason: trimmed },
  });
  // The toggle stands; a lost audit row is reported, not swallowed.
  if (logErr) console.error("[setFamilyAccess] could not write access.toggled:", logErr.message);

  revalidatePath(`/admin/users/${parentUserId}/subscription`);
  revalidatePath("/admin/subscriptions");
  return { success: true, error: null };
}
