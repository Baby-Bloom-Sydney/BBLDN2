/**
 * Pending cohort pre-book requests (plan §7 "For 03", §12 R10), wired to brief 03 (plan 03 §8, row A8, D9).
 *
 * When the day the next cohort opens is full, 03 records its own pre-booking (03 §5.4; 04 adds no pre-booking
 * table). A family with a pending request is back in the to-call list, tagged "Cohort pre-book", and her page says
 * "We'll call you on Monday 8 February" (brief §11 Q9).
 *
 * - Deposit switch on (`depositLinkEnabled()`): 03's reader — her open pre-booking with no booking and no call
 *   logged after it was made. A failed read (or no admin client) rejects: `to-call.ts` turns that into its error
 *   path, never a silent "no requests".
 * - Off: no family has one (an empty map; no client is created).
 *
 * BB-wave1-041126/04a-core, 2026-11-04. Wired: BB-wave2-231126/03-build, 2026-11-25.
 */

import { readPendingPrebookRequests as readDepositPrebookRequests } from "@/lib/deposit/prebook";
import { depositLinkEnabled } from "@/lib/features/flags";
import { createAdminClient } from "@/lib/supabase/admin";

export interface PrebookRequest {
  /** The London date the family asked for ("YYYY-MM-DD"). */
  readonly londonDate: string;
}

/** parent user id → her pending request, for the families asked about. */
export type PrebookRequestSource = (parentUserIds: readonly string[]) => Promise<ReadonlyMap<string, PrebookRequest>>;

export const readPendingPrebookRequests: PrebookRequestSource = async (parentUserIds) =>
  depositLinkEnabled() ? readDepositPrebookRequests(createAdminClient(), parentUserIds) : new Map();
