/**
 * Brief 02's pure rules (plan 02 §3, step 3). Client-safe: no I/O, every input readonly, every result new.
 *
 * - The cohort list is the schedule's grid (first + k × 7 × repeatWeeks days) plus every stored row; a stored row
 *   keeps its own date and places. Current = the latest start on or before today (London); upcoming = after today.
 * - Counts: taken = taken rows; being paid = live holds; left = max(0, places − taken − being paid);
 *   over by = max(0, taken − places). The SQL counts the same way (amendment 17, cohort_counts).
 * - Bookable mirrors the SQL (plan R11): the current cohort, or the next one for a goodwill place only.
 *
 * BB-wave1-041126/02-build, 2026-11-04.
 */

import { addLondonDays } from "@/lib/timezone";
import {
  FIRST_START_YEAR_MAX,
  FIRST_START_YEAR_MIN,
  PLACES_MAX,
  PLACES_MIN,
  REASON_MAX,
  REASON_MIN,
  REPEAT_WEEKS_MAX,
  REPEAT_WEEKS_MIN,
} from "./constants";
import { belowTakenMessage, INVALID_DATE, INVALID_PLACES, INVALID_REASON, INVALID_REPEAT } from "./copy";
import { daysBetween, isLondonDate } from "./dates";
import type { CohortPlace, CohortSchedule, CohortSlot, CohortView, StoredCohort } from "./types";

const stepDays = (s: CohortSchedule): number => 7 * s.repeatWeeks;

/** Is this date on the schedule's grid? */
export function isOnSchedule(s: CohortSchedule, date: string): boolean {
  if (!isLondonDate(date)) return false;
  const offset = daysBetween(s.firstStartDate, date);
  return offset >= 0 && offset % stepDays(s) === 0;
}

/** The grid's cohort on or before today, or null before the first start. */
function gridCurrent(s: CohortSchedule, today: string): string | null {
  const offset = daysBetween(s.firstStartDate, today);
  if (offset < 0) return null;
  return addLondonDays(s.firstStartDate, Math.floor(offset / stepDays(s)) * stepDays(s));
}

/** The first `count` grid dates after today. */
export function scheduleDatesAfter(s: CohortSchedule, today: string, count: number): readonly string[] {
  const current = gridCurrent(s, today);
  const first = current === null ? s.firstStartDate : addLondonDays(current, stepDays(s));
  return Array.from({ length: count }, (_, k) => addLondonDays(first, k * stepDays(s)));
}

const byDate = (a: CohortSlot, b: CohortSlot): number => (a.startDate < b.startDate ? -1 : a.startDate > b.startDate ? 1 : 0);

export interface CohortSlots {
  readonly current: CohortSlot | null;
  readonly upcoming: readonly CohortSlot[];
  readonly past: readonly CohortSlot[];
}

/** The merged list around today: current, the next `count`, and stored cohorts before the current one. */
export function cohortSlots(
  s: CohortSchedule | null,
  stored: readonly StoredCohort[],
  today: string,
  count: number,
): CohortSlots {
  const storedSlots = new Map(stored.map((c) => [c.startDate, { startDate: c.startDate, places: c.places, stored: true }]));
  const slot = (date: string): CohortSlot => storedSlots.get(date) ?? { startDate: date, places: s?.defaultPlaces ?? 0, stored: false };
  const grid = s === null ? [] : scheduleDatesAfter(s, today, count);
  const gridNow = s === null ? null : gridCurrent(s, today);
  const onOrBefore = [...stored.map((c) => c.startDate).filter((d) => d <= today), ...(gridNow === null ? [] : [gridNow])].sort();
  const currentDate = onOrBefore.length > 0 ? onOrBefore[onOrBefore.length - 1] : null;
  const after = [...new Set([...grid, ...stored.map((c) => c.startDate).filter((d) => d > today)])].sort();
  const past = [...storedSlots.values()].filter((c) => currentDate !== null && c.startDate < currentDate).sort(byDate).reverse();
  return {
    current: currentDate === null ? null : slot(currentDate),
    upcoming: after.slice(0, count).map(slot),
    past,
  };
}

export interface PlaceCounts {
  readonly taken: number;
  readonly beingPaid: number;
  readonly goodwillTaken: number;
  readonly reopened: number;
}

/** A hold still being paid: lapsed holds simply stop counting (no job). */
export const isLiveHold = (p: CohortPlace, now: Date): boolean =>
  p.state === "held" && p.holdExpiresAt !== null && Date.parse(p.holdExpiresAt) > now.getTime();

