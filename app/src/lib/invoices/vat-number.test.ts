/**
 * A UK VAT number as it prints (b3.3): one formatter for the PDF and Settings, in a module the browser can load
 * (the PDF section imports the renderer). The PDF section re-exports this one, so its tests are unchanged.
 * BB-wave1-041126/06b3-build, 2026-11-07.
 */
import { describe, expect, it } from "vitest";
import { formatVatNumber as fromPdf } from "./pdf/sections/issuer";
import { formatVatNumber } from "./vat-number";

describe("formatVatNumber", () => {
  it("groups a 9- or 12-digit GB number; prints anything else as stored", () => {
    expect(formatVatNumber("GB123456789")).toBe("GB 123 4567 89");
    expect(formatVatNumber("GB123456789012")).toBe("GB 123 4567 89 012");
    expect(formatVatNumber("XX1")).toBe("XX1");
  });

  it("is the very function the PDF prints with", () => {
    expect(fromPdf).toBe(formatVatNumber);
  });
});
