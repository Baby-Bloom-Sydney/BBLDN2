/**
 * Cron — release-payouts
 *
 * **Schedule:** daily at `0 7 * * *` UTC = 07:00 London.
 * Vercel cron runs in UTC and does not auto-adjust for British Summer
 * Time, so the wall-clock fires one hour later during BST (late Mar–
 * late Oct). The one-hour drift is irrelevant for a daily batch payout
 * — what matters is that it fires reliably once a day in the London
 * morning before the business day. Bailey 2026-05-14; re-anchored to
 * London 2026-09-26 (12.02).
 *
 * Pays nannies whose `nanny_payouts.scheduled_release_at` has
 * arrived. Wraps the testable `releasePayouts` function with the
 * real Supabase + Stripe dependencies + the standard CRON_SECRET
 * bearer auth.
 *
 * Closes the gap where nothing was actually calling `sendTransfer`
 * despite the rest of the pipeline being wired.
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendTransfer } from "@/lib/stripe/transfers";
import { releasePayouts } from "@/lib/payments/release-payouts";

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    // Fail closed — never run unauthenticated. Matches the
    // trial-reminders cron C1 fix.
    return NextResponse.json(
      { error: "cron_secret_not_configured" },
      { status: 503 },
    );
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  try {
    const result = await releasePayouts({
      admin: createAdminClient(),
      sendTransfer,
      now: new Date(),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    console.error("[cron:release-payouts] run failed", err);
    return NextResponse.json(
      {
        error: "release_payouts_failed",
        details: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}
