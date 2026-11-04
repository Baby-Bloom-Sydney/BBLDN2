/**
 * What screens may show of her bank details (brief §0.2, plan 06 step 4) and how the PDF prints them.
 * Fixture numbers only (11-22-33 / 87654321).
 * BB-wave1-041126/06a-build, 2026-11-04.
 */
import { describe, expect, it } from "vitest";
import { formatSortCode, maskAccountNumber, maskedDetailsLine, maskSortCode } from "./masking";

describe("masks", () => {
  it("show the sort code's last 2 and the account's last 4 (brief §0.2)", () => {
    expect(maskSortCode("56")).toBe("••-••-56");
    expect(maskAccountNumber("4321")).toBe("ending 4321");
    expect(maskedDetailsLine({ sortCodeLast2: "56", accountLast4: "4321" })).toBe("sort code ••-••-56, account ending 4321");
  });

  it("never print more than the mask, whatever they are given", () => {
    expect(maskSortCode("112233")).toBe("••-••-••");
    expect(maskAccountNumber("87654321")).toBe("ending ••••");
    expect(maskSortCode("5a")).toBe("••-••-••");
    expect(maskAccountNumber("")).toBe("ending ••••");
  });
});

describe("formatSortCode (the PDF only)", () => {
  it("prints six digits in pairs", () => {
    expect(formatSortCode("112233")).toBe("11-22-33");
  });

  it("refuses anything but six digits rather than print it", () => {
    for (const bad of ["11223", "1122334", "11-22-33", "abcdef"]) expect(() => formatSortCode(bad)).toThrow(RangeError);
  });
});
