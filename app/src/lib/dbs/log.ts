/**
 * One `activity_logs` row per Update Service call (00-RULINGS #33): action `dbs_status_check`, details
 * `{ trigger, result, reason? }`. Never the certificate number, name or date of birth.
 *
 * Contract
 * - Input: the user id and `{ trigger: first | retry | admin | recheck, result, reason? }`.
 * - Output: one insert into `activity_logs` (action type from 3a's DBS_ACTIVITY); errors are reported, not thrown.
 * - Never: stores the certificate number, names, date of birth or raw API body; never logs a re-check PASS (#33 —
 *   the caller, 3i, skips it).
 * - Unit 3i (BB-LDN-3i-141026): a level-4 failure (daily re-check, or the admin's P-8 run) adds the re-check marker —
 *   `recheck_fail: true`, `status_at` (the `wwcc_status_at` that failure wrote) and the connection counts `kept`,
 *   `dropped`, `not_dropped` (+ `warnings` when a follow-up failed). `selectVer003Candidates` reads the marker so VER-003
 *   skips exactly that failure and no later one (addendum M1). Counts only — never a family's name.
 *   Code review MEDIUM 1: the marker is written FIRST (`markRecheckFailure`, right after the guarded UPDATE, before
 *   the sync, drop and emails) and the same row is completed with the counts afterwards (`completeRecheckFailure`), so
 *   a run killed mid-way still leaves the marker VER-003 needs.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { randomUUID } from "node:crypto";
import { DBS_ACTIVITY } from "@/lib/verification";

export type DbsCheckTrigger = "first" | "retry" | "admin" | "recheck";

export interface DbsStatusCheckLog {
  trigger: DbsCheckTrigger;
  /** BLANK / NON_BLANK / NEW_INFO / NO_MATCH / ERROR */
  result: string;
  reason?: string;
  /** Set only for a level-4 failure (3i): the marker VER-003 reads, plus what happened to her connections. */
  recheckFail?: RecheckFailMarker;
}

/** The re-check failure marker (3i, addendum M1). Counts only. */
export interface RecheckFailMarker {
  statusAt: string;
  kept: number;
  dropped: number;
  notDropped: number;
  warnings?: string[];
}

type AdminClient = ReturnType<typeof createAdminClient>;

export async function logDbsStatusCheck(userId: string, entry: DbsStatusCheckLog, admin: AdminClient = createAdminClient()): Promise<void> {
  const details: Record<string, unknown> = { trigger: entry.trigger, result: entry.result };
  if (entry.reason) details.reason = entry.reason;
  const m = entry.recheckFail;
  if (m) {
    Object.assign(details, { recheck_fail: true, status_at: m.statusAt, kept: m.kept, dropped: m.dropped, not_dropped: m.notDropped });
    if (m.warnings && m.warnings.length > 0) details.warnings = m.warnings;
  }
  const { error } = await admin
    .from("activity_logs")
    .insert({ user_id: userId, action_type: DBS_ACTIVITY.STATUS_CHECK, action_details: details });
  // A lost log row must not undo the check itself; it is reported, not swallowed.
  if (error) console.error("[dbs] could not write the dbs_status_check log row:", error.message);
}

/** The marker's details (see the header). */
function markerDetails(trigger: DbsCheckTrigger, result: string, m: RecheckFailMarker): Record<string, unknown> {
  const details: Record<string, unknown> = {
    trigger, result, recheck_fail: true, status_at: m.statusAt, kept: m.kept, dropped: m.dropped, not_dropped: m.notDropped,
  };
  if (m.warnings && m.warnings.length > 0) details.warnings = m.warnings;
  return details;
}

/**
 * Writes the re-check failure marker before any follow-up (code review MEDIUM 1). Counts start at 0.
 * @returns the row id, or null when the insert failed (reported; the caller then logs the full row at the end).
 */
export async function markRecheckFailure(
  admin: AdminClient,
  userId: string,
  entry: { trigger: DbsCheckTrigger; result: string; statusAt: string },
): Promise<string | null> {
  const id = randomUUID();
  const { error } = await admin.from("activity_logs").insert({
    id,
    user_id: userId,
    action_type: DBS_ACTIVITY.STATUS_CHECK,
    action_details: markerDetails(entry.trigger, entry.result, { statusAt: entry.statusAt, kept: 0, dropped: 0, notDropped: 0 }),
  });
  if (error) {
    console.error("[dbs] could not write the re-check marker row:", error.message);
    return null;
  }
  return id;
}

/**
 * Completes a failure: updates the marker row with the counts and warnings, or — when the marker was never written —
 * inserts the full row now (a second chance). Errors are reported, not thrown.
 */
export async function completeRecheckFailure(
  admin: AdminClient,
  userId: string,
  markerId: string | null,
  entry: { trigger: DbsCheckTrigger; result: string; marker: RecheckFailMarker },
): Promise<void> {
  if (!markerId) {
    await logDbsStatusCheck(userId, { trigger: entry.trigger, result: entry.result, recheckFail: entry.marker }, admin);
    return;
  }
  const { error } = await admin
    .from("activity_logs")
    .update({ action_details: markerDetails(entry.trigger, entry.result, entry.marker) })
    .eq("id", markerId);
  if (error) console.error("[dbs] could not complete the re-check marker row:", error.message);
}
