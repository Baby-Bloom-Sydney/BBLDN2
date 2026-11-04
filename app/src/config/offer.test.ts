/**
 * `config/offer.ts` holds the offer's terms as numbers (LDN2 Stage 4, unit
 * 4-0; ADR-092, `LDN/TARGET/offer/README.md`). Pins invariants, not copy.
 *
 * BB-LDN-4-0-141026, 2026-10-14.
 */

import { describe, expect, it } from "vitest";
import {
  BILL_AFTER_START_DAYS,
  FIRST_WEEK_DISCOUNT_CAP,
  FIRST_WEEK_OFF_BILL,
  G1,
  G2,
  G4,
  PAYMENT_LINK_PRESETS,
} from "./offer";

const isPositiveInteger = (n: unknown): boolean =>
  typeof n === "number" && Number.isInteger(n) && n > 0;

describe("FIRST_WEEK_DISCOUNT_CAP — ADR-100", () => {
  it("holds positive integers", () => {
    expect(isPositiveInteger(FIRST_WEEK_DISCOUNT_CAP.hourlyPence)).toBe(true);
    expect(isPositiveInteger(FIRST_WEEK_DISCOUNT_CAP.maxHours)).toBe(true);
  });

  it("caps the first week at 15 an hour for 40 hours, in pence", () => {
    const capPence = FIRST_WEEK_DISCOUNT_CAP.hourlyPence * FIRST_WEEK_DISCOUNT_CAP.maxHours;
    expect(capPence).toBe(15 * 40 * 100);
  });
});

describe("FIRST_WEEK_OFF_BILL — OPEN §5d.1 as amended by §5e.2 (2026-11-04)", () => {
  it("is a positive whole number of pence an hour", () => {
    expect(isPositiveInteger(FIRST_WEEK_OFF_BILL.flatHourlyPence)).toBe(true);
  });

  it("caps the hours at a positive multiple of half an hour", () => {
    expect(FIRST_WEEK_OFF_BILL.maxHours).toBeGreaterThan(0);
    expect(Number.isInteger(FIRST_WEEK_OFF_BILL.maxHours * 2)).toBe(true);
  });

  it("takes at most 750 pounds off the bill: flat rate × hour cap, in whole pence", () => {
    const maxOffPence = FIRST_WEEK_OFF_BILL.flatHourlyPence * FIRST_WEEK_OFF_BILL.maxHours;
    expect(Number.isInteger(maxOffPence)).toBe(true);
    expect(maxOffPence).toBe(75_000);
  });
});

describe("timing and the one-month guarantee — OPEN §5d.5, §5d.7, §5e.6 (2026-11-04)", () => {
  it("bills the balance 7 days after the nanny starts", () => {
    expect(BILL_AFTER_START_DAYS).toBe(7);
  });

  it("holds the one-month guarantee for 30 days from the chosen nanny's first day", () => {
    expect(G2.windowDays).toBe(30);
  });
});

describe("guarantees — ADR-088", () => {
  it("G1's window is 14 days at launch or 7 once proven, nothing else", () => {
    expect([7, 14]).toContain(G1.windowDays);
  });

  it("G2's window and G4's threshold are positive integers", () => {
    expect(isPositiveInteger(G2.windowDays)).toBe(true);
    expect(isPositiveInteger(G4.enabledAfterPlacements)).toBe(true);
  });
});

describe("BILL_AFTER_START_DAYS — ADR-094", () => {
  it("is a positive whole number of days", () => {
    expect(isPositiveInteger(BILL_AFTER_START_DAYS)).toBe(true);
  });
});

describe("PAYMENT_LINK_PRESETS — ADR-092, offer §3 mechanism", () => {
  it("lists the three preset kinds, in order", () => {
    expect(PAYMENT_LINK_PRESETS).toEqual(["deposit", "balance-after-week-1", "custom"]);
  });
});

describe("frozen — no runtime mutation", () => {
  it("freezes every exported object and the preset list", () => {
    for (const value of [FIRST_WEEK_DISCOUNT_CAP, FIRST_WEEK_OFF_BILL, G1, G2, G4, PAYMENT_LINK_PRESETS]) {
      expect(Object.isFrozen(value)).toBe(true);
    }
  });

  it("throws on an attempted write (ES modules run in strict mode)", () => {
    expect(() => {
      (G1 as { windowDays: number }).windowDays = 1;
    }).toThrow(TypeError);
    expect(() => {
      (PAYMENT_LINK_PRESETS as unknown as string[]).push("free");
    }).toThrow(TypeError);
  });
});
