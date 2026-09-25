/**
 * Stripe SDK singleton — the only place in the codebase that constructs a
 * `Stripe` instance. Everything else imports `getStripeClient()` (or one of
 * the wrapper modules in this folder).
 *
 * Spec: `system/APP/PAYMENTS/04-stripe-integration.md` §2 (env vars) + §4
 * (module structure).
 *
 * Mode is gated by `STRIPE_MODE`. The `STRIPE_SECRET_KEY` env var must
 * hold a key matching the mode — `sk_{test,live}_*` (full secret) or
 * `rk_{test,live}_*` (restricted key). We do NOT auto-pick keys based on
 * mode. Mismatched mode + key throws on construction. Restricted keys
 * are preferred for production because they limit blast radius if
 * compromised.
 *
 * Server-only. Importing this from a `'use client'` module will fail at
 * build time because Stripe's Node SDK is not browser-safe.
 */

import Stripe from "stripe";

import type { StripeMode } from "@/types/payments";
import { SITE_NAME, SITE_URL } from "@/lib/constants";

const STRIPE_API_VERSION = "2026-04-22.dahlia" as const;

let cachedClient: Stripe | null = null;

function readEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function readMode(): StripeMode {
  const raw = process.env.STRIPE_MODE;
  if (raw === "live") return "live";
  if (raw === "test") return "test";
  throw new Error(
    `STRIPE_MODE must be 'test' or 'live' — got ${JSON.stringify(raw)}`,
  );
}

function assertKeyMatchesMode(secretKey: string, mode: StripeMode): void {
  const isLive =
    secretKey.startsWith("sk_live_") || secretKey.startsWith("rk_live_");
  const isTest =
    secretKey.startsWith("sk_test_") || secretKey.startsWith("rk_test_");
  if (mode === "live" && !isLive) {
    throw new Error(
      "STRIPE_MODE=live requires a live STRIPE_SECRET_KEY (sk_live_* or rk_live_*)",
    );
  }
  if (mode === "test" && !isTest) {
    throw new Error(
      "STRIPE_MODE=test requires a test STRIPE_SECRET_KEY (sk_test_* or rk_test_*)",
    );
  }
}

/**
 * Returns the lazily-constructed Stripe client. Reads + validates env on
 * first call; subsequent calls return the cached instance.
 */
export function getStripeClient(): Stripe {
  if (cachedClient) return cachedClient;

  const secretKey = readEnv("STRIPE_SECRET_KEY");
  const mode = readMode();
  assertKeyMatchesMode(secretKey, mode);

  cachedClient = new Stripe(secretKey, {
    apiVersion: STRIPE_API_VERSION,
    typescript: true,
    appInfo: {
      name: SITE_NAME,
      url: SITE_URL,
    },
  });

  return cachedClient;
}

/**
 * Returns the resolved Stripe mode without forcing client construction.
 * Useful for UI gating (e.g. "TEST MODE" badge) that doesn't need the SDK.
 */
export function getStripeMode(): StripeMode {
  return readMode();
}

/**
 * For tests: clear the cached client between cases so env-var changes
 * are observed. Not exported via the module barrel.
 */
export function __resetStripeClientForTests(): void {
  cachedClient = null;
}
