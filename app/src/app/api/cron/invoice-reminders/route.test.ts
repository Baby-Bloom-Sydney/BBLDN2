/**
 * /api/cron/invoice-reminders (plan 06 §16.7 b5.7; the call-reminders route's order, §16.4): 404 while
 * NANNY_INVOICES_ENABLED is off, before any auth check; 401 with zero operations without the right bearer or with
 * CRON_SECRET unset or blank (the real cron proof decides); otherwise one run — 200 with its counts, 500 when a read
 * failed or the run refused, 200 `not_time` outside Friday 16:xx London with nothing read. Registered twice in
 * `vercel.json`, at 15:00 and 16:00 UTC on Fridays, added at the end; the other entries unchanged.
 *
 * BB-wave1-041126/06b5-app, 2026-11-23.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ run: vi.fn(), admin: vi.fn(), real: { run: null as null | ((...args: unknown[]) => unknown) } }));
vi.mock("@/lib/invoices", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/invoices")>();
  h.real.run = actual.runInvoiceReminders as (...args: unknown[]) => unknown;
  return { ...actual, runInvoiceReminders: h.run };
});
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: h.admin }));

import { GET, dynamic, maxDuration } from "./route";

const SECRET = "cron-test-value-7f3a";
const req = (auth?: string) =>
  new NextRequest("http://localhost/api/cron/invoice-reminders", { headers: auth ? { authorization: auth } : {} });

const COUNTS = { sent: 2, failed: 0, skipped: 1, readFailed: false };

beforeEach(() => {
  vi.stubEnv("NANNY_INVOICES_ENABLED", "true");
  vi.stubEnv("CRON_SECRET", SECRET);
  h.run.mockReset();
  h.admin.mockReset();
  h.run.mockResolvedValue({ ok: true, value: COUNTS });
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("GET /api/cron/invoice-reminders", () => {
  it("flag off → 404 before auth, even with the right bearer", async () => {
    vi.stubEnv("NANNY_INVOICES_ENABLED", "");
    expect((await GET(req(`Bearer ${SECRET}`))).status).toBe(404);
    expect((await GET(req())).status).toBe(404);
    expect(h.run).not.toHaveBeenCalled();
    expect(h.admin).not.toHaveBeenCalled();
  });

  it("no bearer, a wrong bearer, or CRON_SECRET unset or blank → 401 with zero operations", async () => {
    expect((await GET(req())).status).toBe(401);
    expect((await GET(req("Bearer wrong"))).status).toBe(401);
    expect((await GET(req(SECRET))).status).toBe(401);
    for (const secret of ["", "   "]) {
      vi.stubEnv("CRON_SECRET", secret);
      expect((await GET(req("Bearer "))).status).toBe(401);
      expect((await GET(req("Bearer undefined"))).status).toBe(401);
      expect((await GET(req(`Bearer ${secret}`))).status).toBe(401);
    }
    delete process.env.CRON_SECRET;
    expect((await GET(req("Bearer undefined"))).status).toBe(401);
    expect(h.run).not.toHaveBeenCalled();
    expect(h.admin).not.toHaveBeenCalled();
  });

  it("the right bearer → one run with a cron proof; 200 with the counts", async () => {
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, ...COUNTS });
    expect(h.run).toHaveBeenCalledTimes(1);
    expect(h.run.mock.calls[0]?.[0]).toEqual({ kind: "invoice_cron_proof" });
  });

  it("a read that failed → 500 with the counts; the run refusing → 500", async () => {
    h.run.mockResolvedValueOnce({ ok: true, value: { ...COUNTS, sent: 0, skipped: 0, readFailed: true } });
    const partial = await GET(req(`Bearer ${SECRET}`));
    expect(partial.status).toBe(500);
    expect((await partial.json()).readFailed).toBe(true);
    h.run.mockResolvedValueOnce({ ok: false, error: "invoices_disabled" });
    const refused = await GET(req(`Bearer ${SECRET}`));
    expect(refused.status).toBe(500);
    expect(await refused.json()).toEqual({ ok: false, error: "invoices_disabled" });
  });

  it("not Friday 16:xx London → 200 not_time, with nothing read (the real run)", async () => {
    h.run.mockImplementation((...args: unknown[]) => h.real.run?.(...args));
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-02-10T16:00:00Z"));
    const res = await GET(req(`Bearer ${SECRET}`));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, skipped: "not_time" });
    expect(h.admin).not.toHaveBeenCalled();
  });
});

describe("never cached", () => {
  it("is force-dynamic, so a flag-off build can't prerender its 404 (or any answer) as a static file", () => {
    expect(dynamic).toBe("force-dynamic");
  });

  it("may run up to 60 seconds (nannies one at a time)", () => {
    expect(maxDuration).toBe(60);
  });
});

describe("vercel.json", () => {
  const text = readFileSync(join(process.cwd(), "vercel.json"), "utf8");
  const crons = (JSON.parse(text) as { crons: Array<{ path: string; schedule: string }> }).crons;
  const MINE = [
    { path: "/api/cron/invoice-reminders", schedule: "0 15 * * 5" },
    { path: "/api/cron/invoice-reminders", schedule: "0 16 * * 5" },
  ];

  it("registers the reminder exactly twice, Fridays at 15:00 and 16:00 UTC, as the last two entries", () => {
    expect(crons.filter((c) => c.path === "/api/cron/invoice-reminders")).toEqual(MINE);
    expect(crons.slice(-2)).toEqual(MINE);
    expect(existsSync(join(process.cwd(), "src/app/api/cron/invoice-reminders/route.ts"))).toBe(true);
  });

  it("add-only: the file is the other entries as they were, byte for byte, then the two (as of 06b-5, main 67c2262)", () => {
    // The 17 entries at main 67c2262. A later brief that changes one of them updates this list with it.
    const BEFORE = [
      ["/api/cron/send-delayed-emails", "*/5 * * * *"],
      ["/api/cron/call-reminders", "*/5 * * * *"],
      ["/api/cron/expire-connections", "*/15 * * * *"],
      ["/api/cron/proactive", "*/15 * * * *"],
      ["/api/cron/compact-daily", "0 13 * * *"],
      ["/api/cron/cleanup-orphan-children", "0 13 * * *"],
      ["/api/cron/dfy-waves", "0 19 * * *"],
      ["/api/cron/snapshot-pipeline", "0 0 * * *"],
      ["/api/cron/expire-trials", "0 13 * * *"],
      ["/api/cron/expire-past-due", "30 13 * * *"],
      ["/api/cron/expire-cancelled-subscriptions", "45 13 * * *"],
      ["/api/cron/soft-lock-stale-children", "15 13 * * *"],
      ["/api/cron/trial-reminders", "0 12 * * *"],
      ["/api/cron/audit-consent-expiry", "5 7 * * *"],
      ["/api/cron/dbs-recheck", "0 5 * * *"],
      ["/api/cron/payment-due-sweep", "0 9 * * *"],
      ["/api/cron/usage-weekly-check", "0 6 * * 1"],
    ].map(([path, schedule]) => ({ path, schedule }));
    expect(text).toBe(`${JSON.stringify({ crons: [...BEFORE, ...MINE] }, null, 2)}\n`);
  });
});
