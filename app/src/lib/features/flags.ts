/**
 * Build-time hide switches for product features London does not sell yet (Stage 5, P-23: hide, never delete).
 *
 * One switch per feature. Each is **off** unless its env var is the literal string "true" (trimmed). Absent
 * means hidden, and none of them is set in any environment. While off, the feature's routes answer 404
 * before any read, its nav entries are filtered out and whatever it gated counts as open. The code stays,
 * and setting the flag reopens it.
 *
 * Read at call time (tests flip them). Client components reach the same expression because `next.config.mjs`
 * inlines each variable at build (the 4a-i `PAYOUTS_ENABLED` pattern), so flipping one needs a rebuild. The
 * state is not secret: the hidden code ships either way.
 *
 * Sibling of `@/lib/payments/flags` (which keeps `payoutsEnabled()`).
 */

/** Fail-closed parse: only the literal "true" (trimmed) turns a hide switch on. */
function isOn(value: string | undefined): boolean {
  return value?.trim() === "true";
}

/**
 * The share-to-unlock viral loop (Stage 5 ruling 2, N-3; unit 5b).
 *
 * While off:
 * - `/nanny/share`, `/parent/matches/share`, `/parent/babysitting/[id]/share`, `/test/shareprofile` → `notFound()`.
 * - `/api/check-share-screenshot` → 404.
 * - The `viral-loop` server-action writers refuse with `"share_loop_disabled"`.
 * - The nav "Share Profile" entry and the funnel's share CTA are not rendered.
 * - `isShareUnlocked()` is true for everyone.
 */
export function shareLoopEnabled(): boolean {
  return isOn(process.env.SHARE_LOOP_ENABLED);
}

/**
 * Whether what the share loop gated is open for a nanny. When the loop is off, it is open for every nanny
 * from day 1. When it is on, the old rule applies: `nannies.visible_in_bsr === true`, which the DB trigger
 * chain sets on share approval.
 */
export function isShareUnlocked(visibleInBsr: boolean | null | undefined): boolean {
  return !shareLoopEnabled() || visibleInBsr === true;
}
