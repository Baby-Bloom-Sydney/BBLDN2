/**
 * The offer's terms as numbers (LDN2 Stage 4, unit 4-0). Source of truth:
 * `LDN/TARGET/offer/README.md` and ADR-082…100. Every value carries its source;
 * a value with no source in the offer or an ADR is not added here (P-25).
 *
 * Objects are frozen at every level (`as const` for the types, `Object.freeze` at
 * runtime); the plain numbers are immutable `const` bindings.
 */

/**
 * The first week comes off the bill at a flat rate, whatever the nanny's own rate, for at most this many hours
 * (OPEN-call-and-deposit §5d.1 as amended by §5e.2 — BAI 2026-11-04). Most off the bill: rate × cap, derived,
 * never stored. The hours themselves are not config: they come from the nanny's first-week invoice (brief 06),
 * and BAI can edit them before approving the bill (brief 07).
 */
export const FIRST_WEEK_OFF_BILL = Object.freeze({
  flatHourlyPence: 2_000, // §5d.1 / §5e.2 — 2026-11-04
  maxHours: 37.5, // §5e.2 — 2026-11-04; half-hour steps (06 invoices in 0.5 h), so rate × hours is whole pence
} as const);

/**
 * Retired 2026-11-04 (OPEN §5d): the September first-week rule (≤ 15 an hour × ≤ 40 contracted hours, ADR-100).
 * Read only by the flag-off path of brief 07 (kept under P-23, hide not delete); deleted in the post-switch-on clean-up.
 */
export const FIRST_WEEK_DISCOUNT_CAP = Object.freeze({
  hourlyPence: 1_500, // ADR-100
  maxHours: 40, // ADR-100 — hours from the parent–nanny contract
} as const);

/**
 * G1 — a nanny you'll love within this many days of our call (ADR-088).
 * Retired 2026-11-04 (OPEN §5d: G1 becomes the case-by-case goodwill bonus). Read only by the flag-off path of
 * brief 08 (kept under P-23); deleted in the post-switch-on clean-up.
 */
export const G1 = Object.freeze({ windowDays: 14 } as const);

/**
 * G2 — the one-month guarantee: refund of the fee actually paid, keep the app; 30 days from the chosen nanny's
 * first day, moving if a later nanny is placed, once per family (OPEN §5d.5, §5e.6 — 2026-11-04).
 */
export const G2 = Object.freeze({ windowDays: 30 } as const);

/**
 * G4 (mega) — offered only after this many placements (ADR-088). Retired 2026-11-04 (OPEN §5d: G4 is "later").
 * Read only by the flag-off path of brief 08 (kept under P-23); deleted in the post-switch-on clean-up.
 */
export const G4 = Object.freeze({ enabledAfterPlacements: 20 } as const);

/** The balance is billed this many days after the nanny's start (ADR-094; OPEN §5d.7, kept 2026-11-04). */
export const BILL_AFTER_START_DAYS = 7;

/** Preset amounts on the manual payment portal (ADR-092, offer §3 mechanism). */
export const PAYMENT_LINK_PRESETS = Object.freeze([
  "deposit",
  "balance-after-week-1",
  "custom",
] as const);

export type PaymentLinkPreset = (typeof PAYMENT_LINK_PRESETS)[number];

/**
 * Weekly usage check (offer §7.4, ADR-092, runbook SOP 16 / M11): a linked child with fewer active posts than
 * this in the window marks the family low for the week. 06-runbook O-18 `[unverified]` — test value, BAI sets.
 */
export const USAGE_LOW_THRESHOLD_PER_CHILD_PER_WEEK = 1; // 06-runbook O-18 [unverified] — test value, BAI sets

/** The usage check looks back this many days (offer §7.4 "weekly"). */
export const USAGE_CHECK_WINDOW_DAYS = 7;
