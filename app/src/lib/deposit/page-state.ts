/**
 * What the parent's deposit page shows (plan 03 §3 "Page state", D11; brief 03 §3 parent 1–9). Pure, client-safe.
 *
 * The rules, in order:
 * 1. No link, or a cancelled one → invalid.
 * 2. The deposit is paid (any way) or the link is paid → paid.
 * 3. Her own live hold → bookable at the hold's cohort: her Pay is in progress, and Pay hands back her session.
 * 4. The current cohort has a place → bookable there, not goodwill (this also covers a goodwill pin that has since
 *    become the current cohort).
 * 5. A goodwill link whose pin is still the next cohort, with a place → bookable there as goodwill. 02's bookable
 *    rule decides "still the next" (`isBookable`), so a pin that is past — or anything before the first cohort —
 *    is never offered.
 * 6. The cohort she would get (the current one, or her pinned next) is full only because places are being paid
 *    for → being paid.
 * 7. Otherwise → full.
 * Being paid and full carry the next available cohort, which "Pre-book" offers (null when there is none).
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */

import { isBookable } from "@/lib/cohorts/rules";
import type { CohortView } from "@/lib/cohorts/types";
import type { DepositCohorts, DepositLinkFacts, DepositPageInput, DepositPageState } from "./types";

const INVALID: DepositPageState = Object.freeze({ kind: "invalid" });
const PAID: DepositPageState = Object.freeze({ kind: "paid" });

const bookable = (start: string, goodwill: boolean): DepositPageState => Object.freeze({ kind: "bookable", start, goodwill });

/** No place left, yet fewer taken than places: the rest are live holds — someone is paying right now. */
const isBeingPaid = (v: CohortView | null): boolean => v !== null && v.left === 0 && v.taken < v.places;

/** The next cohort when a goodwill link may still have it (02's rule: the next one only, and only with a current). */
function pinnedNext(link: DepositLinkFacts, cohorts: DepositCohorts): CohortView | null {
  const { current, next } = cohorts;
  if (link.target !== "goodwill" || link.goodwillStartDate === null || next === null) return null;
  return isBookable(link.goodwillStartDate, true, current?.start ?? null, next.start) ? next : null;
}

export function depositPageState(input: DepositPageInput): DepositPageState {
  const { link, cohorts, ownHold } = input;
  if (link === null || link.state === "cancelled") return INVALID;
  if (input.depositPaidAt !== null || link.state === "paid") return PAID;
  if (ownHold !== null) return bookable(ownHold.cohortStartDate, ownHold.isGoodwill);
  if (cohorts.current !== null && cohorts.current.left > 0) return bookable(cohorts.current.start, false);
  const pinned = pinnedNext(link, cohorts);
  if (pinned !== null && pinned.left > 0) return bookable(pinned.start, true);
  const nextAvailable = cohorts.nextAvailable?.start ?? null;
  const kind = isBeingPaid(cohorts.current) || isBeingPaid(pinned) ? "being_paid" : "full";
  return Object.freeze({ kind, nextAvailable });
}
