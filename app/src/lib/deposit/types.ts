/**
 * Brief 03's shared shapes (plan 03 §3; amendment 18). Client-safe: types and two frozen lists, every field readonly.
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */

import type { CohortView } from "@/lib/cohorts/types";

/** A link's states, as amendment 18's CHECK spells them. */
export const DEPOSIT_LINK_STATES = Object.freeze(["open", "paid", "cancelled"] as const);
export type DepositLinkState = (typeof DEPOSIT_LINK_STATES)[number];

/** What a link offers: the current cohort, or a pinned next-week cohort as goodwill (brief 03 §3 admin 2). */
export const DEPOSIT_TARGETS = Object.freeze(["current", "goodwill"] as const);
export type DepositTarget = (typeof DEPOSIT_TARGETS)[number];

/** What the page decides with about a link, in any state. `goodwillStartDate` is set exactly for a goodwill link. */
export interface DepositLinkFacts {
  readonly state: DepositLinkState;
  readonly target: DepositTarget;
  readonly goodwillStartDate: string | null;
}

/**
 * A link found by its code (`proveDepositCode`): never a cancelled one. The family is `parentUserId`, taken only from
 * this row (plan 03 D15). The code itself isn't carried: the caller already holds it.
 */
export interface VerifiedDepositLink extends DepositLinkFacts {
  readonly id: string;
  readonly parentUserId: string;
  readonly state: "open" | "paid";
  readonly lastOpenedAt: string | null;
}

/** Her own live hold, if she pressed Pay and is on Stripe's page (or came back). */
export interface OwnHold {
  readonly cohortStartDate: string;
  readonly isGoodwill: boolean;
}

/** The three cohorts the page needs, as 02's `findCohorts` returns them. */
export interface DepositCohorts {
  readonly current: CohortView | null;
  readonly next: CohortView | null;
  readonly nextAvailable: CohortView | null;
}

export interface DepositPageInput {
  /** null when no link has this code. */
  readonly link: DepositLinkFacts | null;
  /** The family's `parent_subscriptions.deposit_paid_at`: set by a card, a bank transfer or an old preset. */
  readonly depositPaidAt: string | null;
  readonly cohorts: DepositCohorts;
  readonly ownHold: OwnHold | null;
}

/** What the parent's page shows (plan 03 §3 "Page state"). `nextAvailable` is the cohort "Pre-book" offers. */
export type DepositPageState =
  | { readonly kind: "invalid" }
  | { readonly kind: "paid" }
  | { readonly kind: "bookable"; readonly start: string; readonly goodwill: boolean }
  | { readonly kind: "being_paid"; readonly nextAvailable: string | null }
  | { readonly kind: "full"; readonly nextAvailable: string | null };
