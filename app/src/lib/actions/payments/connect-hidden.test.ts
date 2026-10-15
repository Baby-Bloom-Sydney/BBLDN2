/**
 * Unit 4a-i (BB-LDN-4a-i-151026) — the two Stripe Connect server actions stay callable by action id even when
 * their pages 404, so they refuse with `payouts_disabled` while `PAYOUTS_ENABLED` is off, before auth or any
 * Stripe call (P-23, card 4b; the effect the old `flags.ts` comment already named). Flag on → they reach auth.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const calls = vi.hoisted(() => ({ getUser: vi.fn(), adminFrom: vi.fn(), stripe: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({ auth: { getUser: calls.getUser } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: calls.adminFrom }) }));
vi.mock("@/lib/stripe/connect", () => ({
  createExpressAccount: calls.stripe,
  createAccountLink: calls.stripe,
  createAccountSession: calls.stripe,
}));
vi.mock("@/lib/stripe/client", () => ({ getStripeClient: () => { calls.stripe(); return {}; } }));

beforeEach(() => {
  vi.resetModules();
  calls.getUser.mockReset().mockResolvedValue({ data: { user: null }, error: null });
  calls.adminFrom.mockReset();
  calls.stripe.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

const ACTIONS: Array<[string, () => Promise<() => Promise<{ success: boolean; error?: string }>>]> = [
  ["startConnectOnboarding", async () => (await import("./startConnectOnboarding")).startConnectOnboarding],
  ["createConnectAccountSession", async () => (await import("./createConnectAccountSession")).createConnectAccountSession],
];

describe("Connect server actions — hidden", () => {
  it.each(ACTIONS)("%s refuses with payouts_disabled when off", async (_name, load) => {
    vi.stubEnv("PAYOUTS_ENABLED", "");
    const action = await load();
    expect(await action()).toEqual({ success: false, error: "payouts_disabled" });
    expect(calls.getUser).not.toHaveBeenCalled();
    expect(calls.stripe).not.toHaveBeenCalled();
  });

  it.each(ACTIONS)("%s reaches its auth step when on", async (_name, load) => {
    vi.stubEnv("PAYOUTS_ENABLED", "true");
    const action = await load();
    const result = await action();
    expect(result.success).toBe(false);
    expect(result.error).not.toBe("payouts_disabled");
    expect(calls.getUser).toHaveBeenCalled();
  });
});
