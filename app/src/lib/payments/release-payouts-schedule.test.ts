/**
 * Schedule regression test for the payout crons in `vercel.json`.
 *
 * History: this file locked down the daily `release-payouts` registration (Bailey 2026-05-14: payouts must fire
 * once a day; re-anchored to `0 7` London by 2b, 12.02). London has no automated payouts (N-2): Stage 5 ruling 3
 * and P-23 hide the payout surface, and 4a-i removes the **two cron lines** while the route files stay (each
 * answers 404 unless `PAYOUTS_ENABLED` is "true"). Retargeted by 4a-i (BB-LDN-4a-i-151026) to pin the ruling:
 * neither payout cron is registered, and both routes still exist (hidden, not deleted).
 */

import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "fs";
import { join } from "path";

interface VercelCron {
  path: string;
  schedule: string;
}

function readVercelCrons(): VercelCron[] {
  const path = join(process.cwd(), "vercel.json");
  const json = JSON.parse(readFileSync(path, "utf8"));
  return json.crons as VercelCron[];
}

const PAYOUT_CRONS = ["/api/cron/release-payouts", "/api/cron/schedule-upfront-cycles"];

describe("vercel.json — payout crons are not registered (4a-i, Stage 5 ruling 3)", () => {
  it.each(PAYOUT_CRONS)("%s has no cron line", (cronPath) => {
    expect(readVercelCrons().find((c) => c.path === cronPath)).toBeUndefined();
  });

  it.each(PAYOUT_CRONS)("%s route file still exists (hidden, not deleted — P-23)", (cronPath) => {
    expect(existsSync(join(process.cwd(), "src/app", cronPath, "route.ts"))).toBe(true);
  });

  it("every other cron line is untouched (14 remain)", () => {
    expect(readVercelCrons()).toHaveLength(14);
  });
});
