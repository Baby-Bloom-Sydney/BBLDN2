/**
 * The offer's terms as numbers (LDN2 Stage 4, unit 4-0). Source of truth:
 * `LDN/TARGET/offer/README.md` and ADR-082…100. Every value carries its source;
 * a value with no source in the offer or an ADR is not added here (P-25).
 *
 * Objects are frozen at every level (`as const` for the types, `Object.freeze` at
 * runtime); the plain numbers are immutable `const` bindings.
 */

/** First week on us: discount ≤ 15 per hour × ≤ 40 contracted hours, in pence (ADR-100, offer §2). */
export const FIRST_WEEK_DISCOUNT_CAP = Object.freeze({
  hourlyPence: 1_500, // ADR-100
  maxHours: 40, // ADR-100 — hours from the parent–nanny contract
} as const);

/**
 * G1 — a nanny you'll love within this many days of our call (ADR-088).
 * 14 at launch; 7 once the calendar proves it. Test value — offer §9.
 */
export const G1 = Object.freeze({ windowDays: 14 } as const);

/** G2 — full refund within this many days of the nanny's first day (ADR-088, offer §4). */
export const G2 = Object.freeze({ windowDays: 30 } as const);

/** G4 (mega) — offered only after this many placements (ADR-088; offer §4 "test only", §9). */
export const G4 = Object.freeze({ enabledAfterPlacements: 20 } as const);

/** The balance is billed this many days after the nanny's start (ADR-094, offer §3). */
export const BILL_AFTER_START_DAYS = 7;

/** Preset amounts on the manual payment portal (ADR-092, offer §3 mechanism). */
export const PAYMENT_LINK_PRESETS = Object.freeze([
  "deposit",
  "balance-after-week-1",
  "custom",
] as const);

export type PaymentLinkPreset = (typeof PAYMENT_LINK_PRESETS)[number];
