/**
 * Unit 4a-i (BB-LDN-4a-i-151026) — the five `/nanny/payouts/**` pages and `/admin/payouts` 404 while
 * `PAYOUTS_ENABLED` is off, before any auth or data read (P-23, card 4b). With the flag on they run as before:
 * the page proceeds to its own auth step (asserted by the login redirect / admin check it reaches).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const calls = vi.hoisted(() => ({ getUser: vi.fn(), adminFrom: vi.fn(), requireAdmin: vi.fn() }));

vi.mock("next/navigation", () => ({
  notFound: () => {
    throw new Error("NOT_FOUND");
  },
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { getUser: calls.getUser } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: calls.adminFrom }),
}));
vi.mock("@/lib/admin/require-admin", () => ({
  requireAdmin: () => {
    calls.requireAdmin();
    throw new Error("ADMIN_CHECK");
  },
}));

beforeEach(() => {
  calls.getUser.mockReset().mockResolvedValue({ data: { user: null } });
  calls.adminFrom.mockReset();
  calls.requireAdmin.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

type Page = (props: { params: { familyId: string } }) => unknown;
const PAGES: Array<[string, () => Promise<{ default: Page }>, string]> = [
  ["/nanny/payouts", () => import("./page") as Promise<{ default: Page }>, "REDIRECT:/login?next=/nanny/payouts"],
  ["/nanny/payouts/history", () => import("./history/page") as Promise<{ default: Page }>, "REDIRECT:/login?next=/nanny/payouts/history"],
  ["/nanny/payouts/onboarding", () => import("./onboarding/page") as Promise<{ default: Page }>, "REDIRECT:/login?next=/nanny/payouts/onboarding"],
  ["/nanny/payouts/[familyId]", () => import("./[familyId]/page") as Promise<{ default: Page }>, "REDIRECT:/login?next=/nanny/payouts/fam-1"],
  ["/admin/payouts", () => import("../../admin/payouts/page") as Promise<{ default: Page }>, "ADMIN_CHECK"],
];

describe("payout pages — hidden while PAYOUTS_ENABLED is off", () => {
  it.each(PAGES)("%s → notFound() before any auth or data read", async (_path, load) => {
    vi.stubEnv("PAYOUTS_ENABLED", "");
    const { default: Page } = await load();
    await expect(async () => Page({ params: { familyId: "fam-1" } })).rejects.toThrow("NOT_FOUND");
    expect(calls.getUser).not.toHaveBeenCalled();
    expect(calls.adminFrom).not.toHaveBeenCalled();
    expect(calls.requireAdmin).not.toHaveBeenCalled();
  });

  it("/nanny/payouts/terms → notFound()", async () => {
    vi.stubEnv("PAYOUTS_ENABLED", "");
    const { default: Page } = await import("./terms/page");
    expect(() => Page()).toThrow("NOT_FOUND");
  });
});

describe("payout pages — reopen with PAYOUTS_ENABLED=true", () => {
  it.each(PAGES)("%s → proceeds to its own auth step", async (_path, load, reached) => {
    vi.stubEnv("PAYOUTS_ENABLED", "true");
    const { default: Page } = await load();
    await expect(async () => Page({ params: { familyId: "fam-1" } })).rejects.toThrow(reached);
  });

  it("/nanny/payouts/terms → renders the terms page", async () => {
    vi.stubEnv("PAYOUTS_ENABLED", "true");
    const { default: Page } = await import("./terms/page");
    expect(Page()).toBeTruthy();
  });
});
