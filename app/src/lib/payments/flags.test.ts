/**
 * Unit 4a-i (BB-LDN-4a-i-151026) — `PAYOUTS_ENABLED` is the one switch for the hidden payout / Connect / ABN
 * surface (P-23, card 4b). Absent means hidden; only the literal "true" opens it.
 */
import { describe, it, expect, afterEach, vi } from "vitest";
import { payoutsEnabled, getPaymentsFlags } from "./flags";

afterEach(() => vi.unstubAllEnvs());

describe("payoutsEnabled", () => {
  it("is off when the env var is absent (the London default)", () => {
    vi.stubEnv("PAYOUTS_ENABLED", undefined as unknown as string);
    delete process.env.PAYOUTS_ENABLED;
    expect(payoutsEnabled()).toBe(false);
  });

  it.each(["", "false", "0", "1", "yes", "TRUE-ish", "on"])("is off for %j", (value) => {
    vi.stubEnv("PAYOUTS_ENABLED", value);
    expect(payoutsEnabled()).toBe(false);
  });

  it.each(["true", " true\n"])("is on only for the literal true (%j, trimmed)", (value) => {
    vi.stubEnv("PAYOUTS_ENABLED", value);
    expect(payoutsEnabled()).toBe(true);
  });

  it("is read at call time, so flipping the env flips the surface", () => {
    vi.stubEnv("PAYOUTS_ENABLED", "true");
    expect(payoutsEnabled()).toBe(true);
    vi.stubEnv("PAYOUTS_ENABLED", "false");
    expect(payoutsEnabled()).toBe(false);
  });

  it("is what getPaymentsFlags reports", () => {
    vi.stubEnv("PAYOUTS_ENABLED", "");
    expect(getPaymentsFlags().PAYOUTS_ENABLED).toBe(false);
    vi.stubEnv("PAYOUTS_ENABLED", "true");
    expect(getPaymentsFlags().PAYOUTS_ENABLED).toBe(true);
  });
});