/** One cohort's counts from its place rows. */
export function countsOf(places: readonly CohortPlace[], start: string, now: Date): PlaceCounts {
  const mine = places.filter((p) => p.cohortStartDate === start);
  return {
    taken: mine.filter((p) => p.state === "taken").length,
    beingPaid: mine.filter((p) => isLiveHold(p, now)).length,
    goodwillTaken: mine.filter((p) => p.state === "taken" && p.isGoodwill).length,
    reopened: mine.filter((p) => p.state === "reopened").length,
  };
}

/** A cohort's numbers: left never below 0; over by when taken passed places (a late payment, brief §0.10). */
export function viewOf(start: string, places: number, counts: Pick<PlaceCounts, "taken" | "beingPaid">): CohortView {
  return {
    start,
    places,
    taken: counts.taken,
    beingPaid: counts.beingPaid,
    left: Math.max(0, places - counts.taken - counts.beingPaid),
    overBy: Math.max(0, counts.taken - places),
  };
}

/** The first upcoming cohort with a place left (03's "Pre-book next available cohort"). */
export function nextAvailable(upcoming: readonly CohortView[]): CohortView | null {
  return upcoming.find((v) => v.left > 0) ?? null;
}

/** The SQL's bookable rule (plan R11): current without goodwill; next only as goodwill; nothing before the first. */
export function isBookable(start: string, goodwill: boolean, currentStart: string | null, nextStart: string | null): boolean {
  if (currentStart === null) return false;
  return goodwill ? start === nextStart : start === currentStart;
}

/** Full on the call: goodwill takes one of next week's places (brief §2, ratified 2026-11-04). */
export function canOfferGoodwill(current: CohortView | null, next: CohortView | null): boolean {
  return current !== null && next !== null && current.left === 0 && next.left > 0;
}

const WHOLE = /^\d+$/;

/** A whole number from 0 to 99, from a form field or a number; anything else is null. */
export function parsePlaces(raw: unknown): number | null {
  return parseWhole(raw, PLACES_MIN, PLACES_MAX);
}

function parseWhole(raw: unknown, min: number, max: number): number | null {
  const text = typeof raw === "number" ? (Number.isInteger(raw) ? String(raw) : "") : typeof raw === "string" ? raw.trim() : "";
  if (!WHOLE.test(text)) return null;
  const n = Number(text);
  return n >= min && n <= max ? n : null;
}

export type Refusal<E extends string> = { readonly ok: false; readonly error: E; readonly message: string };

/** A places edit: refused below what's already taken or being paid for (brief §0.4). */
export function validatePlacesChange(
  raw: unknown,
  takenOrHeld: number,
): { readonly ok: true; readonly places: number } | Refusal<"invalid_places" | "below_taken"> {
  const places = parsePlaces(raw);
  if (places === null) return { ok: false, error: "invalid_places", message: INVALID_PLACES };
  if (places < takenOrHeld) return { ok: false, error: "below_taken", message: belowTakenMessage(takenOrHeld) };
  return { ok: true, places };
}

/** The schedule form: a London date, every 1–12 weeks, 0–99 places. */
export function validateSchedule(
  input: unknown,
): { readonly ok: true; readonly schedule: CohortSchedule } | Refusal<"invalid_date" | "invalid_repeat" | "invalid_places"> {
  const fields = typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {};
  const first = typeof fields.firstStartDate === "string" ? fields.firstStartDate.trim() : "";
  const year = Number(first.slice(0, 4));
  if (!isLondonDate(first) || year < FIRST_START_YEAR_MIN || year > FIRST_START_YEAR_MAX) {
    return { ok: false, error: "invalid_date", message: INVALID_DATE };
  }
  const repeatWeeks = parseWhole(fields.repeatWeeks, REPEAT_WEEKS_MIN, REPEAT_WEEKS_MAX);
  if (repeatWeeks === null) return { ok: false, error: "invalid_repeat", message: INVALID_REPEAT };
  const defaultPlaces = parsePlaces(fields.defaultPlaces);
  if (defaultPlaces === null) return { ok: false, error: "invalid_places", message: INVALID_PLACES };
  return { ok: true, schedule: { firstStartDate: first, repeatWeeks, defaultPlaces } };
}

/** A re-open reason: 3 to 500 characters once trimmed. */
export function validateReason(raw: unknown): { readonly ok: true; readonly reason: string } | Refusal<"invalid_reason"> {
  const reason = typeof raw === "string" ? raw.trim() : "";
  if (reason.length < REASON_MIN || reason.length > REASON_MAX) return { ok: false, error: "invalid_reason", message: INVALID_REASON };
  return { ok: true, reason };
}

/** Stripe marks a charge `refunded` only once it is fully refunded; a partial refund keeps the place (brief Q5). */
export function isFullyRefunded(charge: { readonly refunded?: boolean | null }): boolean {
  return charge.refunded === true;
}
