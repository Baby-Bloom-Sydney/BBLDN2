/**
 * With the share loop on, a share is created for, and checked by, the signed-in user only.
 *
 * BB-wave1-041126, 2026-11-09.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeAdmin, writesTo, type FakeAdmin } from "@/lib/payments/fake-admin.test-util";

let admin: FakeAdmin;
const h = vi.hoisted(() => ({ userId: "u-me" as string | null, aiCheck: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: h.userId ? { id: h.userId } : null }, error: null }) },
  }),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin.client }));
vi.mock("@/lib/ai/check-share-screenshot", () => ({ checkShareScreenshot: h.aiCheck }));
vi.mock("@/lib/actions/babysitting", () => ({ activateBsr: vi.fn() }));

import * as loop from "./viral-loop";
import { SHARE_CASE_TYPE, SHARE_STATUS } from "@/lib/viral-loop/constants";

const SHARE = {
  id: "s-1",
  user_id: "u-owner",
  case_type: SHARE_CASE_TYPE.NANNY_PROFILE,
  reference_id: "n-1",
  share_status: SHARE_STATUS.SUBMITTED,
  screenshot_url: "https://example.test/s.png",
};

beforeEach(() => {
  vi.stubEnv("SHARE_LOOP_ENABLED", "true");
  h.userId = "u-me";
  h.aiCheck.mockReset().mockResolvedValue({ verdict: "approved" });
  admin = fakeAdmin({ viral_shares: SHARE, user_profiles: { first_name: "Nina", last_name: "W" } });
});
afterEach(() => vi.unstubAllEnvs());

describe("createShareRecord", () => {
  it("creates the share for the signed-in user, whatever else is passed", async () => {
    admin.reads.viral_shares = null;
    const create = loop.createShareRecord as unknown as (...args: unknown[]) => Promise<unknown>;
    await create(SHARE_CASE_TYPE.NANNY_PROFILE, "n-1", "u-someone-else");
    const [insert] = writesTo(admin, "viral_shares");
    expect(insert?.payload).toMatchObject({ user_id: "u-me", reference_id: "n-1" });
  });
});

describe("processScreenshotCheck", () => {
  it("refuses a share that is not the signed-in user's, before any write or check", async () => {
    const result = await loop.processScreenshotCheck("s-1");
    expect(result).toMatchObject({ success: false, approved: false, error: "Share not found" });
    expect(writesTo(admin, "viral_shares")).toEqual([]);
    expect(h.aiCheck).not.toHaveBeenCalled();
  });

  it("refuses when no one is signed in", async () => {
    h.userId = null;
    const result = await loop.processScreenshotCheck("s-1");
    expect(result).toMatchObject({ success: false, error: "Not authenticated" });
    expect(writesTo(admin, "viral_shares")).toEqual([]);
  });

  it("runs the check for the share's owner", async () => {
    h.userId = "u-owner";
    await loop.processScreenshotCheck("s-1");
    expect(writesTo(admin, "viral_shares").length).toBeGreaterThan(0);
    expect(h.aiCheck).toHaveBeenCalled();
  });
});
