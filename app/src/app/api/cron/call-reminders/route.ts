import { NextRequest, NextResponse } from "next/server";
import { runCallReminders } from "@/lib/calls/reminders";
import { callBookingEnabled } from "@/lib/features/flags";

/**
 * Cron — call-reminders (brief 04 §0.4, §0.7; plan B2). Every 5 minutes (`vercel.json`).
 *
 * The 24-hour parent reminder, the 15-minute admin reminder and the one "pick a time" email, each claimed before
 * it's sent (`src/lib/calls/reminders.ts`). Crons run on production only, so a preview walk calls this by hand with
 * the secret (plan R4; `BUILD/README.md` § Wave 1 alignment item 8).
 *
 * `CALL_BOOKING_ENABLED` off → 404 before anything else (brief §0.15). Auth: `Authorization: Bearer $CRON_SECRET`,
 * failing closed when the secret is unset (the `payment-due-sweep` pattern, plan D2). 500 when a pass couldn't
 * read, so the cron log shows it. Force-dynamic: with the flag off it answers before reading the request, and Next
 * would otherwise prerender that 404 as a static file at build. BB-wave1-041126/04b-build.
 */
export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  if (!callBookingEnabled()) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const run = await runCallReminders();
  if (!run.ok) return NextResponse.json({ ok: false, error: run.error }, { status: 500 });
  const readFailed = [run.value.parent, run.value.admin, run.value.notBooked].some((pass) => pass.readFailed);
  return NextResponse.json({ ok: true, ...run.value }, { status: readFailed ? 500 : 200 });
}
