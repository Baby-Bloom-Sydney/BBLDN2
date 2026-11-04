/**
 * Pending cohort pre-book requests — a stub that brief 03 wires in wave 2 (plan §7 "For 03", §12 R10).
 *
 * When the day the next cohort opens is full, 03 records its own pre-booking (03 §5.4; 04 adds no pre-booking
 * table). A family with a pending request is back in the to-call list, tagged "Cohort pre-book", and her page says
 * "We'll call you on Monday 8 February" (brief §11 Q9). Until 03 lands, no family has one.
 *
 * BB-wave1-041126/04a-core, 2026-11-04.
 */

export interface PrebookRequest {
  /** The London date the family asked for ("YYYY-MM-DD"). */
  readonly londonDate: string;
}

/** parent user id → her pending request, for the families asked about. */
export type PrebookRequestSource = (parentUserIds: readonly string[]) => Promise<ReadonlyMap<string, PrebookRequest>>;

export const readPendingPrebookRequests: PrebookRequestSource = async () => new Map();
