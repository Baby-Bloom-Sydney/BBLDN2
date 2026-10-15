/**
 * `config/prices.ts` is London's single source for every price (LDN2 Stage 4,
 * unit 4-0; ADR-092 "never literal", P-18). These pins hold the invariants the
 * later money units (4f Stripe, 4b self-serve, 4c done-for-you, 4g copy) rely on.
 *
 * BB-LDN-4-0-141026, 2026-10-14.
 */

import { describe, expect, it } from "vitest";
import { GRACE_DAYS, PRICES, TRIAL_DAYS, VAT } from "./prices";

const isPositiveInteger = (n: unknown): boolean =>
  typeof n === "number" && Number.isInteger(n) && n > 0;

describe("PRICES — the shared contract with 4f (BUILD-PLAN/README.md)", () => {
  it("has exactly the contract's keys", () => {
    expect(Object.keys(PRICES).sort()).toEqual(["currency", "dfy", "selfServe"]);
    expect(Object.keys(PRICES.dfy).sort()).toEqual(["depositPence", "feePence"]);
    expect(Object.keys(PRICES.selfServe).sort()).toEqual([
      "monthlyPence",
      "upfrontToAge3Pence",
    ]);
  });

  it("charges in pounds sterling, Stripe's lower-case code", () => {
    expect(PRICES.currency).toBe("gbp");
  });

  it("holds every amount as a positive integer number of pence", () => {
    const amounts = [
      PRICES.dfy.feePence,
      PRICES.dfy.depositPence,
      PRICES.selfServe.upfrontToAge3Pence,
      PRICES.selfServe.monthlyPence,
    ];
    for (const amount of amounts) expect(isPositiveInteger(amount)).toBe(true);
  });

  it("keeps the done-for-you fee above the deposit credited against it (ADR-097)", () => {
    expect(PRICES.dfy.feePence).toBeGreaterThan(PRICES.dfy.depositPence);
  });
});

describe("GRACE_DAYS, TRIAL_DAYS", () => {
  it("are positive whole days", () => {
    expect(isPositiveInteger(GRACE_DAYS)).toBe(true);
    expect(isPositiveInteger(TRIAL_DAYS)).toBe(true);
  });
});

describe("VAT — M-1 (1a inclusive, 1c Stripe Tax on)", () => {
  it("is VAT-inclusive with Stripe Tax enabled", () => {
    expect(VAT).toEqual({ inclusive: true, stripeTaxEnabled: true });
  });
});

describe("frozen — no runtime mutation", () => {
  it("freezes PRICES at every level", () => {
    expect(Object.isFrozen(PRICES)).toBe(true);
    expect(Object.isFrozen(PRICES.dfy)).toBe(true);
    expect(Object.isFrozen(PRICES.selfServe)).toBe(true);
    expect(Object.isFrozen(VAT)).toBe(true);
  });

  it("throws on an attempted write (ES modules run in strict mode)", () => {
    expect(() => {
      (PRICES.dfy as { feePence: number }).feePence = 1;
    }).toThrow(TypeError);
    expect(() => {
      (VAT as { inclusive: boolean }).inclusive = false;
    }).toThrow(TypeError);
  });
});
