/**
 * Env-level kill-switch flags for the payments system.
 *
 * Mirror of `src/lib/chat/flags.ts` pattern. Read once at module load with
 * trim-aware boolean parsing — defends against trailing-newline env values
 * from `echo "true" | vercel env add` style provisioning.
 *
 * Spec references:
 * - `system/APP/PAYMENTS/04-stripe-integration.md` §2 (env vars)
 * - `system/APP/PAYMENTS/02-business-model.md` §10 (kill-switch semantics)
 *
 * Default for `PAYMENTS_ENABLED` and `NEW_TRIALS_ENABLED` is **true**
 * (`payoutsEnabled()` is the exception: default off, see below). This
 * matches the staging/production rollout where the env vars are
 * explicitly set; any agent forgetting to wire the env vars in dev still
 * gets a working flow. To disable, set the env var to the literal string
 * `"false"` (case-insensitive). Anything else evaluates to true.
 *
 * Server-only — these flags must never be exposed via `NEXT_PUBLIC_*`.
 * Kill-switch state is privileged information. (Exception: the payouts
 * hide switch is inlined for client chrome — its state is not secret.)
 */

function parseBool(value: string | undefined, defaultValue: boolean): boolean {
  if (value === undefined) return defaultValue;
  const trimmed = value.trim();
  if (trimmed === "") return defaultValue;
  // Explicit "false" disables; everything else enables. Asymmetric so that
  // a typo (e.g. "Tre") fails safe to ON during launch.
  return trimmed.toLowerCase() !== "false" && trimmed !== "0";
}

/**
 * Master switch for the parent-subscription side of payments.
 *
 * When false, `createCheckoutSession` short-circuits with
 * `'payments_disabled'` and the Subscribe UI shows a maintenance message.
 * Webhook ingestion is **NOT** disabled by this flag — Stripe must keep
 * recording state changes for any in-flight subscriptions. This flag
 * gates *new* charges, not the back-end of already-charged customers.
 *
 * Default: true.
 */
export const PAYMENTS_ENABLED = parseBool(process.env.PAYMENTS_ENABLED, true);

/**
 * The one switch for the nanny payout / Stripe Connect / tax-ID surface.
 *
 * London (P-23, card 4b, unit 4a-i): the surface is **hidden, not deleted**.
 * Off unless the env var is the literal string "true" (trimmed) — absent
 * means hidden, and it is deliberately in no Vercel env. While off: the
 * `/nanny/payouts/**` pages and `/admin/payouts` call `notFound()`, the
 * payout API routes and both payout crons answer 404, the two Connect
 * server actions refuse with `'payouts_disabled'`, and the nav badge,
 * admin menu entry, settings "Contributions" branch and admin-lead tax-ID /
 * payout displays render nothing.
 *
 * Read at call time (tests flip it). Client components reach the same
 * expression because `next.config.mjs` inlines `PAYOUTS_ENABLED` at build;
 * flipping it therefore needs a rebuild. Fails closed: anything other than
 * "true" keeps the surface hidden.
 */
export function payoutsEnabled(): boolean {
  return process.env.PAYOUTS_ENABLED?.trim() === "true";
}

/**
 * Gate for kicking off NEW family trials (LDN2 4b, card 8a / M-9: wired).
 *
 * Read at call time by the two child-linking actions (`createChildAsParent`,
 * `connectChildInvite`): when false they skip `start_family_trial_if_first()`
 * entirely. Existing trials continue to expire normally; new links don't mint
 * new trials. Used to safely freeze acquisition without freezing billing.
 *
 * Default: true. Set in no environment; `"false"` / `"0"` turns it off.
 */
export function newTrialsEnabled(): boolean {
  return parseBool(process.env.NEW_TRIALS_ENABLED, true);
}

/** Module-load snapshot of {@link newTrialsEnabled}, kept for `getPaymentsFlags`. */
export const NEW_TRIALS_ENABLED = newTrialsEnabled();

export interface PaymentsFlags {
  PAYMENTS_ENABLED: boolean;
  PAYOUTS_ENABLED: boolean;
  NEW_TRIALS_ENABLED: boolean;
}

/**
 * Snapshot of every payments flag — useful for admin debugging surfaces.
 * Never expose this aggregate over a user-facing API.
 */
export function getPaymentsFlags(): PaymentsFlags {
  return {
    PAYMENTS_ENABLED,
    PAYOUTS_ENABLED: payoutsEnabled(),
    NEW_TRIALS_ENABLED: newTrialsEnabled(),
  };
}
