/**
 * VER-003 "Your DBS check needs attention" — who is a candidate (unit 3g, BB-LDN-3g-141026; 00-RULINGS #20).
 *
 * Purpose: the one filter the `send-delayed-emails` cron uses to pick VER-003 rows, exported so 3i's R14 test can
 * prove a re-check failure never also gets VER-003. Lives outside the route because a Next.js route file may export
 * only route fields.
 *
 * Rule: a FIRST-check DBS failure that has sat untouched past the cutoff —
 *   `wwcc_status IN ('failed', 'expired', 'ocg_not_found')` (AI fail · 23 new information · 26 no match; D-4 names)
 *   AND `wwcc_status_at < cutoff` (the 10-minute delay) AND her CURRENT failure is not a re-check failure.
 * Re-check failure (unit 3i, BB-LDN-3i-141026 — orchestrator addendum M1, replacing 3g's blanket
 *   `wwcc_verified_at IS NULL`): a level-4 failure (daily re-check or the admin's P-8 run) writes a `dbs_status_check`
 *   row with `recheck_fail: true` and `status_at` = the `wwcc_status_at` it set; she gets 3i's re-check email instead.
 *   A row is skipped only when such a marker matches her current `wwcc_status_at` — so a once-approved nanny whose
 *   LATER new upload fails gets VER-003 again. Only once-approved rows (`wwcc_verified_at` set) can carry a marker, so
 *   only they are looked up. If the marker read fails, once-approved rows are held back this run (never a double email;
 *   the cron retries every 5 minutes) and first checks still go.
 * Admin Reject (22, `rejected`) is not in the list: README P-4's own email covers it.
 * The caller keeps the "no action since" (2-second) test and the `email_logs` dedupe.
 *
 * Input: an admin Supabase client and the cutoff ISO time. Output: the rows (id, user_id, wwcc_status_at, updated_at).
 * Never: writes, sends, or throws — a read error is logged and returns no rows, so the cron's other emails still go.
 */
import { DBS_ACTIVITY } from "@/lib/verification";
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

/** The `wwcc_status` values that mean a first-check DBS failure worth VER-003 (#20). */
export const VER003_DBS_STATUSES = ["failed", "expired", "ocg_not_found"] as const;

export interface Ver003Candidate {
  id: string;
  user_id: string;
  wwcc_status_at: string;
  updated_at: string;
  wwcc_verified_at?: string | null;
}

/** True when `a` and `b` are the same instant (Postgres and JS print timestamps differently). */
function sameInstant(a: unknown, b: unknown): boolean {
  const x = Date.parse(String(a));
  return Number.isFinite(x) && x === Date.parse(String(b));
}

/** Drops rows whose current failure is a marked re-check failure (see the header). Never throws. */
async function withoutRecheckFailures(supabase: AdminClient, rows: Ver003Candidate[]): Promise<Ver003Candidate[]> {
  const onceApproved = rows.filter((r) => r.wwcc_verified_at);
  if (onceApproved.length === 0) return rows;
  const { data, error } = await supabase
    .from("activity_logs")
    .select("user_id, action_details")
    .eq("action_type", DBS_ACTIVITY.STATUS_CHECK)
    .filter("action_details->>recheck_fail", "eq", "true") // in the database: no row page can push a marker out
    .in("user_id", [...new Set(onceApproved.map((r) => r.user_id))]);
  if (error) {
    console.error("[Delayed Emails] VER-003 re-check marker read failed:", error.message);
    return rows.filter((r) => !r.wwcc_verified_at);
  }
  const markers = ((data ?? []) as Array<{ user_id: string; action_details: Record<string, unknown> | null }>).filter(
    (l) => l.action_details?.recheck_fail === true,
  );
  return rows.filter(
    (r) => !markers.some((m) => m.user_id === r.user_id && sameInstant(m.action_details?.status_at, r.wwcc_status_at)),
  );
}

/** First-check DBS failures idle since before `cutoffIso` (see the module header for the rule). */
export async function selectVer003Candidates(supabase: AdminClient, cutoffIso: string): Promise<Ver003Candidate[]> {
  const { data, error } = await supabase
    .from("verifications")
    .select("id, user_id, wwcc_status_at, updated_at, wwcc_verified_at")
    .in("wwcc_status", [...VER003_DBS_STATUSES])
    .lt("wwcc_status_at", cutoffIso);
  if (error) {
    console.error("[Delayed Emails] VER-003 candidates read failed:", error.message);
    return [];
  }
  return withoutRecheckFailures(supabase, (data ?? []) as Ver003Candidate[]);
}
