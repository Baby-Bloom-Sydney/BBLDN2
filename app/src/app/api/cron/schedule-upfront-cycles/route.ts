import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { scheduleCommissionFor } from "@/lib/payments/commission-scheduler";

/**
 * Cron — schedule-upfront-cycles
 *
 * Daily. For each `active_upfront` subscription, schedules the next
 * cycle's commission row (2 or 3) once the previous cycle has run for
 * 30 days. Cycle 1 is scheduled by `checkout.session.completed`; this
 * cron handles cycles 2 + 3. After cycle 3 no more rows are scheduled
 * (upfront commission is capped at £1,000 per spec 06 §1.5).
 *
 * Spec: `system/APP/PAYMENTS/06-commission-system.md` §3 + §1.5.
 *
 * Idempotent — the unique index on `(parent_subscription_id,
 * period_start)` prevents duplicate rows.
 */
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const CYCLE_DURATION_DAYS = 30;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret) {
    const authHeader = request.headers.get("authorization");
    if (authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const admin = createAdminClient();

  // Find every active_upfront subscription.
  const { data: subs, error: readErr } = await admin
    .from("parent_subscriptions")
    .select("id, parent_user_id, paid_period_starts_at")
    .eq("status", "active_upfront")
    .not("paid_period_starts_at", "is", null);

  if (readErr) {
    console.error("[cron:schedule-upfront-cycles] read failed", readErr);
    return NextResponse.json(
      { error: "read_failed", details: readErr.message },
      { status: 500 },
    );
  }

  let scheduled = 0;
  let skippedNoCycle = 0;
  let skippedDuplicates = 0;
  let errors = 0;

  for (const sub of subs ?? []) {
    if (!sub.paid_period_starts_at) continue;

    // Count existing non-cancelled commission rows for this subscription.
    // Cycle 1 was created at subscription_started; this cron creates 2 + 3.
    const { data: existing, error: countErr } = await admin
      .from("nanny_payouts")
      .select("id, period_start")
      .eq("parent_subscription_id", sub.id)
      .neq("status", "cancelled")
      .order("period_start", { ascending: true });

    if (countErr) {
      console.error("[cron:schedule-upfront-cycles] count failed", countErr);
      errors++;
      continue;
    }

    const existingCount = existing?.length ?? 0;
    if (existingCount >= 3) {
      // All 3 cycles scheduled — done with this subscription.
      continue;
    }

    // Next cycle index: 1 → cycle 2; 2 → cycle 3.
    const nextCycleIndex = (existingCount + 1) as 1 | 2 | 3;
    if (nextCycleIndex < 2 || nextCycleIndex > 3) {
      // Cycle 1 should already exist (scheduled by checkout webhook).
      // If not present here, something is wrong — log + skip.
      skippedNoCycle++;
      continue;
    }

    // Has the prior cycle run for 30 days yet? Anchor on the latest
    // existing period_start.
    const lastPeriodStart = existing?.[existing.length - 1]?.period_start;
    if (!lastPeriodStart) {
      skippedNoCycle++;
      continue;
    }
    const lastStartMs = new Date(lastPeriodStart).getTime();
    const cycleEndsAt = new Date(
      lastStartMs + CYCLE_DURATION_DAYS * MS_PER_DAY,
    );
    if (cycleEndsAt.getTime() > Date.now()) {
      // Prior cycle hasn't elapsed yet — wait.
      continue;
    }

    const result = await scheduleCommissionFor({
      parentSubscriptionId: sub.id,
      cycleIndex: nextCycleIndex,
    });

    if (result.ok) {
      scheduled++;
    } else if (result.reason === "duplicate_period") {
      skippedDuplicates++;
    } else if (result.reason === "db_error") {
      errors++;
    }
    // no_connected_nanny / test_user_bypass / subscription_not_found
    // are all benign no-ops; not counted.
  }

  return NextResponse.json({
    ok: true,
    scheduled,
    skipped_no_cycle: skippedNoCycle,
    skipped_duplicates: skippedDuplicates,
    errors,
  });
}
