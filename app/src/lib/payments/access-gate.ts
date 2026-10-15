/**
 * Server-side family access gate.
 *
 * Every server action that reads or writes `bapp_logs`, `bapp_progress_*`,
 * or any other paywalled surface calls `requireFamilyAccess(parentUserId)`
 * at the top. If access is denied, the action returns
 * `{ success: false, error: 'subscription_required' }` so the UI can
 * render the paywall.
 *
 * Spec: `system/APP/PAYMENTS/05-trial-and-access-gates.md §2` (defence-
 * in-depth at app + RLS layer).
 *
 * Behaviour mirrors `family_has_access()` PG function — but in TS so
 * server actions can short-circuit BEFORE doing any DB work, and so
 * we can return a structured reason for the UI to act on (e.g. show
 * "trial expired — subscribe to restore access" vs "your card was
 * declined — update payment method").
 *
 * Test users (`user_profiles.is_test_user = TRUE`) ALWAYS pass — they
 * have unconditional access regardless of subscription state.
 *
 * London order (4c, amendment 12 — mirrors `family_has_access()`): test user →
 * admin toggle (`access_toggled_on` not null wins, ADR-093) → `placed` = access
 * (ADR-093) → Sydney's clauses unchanged. `deposit_paid` is paid with NO access
 * (ADR-097) → `awaiting_placement`.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { SubscriptionStatus } from "@/types/payments";

export type AccessGateReason =
  | "ok"
  | "no_subscription"
  | "trial_expired"
  | "subscription_lapsed"
  | "past_due_grace_expired"
  | "subscription_cancelled_window_ended"
  | "access_off_by_admin"
  | "awaiting_placement";

export interface AccessGateResult {
  hasAccess: boolean;
  reason: AccessGateReason;
  /**
   * When `hasAccess` is false, the timestamp at which access ended
   * (trial expiry, paid period end, etc.). Used by the UI to display
   * "your trial ended on …" copy.
   */
  endedAt?: string;
}

const OK: AccessGateResult = { hasAccess: true, reason: "ok" };

/**
 * Returns whether the parent user has active family access.
 *
 * Equivalent to the PG `family_has_access()` function but TS-side so
 * server actions can short-circuit before any DB read. Both layers
 * exist deliberately (defence in depth):
 * - PG function for RLS policies + cron jobs
 * - This TS helper for server actions to fast-fail
 *
 * NEVER call this from client components — server-only.
 */
export async function requireFamilyAccess(
  parentUserId: string,
): Promise<AccessGateResult> {
  if (!parentUserId) {
    return { hasAccess: false, reason: "no_subscription" };
  }

  const admin = createAdminClient();

  // Test-user bypass — short-circuit. Test accounts have unconditional
  // access regardless of subscription state. Mirrors the PG function's
  // first check.
  const { data: profile } = await admin
    .from("user_profiles")
    .select("is_test_user")
    .eq("user_id", parentUserId)
    .maybeSingle<{ is_test_user: boolean }>();
  if (profile?.is_test_user) {
    return OK;
  }

  // Subscription state lookup. One row per parent (UNIQUE index on
  // parent_subscriptions.parent_user_id).
  const { data: sub } = await admin
    .from("parent_subscriptions")
    .select(
      "status, trial_ends_at, paid_period_ends_at, past_due_grace_ends_at, access_toggled_on",
    )
    .eq("parent_user_id", parentUserId)
    .maybeSingle<{
      status: SubscriptionStatus;
      trial_ends_at: string | null;
      paid_period_ends_at: string | null;
      past_due_grace_ends_at: string | null;
      access_toggled_on: boolean | null;
    }>();

  if (!sub) {
    return { hasAccess: false, reason: "no_subscription" };
  }

  // Admin toggle overrides every state (ADR-093, card 7b). NULL = no override.
  if (sub.access_toggled_on === true) return OK;
  if (sub.access_toggled_on === false) {
    return { hasAccess: false, reason: "access_off_by_admin" };
  }

  const now = new Date();

  switch (sub.status) {
    case "placed":
      return OK;
    case "deposit_paid":
      return { hasAccess: false, reason: "awaiting_placement" };
    case "trial": {
      const ends = sub.trial_ends_at ? new Date(sub.trial_ends_at) : null;
      if (ends && ends > now) return OK;
      return {
        hasAccess: false,
        reason: "trial_expired",
        endedAt: sub.trial_ends_at ?? undefined,
      };
    }
    case "active_monthly":
    case "active_upfront": {
      const ends = sub.paid_period_ends_at
        ? new Date(sub.paid_period_ends_at)
        : null;
      if (ends && ends > now) return OK;
      // Paid period elapsed without renewal — treated as lapsed at the
      // app layer even if the cron hasn't flipped the status yet.
      return {
        hasAccess: false,
        reason: "subscription_lapsed",
        endedAt: sub.paid_period_ends_at ?? undefined,
      };
    }
    case "past_due": {
      const ends = sub.past_due_grace_ends_at
        ? new Date(sub.past_due_grace_ends_at)
        : null;
      if (ends && ends > now) return OK;
      return {
        hasAccess: false,
        reason: "past_due_grace_expired",
        endedAt: sub.past_due_grace_ends_at ?? undefined,
      };
    }
    case "cancelled": {
      // User cancelled but the paid period they already paid for still
      // runs out. After paid_period_ends_at they lose access.
      const ends = sub.paid_period_ends_at
        ? new Date(sub.paid_period_ends_at)
        : null;
      if (ends && ends > now) return OK;
      return {
        hasAccess: false,
        reason: "subscription_cancelled_window_ended",
        endedAt: sub.paid_period_ends_at ?? undefined,
      };
    }
    case "lapsed":
    default:
      return { hasAccess: false, reason: "subscription_lapsed" };
  }
}

/**
 * Convenience wrapper for actions that just need a yes/no without the
 * structured reason. Equivalent to `(await requireFamilyAccess(id)).hasAccess`.
 */
export async function hasFamilyAccess(parentUserId: string): Promise<boolean> {
  const result = await requireFamilyAccess(parentUserId);
  return result.hasAccess;
}

/**
 * Gate a write action by the child's family's subscription state.
 *
 * Resolves the parent for the child via `child_client.parent_user_id`,
 * then delegates to `requireFamilyAccess`. Nanny-initiated writes on
 * a child whose parent hasn't connected yet (`parent_user_id IS NULL`)
 * pass — the child is in the nanny-only setup window which is
 * gate-free by design (see business model §5 soft-lock).
 *
 * Used by every server action that writes to `bapp_logs` or
 * `bapp_progress_*` to defend against direct API calls bypassing the
 * UI paywall.
 *
 * Spec: `system/APP/PAYMENTS/05-trial-and-access-gates.md §2`.
 */
export async function requireChildFamilyAccess(
  childId: string,
): Promise<AccessGateResult> {
  if (!childId) {
    return { hasAccess: false, reason: "no_subscription" };
  }
  const admin = createAdminClient();
  const { data: child } = await admin
    .from("child_client")
    .select("parent_user_id")
    .eq("id", childId)
    .maybeSingle<{ parent_user_id: string | null }>();

  // Nanny-only child (no parent linked yet): not gated by family
  // subscription. The soft-lock cron + UI handle the long-term case
  // where a nanny-only child remains unlinked for >30 days.
  if (!child || !child.parent_user_id) {
    return OK;
  }
  return requireFamilyAccess(child.parent_user_id);
}
