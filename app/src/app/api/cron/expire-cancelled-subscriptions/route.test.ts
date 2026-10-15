/**
 * expire-cancelled-subscriptions cron — the commission safety net runs only when
 * PAYOUTS_ENABLED (4-w5fix, W5-M1; P-23 hide). The lapse itself is unchanged.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { fakeAdmin, writesTo, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";

const h = vi.hoisted(() => ({ fake: null as unknown as FakeAdmin, cancel: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.fake.client }));
vi.mock("@/lib/payments/commission-cancel", () => ({ cancelInFlightCommission: h.cancel }));

import { GET } from "./route";

const SECRET = "test-cron-secret";
const req = () =>
  new NextRequest("http://localhost/api/cron/expire-cancelled-subscriptions", {
    headers: { authorization: `Bearer ${SECRET}` },
  });

beforeEach(() => {
  vi.stubEnv("CRON_SECRET", SECRET);
  h.fake = fakeAdmin({ parent_subscriptions: [{ id: "ps1", parent_user_id: "u1" }] });
  h.cancel.mockReset();
  h.cancel.mockResolvedValue({ cancelled: 0 });
});
afterEach(() => vi.unstubAllEnvs());

describe("expire-cancelled-subscriptions", () => {
  it("flag off: lapses the row and calls no commission freeze", async () => {
    vi.stubEnv("PAYOUTS_ENABLED", "");
    const res = await GET(req());
    expect(await res.json()).toEqual({ ok: true, lapsed: 1 });
    expect(writesTo(h.fake, "parent_subscriptions")[0].payload).toEqual({ status: "lapsed" });
    expect(h.cancel).not.toHaveBeenCalled();
  });

  it("flag on: the safety net runs as before", async () => {
    vi.stubEnv("PAYOUTS_ENABLED", "true");
    const res = await GET(req());
    expect(await res.json()).toEqual({ ok: true, lapsed: 1 });
    expect(h.cancel).toHaveBeenCalledWith("ps1", "parent_cancelled");
  });
});
