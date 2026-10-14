import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { runDbsRecheck } from "@/lib/dbs/recheck";

/**
 * Cron — dbs-recheck (unit 3i, BB-LDN-3i-141026). Daily, 05:00 UTC (`vercel.json`).
 *
 * Every level-4 nanny's DBS certificate is checked again with the DBS Update Service (00-RULINGS #12). Pass: only
 * "last checked" moves, nothing logged (#33). Fail: automatic — 23 / 26, level 2, hired connections kept and the rest
 * dropped silently (README P-3, P-9), her email, the admin alert (#35). API error: nothing changes, one log row, retried
 * tomorrow (#32). Safety cut-off (README P-15): if the run's failures are above 20 % of its answers and at least 3,
 * none is applied — one log row and one admin email instead. The work is `runDbsRecheck` (lib/dbs/recheck.ts); this
 * file is auth + response only.
 *
 * Contract
 * - Auth: fail-CLOSED, copied from `cron/trial-reminders` — no `CRON_SECRET` → 503 `cron_secret_not_configured`; a
 *   wrong `Authorization: Bearer …` → 401. Nothing is read or checked before both pass.
 * - Output: `{ checked, passed, failed_new_info, failed_no_match, errors, skipped, stopped_on_budget, reconciled,
 *   paused_on_fail_ratio, failures_held }` — counts only, never a name or certificate number. A failed selection read → 500 `recheck_failed` (no detail).
 * - Never: runs without the secret, returns or logs PII, or registers itself (the `vercel.json` entry does; the
 *   production `CRON_SECRET` and the live DBS checker name are BAI's go-live items — until then every check returns
 *   `not_configured` → nothing changes, one log row per nanny).
 */
export const maxDuration = 300;

export async function GET(request: NextRequest) {
  // Fail-CLOSED: a deploy that drops CRON_SECRET must refuse every caller, not accept any.
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    return NextResponse.json({ error: "cron_secret_not_configured" }, { status: 503 });
  }
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const summary = await runDbsRecheck(createAdminClient());
    return NextResponse.json(summary);
  } catch (err) {
    console.error("[cron/dbs-recheck] run failed:", err instanceof Error ? err.message : "unknown");
    return NextResponse.json({ error: "recheck_failed" }, { status: 500 });
  }
}
