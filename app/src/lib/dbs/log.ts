/**
 * One `activity_logs` row per Update Service call (00-RULINGS #33): action `dbs_status_check`, details
 * `{ trigger, result, reason? }`. Never the certificate number, name or date of birth.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { DBS_ACTIVITY } from "@/lib/verification";

export type DbsCheckTrigger = "first" | "retry" | "admin" | "recheck";

export interface DbsStatusCheckLog {
  trigger: DbsCheckTrigger;
  /** BLANK / NON_BLANK / NEW_INFO / NO_MATCH / ERROR */
  result: string;
  reason?: string;
}

type AdminClient = ReturnType<typeof createAdminClient>;

export async function logDbsStatusCheck(userId: string, entry: DbsStatusCheckLog, admin: AdminClient = createAdminClient()): Promise<void> {
  const details: Record<string, string> = { trigger: entry.trigger, result: entry.result };
  if (entry.reason) details.reason = entry.reason;
  const { error } = await admin
    .from("activity_logs")
    .insert({ user_id: userId, action_type: DBS_ACTIVITY.STATUS_CHECK, action_details: details });
  // A lost log row must not undo the check itself; it is reported, not swallowed.
  if (error) console.error("[dbs] could not write the dbs_status_check log row:", error.message);
}
