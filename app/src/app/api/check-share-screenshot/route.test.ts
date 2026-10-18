/**
 * Unit 5b (BB-LDN-5b-151026) — the screenshot-check API answers 404 while `SHARE_LOOP_ENABLED` is off, before
 * auth and before `processScreenshotCheck` (P-23). With the flag on it runs as before.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";

const calls = vi.hoisted(() => ({ getUser: vi.fn(), process: vi.fn() }));

vi.mock("@/lib/supabase/server", () => ({
  createClient: () => ({ auth: { getUser: calls.getUser } }),
}));
vi.mock("@/lib/actions/viral-loop", () => ({ processScreenshotCheck: calls.process }));

import { POST } from "./route";

const req = () =>
  new NextRequest("http://localhost/api/check-share-screenshot", {
    method: "POST",
    body: JSON.stringify({ shareId: "share-1" }),
  });

beforeEach(() => {
  calls.getUser.mockReset().mockResolvedValue({ data: { user: { id: "u1" } }, error: null });
  calls.process.mockReset().mockResolvedValue({ success: true, approved: false, error: null, failReason: null });
});
afterEach(() => vi.unstubAllEnvs());

describe("POST /api/check-share-screenshot", () => {
  it("off → 404 before auth and before any check", async () => {
    vi.stubEnv("SHARE_LOOP_ENABLED", "");
    const res = await POST(req());
    expect(res.status).toBe(404);
    expect(calls.getUser).not.toHaveBeenCalled();
    expect(calls.process).not.toHaveBeenCalled();
  });

  it("on → authenticates and runs the check as before", async () => {
    vi.stubEnv("SHARE_LOOP_ENABLED", "true");
    const res = await POST(req());
    expect(res.status).toBe(200);
    expect(calls.getUser).toHaveBeenCalled();
    expect(calls.process).toHaveBeenCalledWith("share-1");
  });
});
