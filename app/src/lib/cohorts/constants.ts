/**
 * Brief 02's fixed numbers (cohorts hold no money numbers). Client-safe.
 *
 * BB-wave1-041126/02-build, 2026-11-04.
 */

/** How long a place stays "being paid" while a parent is on Stripe's page (brief Q7, default accepted). */
export const HOLD_MINUTES = 30;
/** The database's bounds on a hold (amendment 17, cohort_hold_place). */
export const HOLD_MINUTES_MAX = 60;
/** Places in one cohort: a whole number from 0 (full) to 99 (brief §3.9). */
export const PLACES_MIN = 0;
export const PLACES_MAX = 99;
/** Repeat every N weeks (amendment 17, cohort_schedule). */
export const REPEAT_WEEKS_MIN = 1;
export const REPEAT_WEEKS_MAX = 12;
/** The form's suggestions: weekly, 5 places (brief §0.2, OPEN §5b "Why 5", §5e.7). */
export const SUGGESTED_REPEAT_WEEKS = 1;
export const SUGGESTED_PLACES = 5;
/** The upcoming list (brief §3.5). */
export const UPCOMING_COUNT = 8;
/** A re-open reason: the access toggle's rule (`src/lib/actions/admin/dfy.ts:216-219`, `:37`). */
export const REASON_MIN = 3;
export const REASON_MAX = 500;
/** The reason written when a full Stripe refund re-opens a place (no admin acted). */
export const REFUND_REOPEN_REASON = "Deposit fully refunded in Stripe";
/** The reason the warnings box suggests for a refunded place it re-opens. */
export const WARNING_REOPEN_REASON = "Deposit refunded in Stripe";
