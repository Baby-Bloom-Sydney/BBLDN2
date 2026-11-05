/**
 * /api/cron/call-reminders (plan B2, §12 R12; brief §9.1, §9.15): 404 while CALL_BOOKING_ENABLED is off, before
 * any auth check; 401 with zero operations without the right bearer or with CRON_SECRET unset (fails closed, the
 * payment-due-sweep pattern); otherwise one run of the three passes. Registered every 5 minutes, inserted after
 * the first cron entry; the other entries untouched.
 */
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ run: vi.fn(), admin: vi.fn() }));
vi.mock("@/lib/calls/reminders", () => ({ runCallReminders: h.run }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: h.admin }));

import { GET, dynamic, maxDuration } from "./route";

const req = (auth?: string) =>
  new NextRequest("http://localhost/api/cron/call-reminders", { headers: auth ? { authorization: auth } : {} });

const PASS = { sent: 0, failed: 0, readFailed: false };

beforeEach(() => {
  vi.stubEnv("CALL_BOOKING_ENABLED", "true");
  vi.stubEnv("CRON_SECRET", "test-secret");
  h.run.mockReset();
  h.admin.mockReset();
  h.run.mockResolvedValue({ ok: true, value: { parent: { ...PASS, sent: 1 }, admin: PASS, notBooked: { ...PASS, sent: 2 } } });
});
afterEach(() => vi.unstubAllEnvs());

describe("GET /api/cron/call-reminders", () => {
  it("flag off → 404 before auth, even with the right bearer", async () => {
    vi.stubEnv("CALL_BOOKING_ENABLED", "");
    expect((await GET(req("Bearer test-secret"))).status).toBe(404);
    expect((await GET(req())).status).toBe(404);
    expect(h.run).not.toHaveBeenCalled();
    expect(h.admin).not.toHaveBeenCalled();
  });

  it("no bearer, a wrong bearer, or CRON_SECRET unset → 401 with zero operations", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer wrong"))).status).toBe(401);
    expect((await GET(req("test-secret"))).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await GET(req("Bearer "))).status).toBe(401);
    expect((await GET(req("Bearer undefined"))).status).toBe(401);
    expect(h.run).not.toHaveBeenCalled();
    expect(h.admin).not.toHaveBeenCalled();
  });

  it("the right bearer → one run; 200 with the counts", async () => {
    const res = await GET(req("Bearer test-secret"));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, parent: { ...PASS, sent: 1 }, admin: PASS, notBooked: { ...PASS, sent: 2 } });
    expect(h.run).toHaveBeenCalledTimes(1);
  });

  it("a pass that couldn't read → 500 with the counts; the run refusing → 500", async () => {
    h.run.mockResolvedValueOnce({ ok: true, value: { parent: PASS, admin: { ...PASS, readFailed: true }, notBooked: PASS } });
    const partial = await GET(req("Bearer test-secret"));
    expect(partial.status).toBe(500);
    expect((await partial.json()).admin.readFailed).toBe(true);
    h.run.mockResolvedValueOnce({ ok: false, error: "error" });
    const failed = await GET(req("Bearer test-secret"));
    expect(failed.status).toBe(500);
    expect(await failed.json()).toEqual({ ok: false, error: "error" });
  });
});

describe("never cached", () => {
  it("is force-dynamic, so a flag-off build can't prerender its 404 (or any answer) as a static file", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("may run up to 60 seconds (review F8a)", () => {
    expect(maxDuration).toBe(60);
  });
});

describe("vercel.json (R12)", () => {
  const crons = (JSON.parse(readFileSync(join(process.cwd(), "vercel.json"), "utf8")) as { crons: Array<{ path: string; schedule: string }> }).crons;

  // Only this route's own entry is pinned (review F8b): briefs 07 and 14 remove other crons without touching this test.
  it("registers call-reminders exactly once, every 5 minutes, right after the first entry", () => {
    expect(crons.filter((c) => c.path === "/api/cron/call-reminders")).toEqual([{ path: "/api/cron/call-reminders", schedule: "*/5 * * * *" }]);
    expect(crons.findIndex((c) => c.path === "/api/cron/call-reminders")).toBe(1);
    expect(existsSync(join(process.cwd(), "src/app/api/cron/call-reminders/route.ts"))).toBe(true);
  });
});
