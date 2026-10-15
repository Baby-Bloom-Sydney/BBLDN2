/**
 * Cron `release-payouts` route — auth guard + delegation tests.
 *
 * The executable logic is covered by
 * `src/lib/payments/release-payouts.test.ts` (14 branches across the
 * payout decision tree). This file only verifies that the route
 * wrapper:
 *   - Fails closed when `CRON_SECRET` is unset (matches the
 *     trial-reminders C1 fix).
 *   - Rejects unauthenticated callers with 401.
 *   - Rejects mismatched bearer tokens with 401.
 *   - Delegates to `releasePayouts` and returns its result.
 *   - Returns 500 on executable failure with the error message.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const state = vi.hoisted(() => ({
  releaseImpl: vi.fn(),
}));

beforeEach(() => {
  state.releaseImpl.mockReset();
  vi.resetModules();
  // 4a-i: the route is hidden unless PAYOUTS_ENABLED is "true"; these cases test the open route.
  vi.stubEnv("PAYOUTS_ENABLED", "true");
});

afterEach(() => vi.unstubAllEnvs());

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ tag: "fake-admin" }),
}));

vi.mock("@/lib/stripe/transfers", () => ({
  sendTransfer: async () => ({
    success: false as const,
    error: "should not be called by route tests",
  }),
}));

vi.mock("@/lib/payments/release-payouts", () => ({
  releasePayouts: (deps: unknown) => state.releaseImpl(deps),
}));

async function callRoute(headers: Record<string, string>): Promise<Response> {
  const { GET } = await import("./route");
  const req = new NextRequest("http://localhost/api/cron/release-payouts", {
    headers,
  });
  return GET(req);
}

describe("cron/release-payouts route — auth", () => {
  it("503 fails closed when CRON_SECRET env var is unset", async () => {
    const prev = process.env.CRON_SECRET;
    delete process.env.CRON_SECRET;
    try {
      const res = await callRoute({ authorization: "Bearer anything" });
      expect(res.status).toBe(503);
      const body = await res.json();
      expect(body.error).toBe("cron_secret_not_configured");
      expect(state.releaseImpl).not.toHaveBeenCalled();
    } finally {
      if (prev !== undefined) process.env.CRON_SECRET = prev;
    }
  });

  it("401 when no authorization header is present", async () => {
    process.env.CRON_SECRET = "test-secret";
    const res = await callRoute({});
    expect(res.status).toBe(401);
    expect(state.releaseImpl).not.toHaveBeenCalled();
  });

  it("401 when bearer token doesn't match CRON_SECRET", async () => {
    process.env.CRON_SECRET = "expected-secret";
    const res = await callRoute({ authorization: "Bearer wrong-secret" });
    expect(res.status).toBe(401);
    expect(state.releaseImpl).not.toHaveBeenCalled();
  });

  it("invokes releasePayouts when bearer token matches", async () => {
    process.env.CRON_SECRET = "expected-secret";
    state.releaseImpl.mockResolvedValueOnce({
      considered: 3,
      paid: 2,
      skipped_not_ready: 0,
      skipped_test_user: 1,
      skipped_no_account: 0,
      failed: 0,
      errors: [],
    });
    const res = await callRoute({ authorization: "Bearer expected-secret" });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.paid).toBe(2);
    expect(body.skipped_test_user).toBe(1);
    expect(state.releaseImpl).toHaveBeenCalledOnce();
    // Dependencies wired correctly.
    const deps = state.releaseImpl.mock.calls[0][0] as {
      admin: unknown;
      sendTransfer: unknown;
      now: Date;
    };
    expect(deps.admin).toEqual({ tag: "fake-admin" });
    expect(typeof deps.sendTransfer).toBe("function");
    expect(deps.now).toBeInstanceOf(Date);
  });

  it("500 when releasePayouts throws", async () => {
    process.env.CRON_SECRET = "expected-secret";
    state.releaseImpl.mockRejectedValueOnce(new Error("db_read_failed"));
    const res = await callRoute({ authorization: "Bearer expected-secret" });
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("release_payouts_failed");
    expect(body.details).toBe("db_read_failed");
  });
});

describe("cron/release-payouts route — hidden (4a-i, P-23)", () => {
  it("404 when PAYOUTS_ENABLED is off, even with the right bearer, before any work", async () => {
    vi.stubEnv("PAYOUTS_ENABLED", "");
    process.env.CRON_SECRET = "test-secret";
    const res = await callRoute({ authorization: "Bearer test-secret" });
    expect(res.status).toBe(404);
    expect(state.releaseImpl).not.toHaveBeenCalled();
  });
});
