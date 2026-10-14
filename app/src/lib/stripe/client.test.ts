/**
 * Unit 4f (LDN2 Stage 4, brief item 5) — `assertKeyMatchesMode` is the guard that keeps
 * live money off the London preview: STRIPE_MODE=test must refuse a live key.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { __resetStripeClientForTests, getStripeClient, getStripeMode } from "./client";

describe("getStripeClient — key must match STRIPE_MODE", () => {
  beforeEach(() => {
    __resetStripeClientForTests();
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    __resetStripeClientForTests();
  });

  it.each(["sk_live_x", "rk_live_x"])("STRIPE_MODE=test refuses a live key (%s)", (key) => {
    vi.stubEnv("STRIPE_MODE", "test");
    vi.stubEnv("STRIPE_SECRET_KEY", key);
    expect(() => getStripeClient()).toThrow(/STRIPE_MODE=test requires a test/);
  });

  it.each(["sk_test_x", "rk_test_x"])("STRIPE_MODE=test accepts a test key (%s)", (key) => {
    vi.stubEnv("STRIPE_MODE", "test");
    vi.stubEnv("STRIPE_SECRET_KEY", key);
    expect(() => getStripeClient()).not.toThrow();
  });

  it("STRIPE_MODE=live refuses a test key", () => {
    vi.stubEnv("STRIPE_MODE", "live");
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    expect(() => getStripeClient()).toThrow(/STRIPE_MODE=live requires a live/);
  });

  it("an unset or unknown STRIPE_MODE fails closed", () => {
    vi.stubEnv("STRIPE_SECRET_KEY", "sk_test_x");
    vi.stubEnv("STRIPE_MODE", "");
    expect(() => getStripeClient()).toThrow(/STRIPE_MODE must be/);
    vi.stubEnv("STRIPE_MODE", "prod");
    expect(() => getStripeMode()).toThrow(/STRIPE_MODE must be/);
  });

  it("a missing key fails closed", () => {
    vi.stubEnv("STRIPE_MODE", "test");
    vi.stubEnv("STRIPE_SECRET_KEY", "");
    expect(() => getStripeClient()).toThrow(/Missing required env var: STRIPE_SECRET_KEY/);
  });
});
