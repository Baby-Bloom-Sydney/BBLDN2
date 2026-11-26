/**
 * Matching a JustCall call to a parent (plan 05 §5 A6, R7; brief §0.9, §0.10, §3 edges).
 *
 * - The key is **her** number only: JustCall's `contact_number` (digits, no "+"; bare `44…` handled) through
 *   `normaliseUkMobile` to E.164, compared exactly with parents' stored mobiles (stored E.164, P-5). Our own JustCall
 *   number is never an input, so moving from the mobile to the 020 number needs no change (§0.10).
 * - Anything that isn't a UK mobile can't be a parent's number → none, with no read.
 * - One parent → matched. None → Unmatched "No family with this number". Two or more → Unmatched "Number on more than
 *   one family" — never guessed.
 * - A failed read → error: the event stays `unresolved` for a replay rather than landing in Unmatched by mistake.
 * - "Parents" are `user_roles.role = 'parent'` (the reader's job; plan R7 named `user_profiles.role`, which doesn't
 *   exist — LEDGER/B05 §0).
 *
 * BB-wave2-231126/05-build, 2026-11-26.
 */

import { isUkMobile, normaliseUkMobile } from "@/lib/uk-contact";

export type MatchResult =
  | { readonly kind: "one"; readonly parentUserId: string }
  | { readonly kind: "none" }
  | { readonly kind: "several" };

/** The user ids of parents whose stored mobile is exactly this E.164 number. */
export type ParentsByMobile = (
  e164: string,
) => Promise<{ readonly ok: true; readonly value: readonly string[] } | { readonly ok: false }>;

export type MatchOutcome = { readonly ok: true; readonly value: MatchResult } | { readonly ok: false };

const NONE: MatchOutcome = Object.freeze({ ok: true, value: Object.freeze({ kind: "none" }) });

export async function matchParent(contactNumber: string | null, parentsByMobile: ParentsByMobile): Promise<MatchOutcome> {
  if (contactNumber === null || !isUkMobile(contactNumber)) return NONE;
  const read = await parentsByMobile(normaliseUkMobile(contactNumber));
  if (!read.ok) return { ok: false };
  const ids = [...new Set(read.value)];
  if (ids.length === 0) return NONE;
  if (ids.length > 1) return { ok: true, value: { kind: "several" } };
  return { ok: true, value: { kind: "one", parentUserId: ids[0] } };
}
