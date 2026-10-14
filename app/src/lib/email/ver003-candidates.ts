/**
 * VER-003 "Your DBS check needs attention" — who is a candidate (unit 3g, BB-LDN-3g-141026; 00-RULINGS #20).
 *
 * Purpose: the one filter the `send-delayed-emails` cron uses to pick VER-003 rows, exported so 3i's R14 test can
 * prove a re-check failure never also gets VER-003. Lives outside the route because a Next.js route file may export
 * only route fields.
 *
 * Rule: a FIRST-check DBS failure that has sat untouched past the cutoff —
 *   `wwcc_status IN ('failed', 'expired', 'ocg_not_found')` (AI fail · 23 new information · 26 no match; D-4 names)
 *   AND `wwcc_verified_at IS NULL` (never approved: a re-check failure has an approval in its history and gets 3i's
 *   re-check email instead) AND `wwcc_status_at < cutoff` (the 10-minute delay).
 * Admin Reject (22, `rejected`) is not in the list: README P-4's own email covers it.
 * The caller keeps the "no action since" (2-second) test and the `email_logs` dedupe.
 *
 * Input: an admin Supabase client and the cutoff ISO time. Output: the rows (id, user_id, wwcc_status_at, updated_at).
 * Never: writes, sends, or throws — a read error is logged and returns no rows, so the cron's other emails still go.
 */
import type { createAdminClient } from "@/lib/supabase/admin";

type AdminClient = ReturnType<typeof createAdminClient>;

/** The `wwcc_status` values that mean a first-check DBS failure worth VER-003 (#20). */
export const VER003_DBS_STATUSES = ["failed", "expired", "ocg_not_found"] as const;

export interface Ver003Candidate {
  id: string;
  user_id: string;
  wwcc_status_at: string;
  updated_at: string;
}

/** First-check DBS failures idle since before `cutoffIso` (see the module header for the rule). */
export async function selectVer003Candidates(supabase: AdminClient, cutoffIso: string): Promise<Ver003Candidate[]> {
  const { data, error } = await supabase
    .from("verifications")
    .select("id, user_id, wwcc_status_at, updated_at")
    .in("wwcc_status", [...VER003_DBS_STATUSES])
    .is("wwcc_verified_at", null)
    .lt("wwcc_status_at", cutoffIso);
  if (error) {
    console.error("[Delayed Emails] VER-003 candidates read failed:", error.message);
    return [];
  }
  return (data ?? []) as Ver003Candidate[];
}
