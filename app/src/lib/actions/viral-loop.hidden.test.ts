/**
 * Unit 5b (BB-LDN-5b-151026) — the share-loop server-action writers refuse while `SHARE_LOOP_ENABLED` is off,
 * before any auth, read or write (P-23). Next 14 exposes every export of a client-imported "use server" module,
 * so the actions stay callable by id after their pages 404; `recordCheckResult` has no auth of its own.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const calls = vi.hoisted(() => ({ getUser: vi.fn(), adminFrom: vi.fn(), aiCheck: vi.fn(), activateBsr: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { getUser: calls.getUser } }),
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      calls.adminFrom(table);
      throw new Error(`DB:${table}`);
    },
  }),
}));
vi.mock("@/lib/ai/check-share-screenshot", () => ({ checkShareScreenshot: calls.aiCheck }));
vi.mock("@/lib/actions/babysitting", () => ({ activateBsr: calls.activateBsr }));

import * as loop from "./viral-loop";
import { SHARE_CASE_TYPE } from "@/lib/viral-loop/constants";

beforeEach(() => {
  calls.getUser.mockReset().mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  calls.adminFrom.mockReset();
  calls.aiCheck.mockReset();
  calls.activateBsr.mockReset();
});
afterEach(() => vi.unstubAllEnvs());

const approved = { verdict: "approved" } as unknown as Parameters<typeof loop.recordCheckResult>[1];

const WRITERS: Array<[string, () => Promise<{ error: string | null }>]> = [
  ["createShareRecord", () => loop.createShareRecord(SHARE_CASE_TYPE.NANNY_PROFILE, "n1", "u1")],
  ["markShareCompleted", () => loop.markShareCompleted("s1")],
  ["submitShareScreenshot", () => loop.submitShareScreenshot("s1", "https://example.test/x.png")],
  ["beginScreenshotCheck", () => loop.beginScreenshotCheck("s1")],
  ["recordCheckResult", () => loop.recordCheckResult("s1", approved)],
  ["processScreenshotCheck", () => loop.processScreenshotCheck("s1")],
  ["adminBypassShare", () => loop.adminBypassShare("s1")],
  ["createNannyProfileShare", () => loop.createNannyProfileShare("n1", "u1")],
  ["createParentPositionShare", () => loop.createParentPositionShare("p1", "u1")],
  ["createParentBsrShare", () => loop.createParentBsrShare("b1", "u1")],
];

describe("viral-loop writers — refuse while SHARE_LOOP_ENABLED is off", () => {
  it.each(WRITERS)("%s → share_loop_disabled, no auth, no DB, no AI, no BSR activation", async (_name, call) => {
    vi.stubEnv("SHARE_LOOP_ENABLED", "");
    const result = await call();
    expect(result.error).toBe("share_loop_disabled");
    expect(calls.getUser).not.toHaveBeenCalled();
    expect(calls.adminFrom).not.toHaveBeenCalled();
    expect(calls.aiCheck).not.toHaveBeenCalled();
    expect(calls.activateBsr).not.toHaveBeenCalled();
  });
});

describe("viral-loop writers — reopen with SHARE_LOOP_ENABLED=true", () => {
  it("recordCheckResult reaches the database as before", async () => {
    vi.stubEnv("SHARE_LOOP_ENABLED", "true");
    await expect(loop.recordCheckResult("s1", approved)).rejects.toThrow("DB:viral_shares");
  });
  it("createShareRecord reaches the database as before", async () => {
    vi.stubEnv("SHARE_LOOP_ENABLED", "true");
    await expect(loop.createShareRecord(SHARE_CASE_TYPE.NANNY_PROFILE, "n1", "u1")).rejects.toThrow("DB:viral_shares");
  });
});
