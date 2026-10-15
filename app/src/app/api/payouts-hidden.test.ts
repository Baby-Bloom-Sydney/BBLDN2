/**
 * Unit 4a-i (BB-LDN-4a-i-151026) — the payout API routes answer 404 while `PAYOUTS_ENABLED` is off, before any auth,
 * read or work (P-23, card 4b). With the flag on they reach their own auth step as before.
 * (`cron/release-payouts` has the same pair in its own `route.test.ts`.)
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const calls = vi.hoisted(() => ({ getUser: vi.fn(), adminFrom: vi.fn(), schedule: vi.fn(), dashboard: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({ auth: { getUser: calls.getUser } }) }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: calls.adminFrom }) }));
vi.mock("@/lib/payments/commission-scheduler", () => ({ scheduleCommissionFor: calls.schedule }));
vi.mock("@/lib/payments/queryPayoutsDashboard", () => ({ fetchPayoutsDashboardData: calls.dashboard }));

beforeEach(() => {
  vi.resetModules();
  calls.getUser.mockReset().mockResolvedValue({ data: { user: null } });
  calls.adminFrom.mockReset();
  calls.schedule.mockReset();
  calls.dashboard.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

const noWork = () => {
  expect(calls.getUser).not.toHaveBeenCalled();
  expect(calls.adminFrom).not.toHaveBeenCalled();
  expect(calls.schedule).not.toHaveBeenCalled();
  expect(calls.dashboard).not.toHaveBeenCalled();
};

describe("GET /api/nanny/payout-status", () => {
  it("404 when off", async () => {
    vi.stubEnv("PAYOUTS_ENABLED", "");
    const { GET } = await import("./nanny/payout-status/route");
    expect((await GET()).status).toBe(404);
    noWork();
  });
  it("reaches auth when on (401 unauthenticated)", async () => {
    vi.stubEnv("PAYOUTS_ENABLED", "true");
    const { GET } = await import("./nanny/payout-status/route");
    expect((await GET()).status).toBe(401);
  });
});

describe("GET /api/nanny/earnings-badge", () => {
  it("404 when off", async () => {
    vi.stubEnv("PAYOUTS_ENABLED", "");
    const { GET } = await import("./nanny/earnings-badge/route");
    expect((await GET()).status).toBe(404);
    noWork();
  });
  it("reaches auth when on (401 unauthenticated)", async () => {
    vi.stubEnv("PAYOUTS_ENABLED", "true");
    const { GET } = await import("./nanny/earnings-badge/route");
    expect((await GET()).status).toBe(401);
  });
});

describe("GET /api/cron/schedule-upfront-cycles", () => {
  const req = (auth: string) =>
    new NextRequest("http://localhost/api/cron/schedule-upfront-cycles", { headers: { authorization: auth } });

  it("404 when off, even with the right bearer, before any work", async () => {
    vi.stubEnv("PAYOUTS_ENABLED", "");
    vi.stubEnv("CRON_SECRET", "test-secret");
    const { GET } = await import("./cron/schedule-upfront-cycles/route");
    expect((await GET(req("Bearer test-secret"))).status).toBe(404);
    noWork();
  });
  it("reaches its auth step when on (401 on a wrong bearer)", async () => {
    vi.stubEnv("PAYOUTS_ENABLED", "true");
    vi.stubEnv("CRON_SECRET", "test-secret");
    const { GET } = await import("./cron/schedule-upfront-cycles/route");
    expect((await GET(req("Bearer wrong"))).status).toBe(401);
  });
});
