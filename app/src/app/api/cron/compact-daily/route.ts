/**
 * Cron endpoint — summarises each bot's chat_messages for yesterday
 * into a chat_summaries row.
 *
 * Scheduled daily (see vercel.json). Targets the previous calendar day
 * in the caller's timezone so late-evening messages don't get cut off.
 *
 * Manual run during development:
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     http://localhost:3000/api/cron/compact-daily
 *   curl -H "Authorization: Bearer $CRON_SECRET" \
 *     'http://localhost:3000/api/cron/compact-daily?date=2026-04-22'
 */

import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { compactDailyAllBots } from "@/lib/chat/memory/compaction";
import { KATIE_ENABLED } from "@/lib/chat/flags";
import { APP_TZ } from "@/lib/constants";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function yesterdayIso(timezone = APP_TZ): string {
  const now = new Date();
  const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const fmt = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return fmt.format(yesterday); // "YYYY-MM-DD"
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  if (!KATIE_ENABLED) {
    return NextResponse.json({
      ok: true,
      skipped: "KATIE_ENABLED flag is off",
      results: [],
    });
  }

  const url = new URL(request.url);
  const dateIso = url.searchParams.get("date") ?? yesterdayIso();

  const admin = createAdminClient();
  const startedAt = Date.now();
  const results = await compactDailyAllBots(admin, dateIso);
  const durationMs = Date.now() - startedAt;

  const written = results.filter((r) => r.status === "written").length;
  const skipped = results.filter(
    (r) => r.status === "skipped_no_messages",
  ).length;
  const errored = results.filter((r) => r.status === "error").length;

  // WU 11.3 — prune draft idempotency locks older than 7 days. The
  // table grows by one row per accepted draft and the chat client
  // can't possibly retry an accept on a draft that's a week+ old
  // (it's not in any open chat session). Keeping the rows around
  // forever just bloats the table for no protection benefit. We log
  // the deleted count so a sudden spike or drop is visible without
  // having to query the table directly.
  const sevenDaysAgo = new Date(
    Date.now() - 7 * 24 * 60 * 60 * 1000,
  ).toISOString();
  let prunedLocks = 0;
  let prunePq: string | null = null;
  try {
    const { error: pruneErr, count } = await admin
      .from("chat_draft_locks")
      .delete({ count: "exact" })
      .lt("acquired_at", sevenDaysAgo);
    if (pruneErr) {
      prunePq = pruneErr.message;
    } else {
      prunedLocks = count ?? 0;
    }
  } catch (err) {
    prunePq = err instanceof Error ? err.message : String(err);
  }

  console.log(
    JSON.stringify({
      ts: new Date().toISOString(),
      event: "katie.cron.compact_daily",
      date: dateIso,
      considered: results.length,
      written,
      skipped,
      errored,
      duration_ms: durationMs,
      pruned_draft_locks: prunedLocks,
      ...(prunePq ? { prune_error: prunePq } : {}),
    }),
  );

  return NextResponse.json({
    ok: true,
    date: dateIso,
    considered: results.length,
    written,
    skipped,
    errored,
    duration_ms: durationMs,
    pruned_draft_locks: prunedLocks,
    results,
  });
}
