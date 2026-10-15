/**
 * Unit 5g (BB-LDN-5g-151026) — `/parent/matches/checkout` and `/parent/matches/matchmaker` (which only redirects
 * into it) 404 while `LEGACY_TIER_CHECKOUT_ENABLED` is off, before any auth or data read (Stage 5 ruling 7, P-23).
 * With the flag on they run as before. `/parent/matchmaking` is a kept surface (ledger 5g §1) and is not gated.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const calls = vi.hoisted(() => ({ getUser: vi.fn(), adminFrom: vi.fn() }));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
  useRouter: () => ({ replace: vi.fn(), push: vi.fn() }),
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { getUser: calls.getUser } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: calls.adminFrom }),
}));
vi.mock("@/lib/actions/matching", () => ({ confirmMatchmaking: vi.fn() }));

beforeEach(() => {
  calls.getUser.mockReset().mockResolvedValue({ data: { user: null } });
  calls.adminFrom.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

describe("/parent/matches/checkout — hidden while off", () => {
  it("notFound() before any auth or data read when off", async () => {
    vi.stubEnv("LEGACY_TIER_CHECKOUT_ENABLED", "");
    const { default: Page } = await import("./page");
    await expect(async () => Page()).rejects.toThrow("NOT_FOUND");
    expect(calls.getUser).not.toHaveBeenCalled();
    expect(calls.adminFrom).not.toHaveBeenCalled();
  });
  it("runs as before when on (reaches its own login redirect)", async () => {
    vi.stubEnv("LEGACY_TIER_CHECKOUT_ENABLED", "true");
    const { default: Page } = await import("./page");
    await expect(async () => Page()).rejects.toThrow("REDIRECT:/login");
    expect(calls.getUser).toHaveBeenCalledTimes(1);
  });
});

describe("/parent/matches/matchmaker — hidden while off", () => {
  it("notFound() when off", async () => {
    vi.stubEnv("LEGACY_TIER_CHECKOUT_ENABLED", "");
    const { default: Page } = await import("../matchmaker/page");
    expect(() => Page()).toThrow("NOT_FOUND");
  });
  it("renders its redirect client when on", async () => {
    vi.stubEnv("LEGACY_TIER_CHECKOUT_ENABLED", "true");
    const { default: Page } = await import("../matchmaker/page");
    expect(() => Page()).not.toThrow();
  });
});

describe("/parent/matchmaking — kept surface, not gated (ledger 5g §1)", () => {
  it("still runs its own auth step when the flag is off", async () => {
    vi.stubEnv("LEGACY_TIER_CHECKOUT_ENABLED", "");
    const { default: Page } = await import("../../matchmaking/page");
    await expect(async () => Page()).rejects.toThrow("REDIRECT:/login");
    expect(calls.getUser).toHaveBeenCalledTimes(1);
  });
});
