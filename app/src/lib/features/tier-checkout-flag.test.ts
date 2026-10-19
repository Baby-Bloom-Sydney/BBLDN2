/**
 * Unit 5g (BB-LDN-5g-151026) — `legacyTierCheckoutEnabled()`: the hide switch for the old DFY Standard tier
 * checkout (Stage 5 ruling 7, P-23). Off unless the env var is the literal "true" (trimmed); fails closed.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { legacyTierCheckoutEnabled } from "./flags";

afterEach(() => vi.unstubAllEnvs());

describe("legacyTierCheckoutEnabled", () => {
  it("is off when the env var is absent", () => {
    vi.stubEnv("LEGACY_TIER_CHECKOUT_ENABLED", undefined as unknown as string);
    expect(legacyTierCheckoutEnabled()).toBe(false);
  });
  it.each(["", "false", "0", "TRUE", "yes", "1", "tru"])("is off for %j (fails closed)", (value) => {
    vi.stubEnv("LEGACY_TIER_CHECKOUT_ENABLED", value);
    expect(legacyTierCheckoutEnabled()).toBe(false);
  });
  it.each(["true", " true ", "true\n"])("is on for %j", (value) => {
    vi.stubEnv("LEGACY_TIER_CHECKOUT_ENABLED", value);
    expect(legacyTierCheckoutEnabled()).toBe(true);
  });
  it("is read at call time", () => {
    vi.stubEnv("LEGACY_TIER_CHECKOUT_ENABLED", "true");
    expect(legacyTierCheckoutEnabled()).toBe(true);
    vi.stubEnv("LEGACY_TIER_CHECKOUT_ENABLED", "");
    expect(legacyTierCheckoutEnabled()).toBe(false);
  });
});
