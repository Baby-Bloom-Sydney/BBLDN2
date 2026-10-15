/**
 * London's prices — the single source of every amount BabyBloom charges
 * (LDN2 Stage 4, unit 4-0; ADR-092 "never literal", P-18). No amount is
 * written anywhere else in `src/`; the `money-literal` spec enforces it.
 *
 * Amounts are integer **pence**, named `*Pence`, in the currency below.
 * `PRICES` is the contract shared with unit 4f (`STAGE-4-MONEY/BUILD-PLAN/README.md`);
 * change its shape only with both units.
 *
 * Frozen at every level: `as const` for the types, `Object.freeze` so nothing
 * can change a price at runtime.
 */

export const PRICES = Object.freeze({
  dfy: Object.freeze({
    feePence: 150_000, // ADR-096 — test value, offer §9
    depositPence: 15_000, // ADR-097 — credited against the bill; test value, offer §9
  } as const),
  selfServe: Object.freeze({
    upfrontToAge3Pence: 200_000, // ADR-091 — app to the child's 3rd birthday (ADR-083)
    monthlyPence: 7_500, // ADR-091
  } as const),
  currency: "gbp", // offer §1 — Stripe's lower-case ISO code
} as const);

/** Days of access kept after a failed payment — the existing 7, kept (QUESTIONS 3a, P-25). */
export const GRACE_DAYS = 7;

/** Self-serve app access runs to the youngest linked child's 3rd birthday (ADR-083; all future children, ADR-084). */
export const ACCESS_AGE_YEARS = 3; // ADR-083

/** Self-serve app trial length; done-for-you families get no trial (ADR-093). */
export const TRIAL_DAYS = 30;

/** Prices include VAT; Stripe Tax is on for GB (M-1: 1a, 1c — 2026-10-14). */
export const VAT = Object.freeze({ inclusive: true, stripeTaxEnabled: true } as const);
