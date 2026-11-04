/**
 * Brief 02's shared shapes (plan 02 §3, §8, §12 R13). Client-safe: types only, every field readonly.
 *
 * BB-wave1-041126/02-build, 2026-11-04.
 */

/** The one schedule row: cohorts are worked out from it (first + k × 7 × repeatWeeks days). */
export interface CohortSchedule {
  readonly firstStartDate: string;
  readonly repeatWeeks: number;
  readonly defaultPlaces: number;
}

/** A stored cohort: it keeps its own date and places once stored. */
export interface StoredCohort {
  readonly startDate: string;
  readonly places: number;
}

/** A cohort in the merged list (worked out from the schedule, or stored). */
export interface CohortSlot {
  readonly startDate: string;
  readonly places: number;
  readonly stored: boolean;
}

export type PlaceState = "held" | "hold_released" | "taken" | "reopened";
export type PaidBy = "card" | "bank_transfer";

/** One place row as the app reads it (amendment 17, cohort_places). */
export interface CohortPlace {
  readonly id: string;
  readonly cohortStartDate: string;
  readonly parentUserId: string;
  readonly state: PlaceState;
  readonly isGoodwill: boolean;
  readonly holdExpiresAt: string | null;
  readonly paidBy: PaidBy | null;
  readonly takenAt: string | null;
  readonly reopenedAt: string | null;
  readonly reopenReason: string | null;
}

/** A cohort's numbers (plan R13). `left` never below 0; `overBy` = max(0, taken − places). */
export interface CohortView {
  readonly start: string;
  readonly places: number;
  readonly taken: number;
  readonly beingPaid: number;
  readonly left: number;
  readonly overBy: number;
}

/** What 04's call page and the family panel read (plan R13). */
export type CurrentCohortSummary =
  | { readonly kind: "off" }
  | { readonly kind: "not_set_up" }
  | { readonly kind: "first_ahead"; readonly first: string }
  | { readonly kind: "current"; readonly view: CohortView }
  | { readonly kind: "error" };

/** Brief 04's "calls still to make this week", booked and not-yet-booked kept apart. */
export interface CallCounts {
  readonly booked: number;
  readonly notBooked: number;
}

/** A number 02 shows but doesn't own: never a stand-in 0 when it isn't known (brief §0.12). */
export type CallsFigure =
  | { readonly kind: "not_connected" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "counts"; readonly counts: CallCounts };

export type PreBookedFigure =
  | { readonly kind: "not_connected" }
  | { readonly kind: "unavailable" }
  | { readonly kind: "count"; readonly count: number };

/** A family in a cohort's list (brief §3.7). Lapsed and released holds aren't shown. */
export interface FamilyRow {
  readonly placeId: string;
  readonly parentUserId: string;
  readonly name: string;
  readonly state: "held" | "taken" | "reopened";
  readonly paidBy: PaidBy | null;
  readonly isGoodwill: boolean;
  readonly takenAt: string | null;
  readonly reopenedAt: string | null;
  readonly reopenReason: string | null;
}

export interface CohortEntry {
  readonly view: CohortView;
  readonly goodwillTaken: number;
  readonly reopened: number;
  readonly families: readonly FamilyRow[];
}

/** The warnings box (brief §3.8), each with its one fix. */
export type CohortWarning =
  | { readonly kind: "refunded_but_held"; readonly placeId: string; readonly parentUserId: string; readonly name: string; readonly cohortStartDate: string }
  | { readonly kind: "paid_without_place"; readonly parentUserId: string; readonly name: string }
  | { readonly kind: "over_capacity"; readonly cohortStartDate: string; readonly overBy: number };

/** Everything /admin/cohorts renders, read once on the server. */
export interface CohortBoard {
  readonly today: string;
  readonly suggestedFirst: string;
  readonly schedule: CohortSchedule | null;
  readonly current: CohortEntry | null;
  readonly next: CohortEntry | null;
  readonly upcoming: readonly CohortEntry[];
  readonly past: readonly CohortEntry[];
  readonly warnings: readonly CohortWarning[];
  readonly warningsTruncated: boolean;
  readonly calls: CallsFigure;
  readonly preBooked: PreBookedFigure;
}
