/**
 * The admin DBS sub-tab's data: the four lists, their chips, and the Verification-tab stat counts (unit 3d, brief
 * changes 9 + 10; spec §1, §2.1; 00-RULINGS #25, #30, #35; README fixed point "constants: 3a only").
 *
 * Lists (rows split in code from ONE verifications query):
 * - A `awaiting`      30 — BLANK first, then NON_BLANK; oldest `wwcc_status_at` first within each.
 * - B `needsPerson`   21, plus the API-down state (#30: status 20, `doc_verified`, cross-check `pending`).
 * - C `recheckAlerts` 23 / 26 that were approved once (`wwcc_verified_at` set) — the re-check alert surface (#35).
 * - D `barred`        27.
 * Sub-tab badge = |A| + |B|.
 *
 * Contract
 * - Input: the service-role client (passed in — this module imports no server runtime, so client components can use
 *   its pure helpers and types). Output: plain serialisable objects; the certificate as a 1-hour signed URL.
 * - Code sets come from `lib/verification.ts` (3a): `ADMIN_PENDING_CODES` and `VERIFICATION_STATUS`; no local list.
 * - Never: writes anything, returns a storage path instead of a signed URL, or returns the certificate number in a
 *   log/history entry.
 */
import type { createAdminClient } from "@/lib/supabase/admin";
import { ADMIN_PENDING_CODES, DBS_ACTIVITY, DBS_API_RESULT, VERIFICATION_STATUS } from "@/lib/verification";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface DbsHistoryEntry {
  action_type: string;
  action_details: Record<string, unknown> | null;
  created_at: string;
}

/** The fields the queue split and chips read. */
export interface DbsQueueRow {
  id: string;
  user_id: string;
  verification_status: number;
  wwcc_status: string | null;
  wwcc_status_at: string | null;
  cross_check_status: string | null;
  cross_check_issues: string[] | null;
  wwcc_user_guidance: { confidence?: string; reason_code?: string } | null;
  ocg_result_status: string | null;
  ocg_verified_at: string | null;
  wwcc_verified_at: string | null;
  extracted_wwcc_clearance_type: string | null;
  history: DbsHistoryEntry[];
}

/** One row of the DBS sub-tab + everything `DBSCheckModal` shows (spec §2.1). */
export interface PendingDbsCheck extends DbsQueueRow {
  identity_status: string | null;
  cross_check_reasoning: string | null;
  ocg_result_text: string | null;
  wwcc_verified_by: string | null;
  certificate_url: string | null;
  is_pdf: boolean;
  extracted_wwcc_number: string | null;
  extracted_wwcc_surname: string | null;
  extracted_wwcc_first_name: string | null;
  extracted_wwcc_other_names: string | null;
  extracted_wwcc_dob: string | null;
  extracted_wwcc_expiry: string | null;
  extracted_surname: string | null;
  extracted_given_names: string | null;
  extracted_dob: string | null;
  wwcc_ai_reasoning: string | null;
  wwcc_ai_issues: string | null;
  wwcc_rejection_reason: string | null;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  profile_picture_url: string | null;
  created_at: string;
  /** Latest `dbs_status_check` ERROR time, for the "API not answering since" chip (#25). */
  api_down_since: string | null;
}

export interface DbsQueues<T extends DbsQueueRow = DbsQueueRow> {
  awaiting: T[];
  needsPerson: T[];
  recheckAlerts: T[];
  barred: T[];
  badgeCount: number;
}

export type DbsListKey = "awaiting" | "needsPerson" | "recheckAlerts" | "barred";

/** #30: the first check never completed because the Update Service did not answer. */
export function isApiDownState(r: Pick<DbsQueueRow, "verification_status" | "wwcc_status" | "cross_check_status">): boolean {
  return (
    r.verification_status === VERIFICATION_STATUS.PENDING_WWCC_AUTO &&
    r.wwcc_status === "doc_verified" &&
    r.cross_check_status === "pending"
  );
}

const byOldest = (a: DbsQueueRow, b: DbsQueueRow) => String(a.wwcc_status_at ?? "").localeCompare(String(b.wwcc_status_at ?? ""));

/** Splits rows into lists A–D (header). Pure; returns new arrays and never reorders the input. */
export function splitDbsQueues<T extends DbsQueueRow>(rows: readonly T[]): DbsQueues<T> {
  const awaiting = rows
    .filter((r) => r.verification_status === VERIFICATION_STATUS.PROVISIONALLY_VERIFIED)
    .slice()
    .sort((a, b) => {
      const rank = (r: DbsQueueRow) => (r.ocg_result_status === DBS_API_RESULT.BLANK ? 0 : 1);
      return rank(a) - rank(b) || byOldest(a, b);
    });
  const needsPerson = rows.filter((r) => r.verification_status === VERIFICATION_STATUS.PENDING_WWCC_REVIEW || isApiDownState(r));
  const recheckAlerts = rows.filter(
    (r) =>
      (r.verification_status === VERIFICATION_STATUS.DBS_NEW_INFO || r.verification_status === VERIFICATION_STATUS.DBS_NO_MATCH) &&
      r.wwcc_verified_at != null,
  );
  const barred = rows.filter((r) => r.verification_status === VERIFICATION_STATUS.DBS_BARRED);
  return { awaiting, needsPerson, recheckAlerts, barred, badgeCount: awaiting.length + needsPerson.length };
}

/** List B "why here" chip from existing fields (brief change 9). Null outside list B's 21 rows. */
export function whyHereChip(r: DbsQueueRow): string | null {
  if (r.verification_status !== VERIFICATION_STATUS.PENDING_WWCC_REVIEW) return null;
  if (r.cross_check_status === "review") {
    return (r.cross_check_issues ?? []).includes("api_mismatch") ? "API details differ" : "Name/DOB mismatch";
  }
  if (r.wwcc_user_guidance?.confidence === "low") return "AI unsure";
  return "Nanny asked for review";
}

/** True when the certificate reports disclosed content (`has_disclosed_content`). Unparseable JSON = false. */
export function hasDisclosedContent(r: Pick<DbsQueueRow, "extracted_wwcc_clearance_type">): boolean {
  if (!r.extracted_wwcc_clearance_type) return false;
  try {
    return JSON.parse(r.extracted_wwcc_clearance_type)?.has_disclosed_content === true;
  } catch {
    return false;
  }
}

/** Amber "Has a record" chip — and the condition for "Ask for page 2" (#27): NON_BLANK or disclosed content. */
export function hasRecordChip(r: Pick<DbsQueueRow, "ocg_result_status" | "extracted_wwcc_clearance_type">): boolean {
  return r.ocg_result_status === DBS_API_RESULT.NON_BLANK || hasDisclosedContent(r);
}

/** Her latest `dbs_status_check` row whose result is ERROR (#25: read from the log, no counter column). */
export function apiDownSince(history: readonly DbsHistoryEntry[]): string | null {
  const errors = history
    .filter((h) => h.action_type === DBS_ACTIVITY.STATUS_CHECK && h.action_details?.result === "ERROR")
    .map((h) => h.created_at)
    .sort();
  return errors.length > 0 ? errors[errors.length - 1] : null;
}

/** Longest admin-typed reason accepted (Reject, Bar). It is shown to her and kept in the audit log. */
export const ADMIN_REASON_MAX_LENGTH = 1000;

/**
 * True when the stored Update Service result belongs to her CURRENT certificate: checked at or after her latest DBS
 * upload/decision time (`wwcc_status_at`). The ocg_* block survives a re-upload as history, so an older pass must
 * never enable Approve (code review M2). Missing upload time = trust the result; missing check time = not current.
 */
export function isApiResultCurrent(r: { ocg_verified_at: string | null; wwcc_status_at: string | null }): boolean {
  if (!r.wwcc_status_at) return true;
  if (!r.ocg_verified_at) return false;
  return new Date(r.ocg_verified_at).getTime() >= new Date(r.wwcc_status_at).getTime();
}

// ── Stats (spec §1.3) ──

export interface VerificationStats {
  pending: number;
  approvedToday: number;
  rejectedToday: number;
  totalVerified: number;
}

/** Pending = ADMIN_PENDING_CODES · approved today = 40 · rejected today = 12, 22, 27 · total verified = 40. */
export async function fetchVerificationStats(supabase: AdminClient): Promise<VerificationStats> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const since = today.toISOString();
  const count = () => supabase.from("verifications").select("*", { count: "exact", head: true });

  const [pending, approvedToday, rejectedToday, totalVerified] = await Promise.all([
    count().in("verification_status", [...ADMIN_PENDING_CODES]),
    count().eq("verification_status", VERIFICATION_STATUS.FULLY_VERIFIED).gte("wwcc_verified_at", since),
    count()
      .in("verification_status", [VERIFICATION_STATUS.ID_REJECTED, VERIFICATION_STATUS.WWCC_REJECTED, VERIFICATION_STATUS.DBS_BARRED])
      .gte("updated_at", since),
    count().eq("verification_status", VERIFICATION_STATUS.FULLY_VERIFIED),
  ]);

  return {
    pending: pending.count ?? 0,
    approvedToday: approvedToday.count ?? 0,
    rejectedToday: rejectedToday.count ?? 0,
    totalVerified: totalVerified.count ?? 0,
  };
}

// ── Queue fetch ──

/** Statuses the one query reads; the split above decides membership. */
const QUEUE_QUERY_CODES = [
  VERIFICATION_STATUS.PENDING_WWCC_AUTO,
  VERIFICATION_STATUS.PENDING_WWCC_REVIEW,
  VERIFICATION_STATUS.DBS_NEW_INFO,
  VERIFICATION_STATUS.DBS_NO_MATCH,
  VERIFICATION_STATUS.DBS_BARRED,
  VERIFICATION_STATUS.PROVISIONALLY_VERIFIED,
];

const QUEUE_COLUMNS = [
  "id, user_id, created_at, verification_status, identity_status",
  "wwcc_status, wwcc_status_at, wwcc_service_nsw_screenshot_url, wwcc_rejection_reason, wwcc_user_guidance",
  "wwcc_ai_reasoning, wwcc_ai_issues, wwcc_verified_at, wwcc_verified_by",
  "extracted_wwcc_number, extracted_wwcc_surname, extracted_wwcc_first_name, extracted_wwcc_other_names",
  "extracted_wwcc_dob, extracted_wwcc_expiry, extracted_wwcc_clearance_type",
  "extracted_surname, extracted_given_names, extracted_dob",
  "cross_check_status, cross_check_reasoning, cross_check_issues",
  "ocg_result_status, ocg_result_text, ocg_verified_at",
].join(", ");

const HISTORY_PER_USER = 10;
const SIGNED_URL_SECONDS = 3600;

type Raw = Record<string, unknown>;
const str = (v: unknown): string | null => (typeof v === "string" ? v : null);

function issuesOf(v: unknown): string[] | null {
  if (Array.isArray(v)) return v.map(String);
  if (typeof v === "string") {
    try {
      const p = JSON.parse(v);
      return Array.isArray(p) ? p.map(String) : null;
    } catch {
      return null;
    }
  }
  return null;
}

/** The activity types the modal's history shows, and the only detail keys it renders (security review M2). */
const HISTORY_TYPES = [
  "verification_approved", "verification_rejected", "user_suspended", "user_reinstated",
  DBS_ACTIVITY.STATUS_CHECK, DBS_ACTIVITY.PAGE2_REQUESTED,
];
const HISTORY_KEYS = ["admin_id", "decision", "trigger", "result", "reason"];

function projectDetails(d: unknown): Record<string, unknown> | null {
  if (!d || typeof d !== "object") return null;
  return Object.fromEntries(Object.entries(d as Record<string, unknown>).filter(([k]) => HISTORY_KEYS.includes(k)));
}

/** The last HISTORY_PER_USER DBS-decision rows per user, newest first, details projected to HISTORY_KEYS. */
async function historyByUser(supabase: AdminClient, userIds: string[]): Promise<Map<string, DbsHistoryEntry[]>> {
  const map = new Map<string, DbsHistoryEntry[]>();
  if (userIds.length === 0) return map;
  const { data, error } = await supabase
    .from("activity_logs")
    .select("user_id, action_type, action_details, created_at")
    .in("user_id", userIds)
    .in("action_type", HISTORY_TYPES)
    .order("created_at", { ascending: false })
    .limit(HISTORY_PER_USER * userIds.length * 3);
  if (error) console.error("[getDbsQueues] history error:", error.message);
  for (const r of data ?? []) {
    const list = map.get(r.user_id) ?? [];
    if (list.length < HISTORY_PER_USER) {
      map.set(r.user_id, [...list, { action_type: r.action_type, action_details: projectDetails(r.action_details), created_at: r.created_at }]);
    }
  }
  return map;
}

/** Lists A–D for the DBS sub-tab (brief change 9). Errors are logged and yield empty lists — the page still renders. */
export async function getDbsQueues(supabase: AdminClient): Promise<DbsQueues<PendingDbsCheck>> {
  const { data, error } = await supabase
    .from("verifications")
    .select(QUEUE_COLUMNS)
    .in("verification_status", QUEUE_QUERY_CODES)
    .not("wwcc_verification_method", "is", null)
    .order("created_at", { ascending: true })
    .limit(200);
  if (error || !data) {
    if (error) console.error("[getDbsQueues] verifications error:", error.message);
    return splitDbsQueues<PendingDbsCheck>([]);
  }

  const rows = data as unknown as Raw[];
  const userIds = Array.from(new Set(rows.map((r) => String(r.user_id))));
  const [profilesResult, history] = await Promise.all([
    supabase.from("user_profiles").select("user_id, first_name, last_name, email, profile_picture_url").in("user_id", userIds),
    historyByUser(supabase, userIds),
  ]);
  const profiles = new Map((profilesResult.data ?? []).map((p) => [p.user_id, p]));

  const checks: PendingDbsCheck[] = [];
  for (const v of rows) {
    const path = str(v.wwcc_service_nsw_screenshot_url);
    let certificateUrl: string | null = null;
    if (path) {
      const { data: signed } = await supabase.storage.from("verification-documents").createSignedUrl(path, SIGNED_URL_SECONDS);
      certificateUrl = signed?.signedUrl ?? null;
    }
    const userId = String(v.user_id);
    const profile = profiles.get(userId);
    const hist = history.get(userId) ?? [];
    checks.push({
      id: String(v.id),
      user_id: userId,
      created_at: String(v.created_at),
      verification_status: Number(v.verification_status),
      identity_status: str(v.identity_status),
      wwcc_status: str(v.wwcc_status),
      wwcc_status_at: str(v.wwcc_status_at),
      wwcc_rejection_reason: str(v.wwcc_rejection_reason),
      wwcc_user_guidance: (v.wwcc_user_guidance as PendingDbsCheck["wwcc_user_guidance"]) ?? null,
      wwcc_ai_reasoning: str(v.wwcc_ai_reasoning),
      wwcc_ai_issues: typeof v.wwcc_ai_issues === "string" ? v.wwcc_ai_issues : v.wwcc_ai_issues ? JSON.stringify(v.wwcc_ai_issues) : null,
      wwcc_verified_at: str(v.wwcc_verified_at),
      wwcc_verified_by: str(v.wwcc_verified_by),
      extracted_wwcc_number: str(v.extracted_wwcc_number),
      extracted_wwcc_surname: str(v.extracted_wwcc_surname),
      extracted_wwcc_first_name: str(v.extracted_wwcc_first_name),
      extracted_wwcc_other_names: str(v.extracted_wwcc_other_names),
      extracted_wwcc_dob: str(v.extracted_wwcc_dob),
      extracted_wwcc_expiry: str(v.extracted_wwcc_expiry),
      extracted_wwcc_clearance_type: str(v.extracted_wwcc_clearance_type),
      extracted_surname: str(v.extracted_surname),
      extracted_given_names: str(v.extracted_given_names),
      extracted_dob: str(v.extracted_dob),
      cross_check_status: str(v.cross_check_status),
      cross_check_reasoning: str(v.cross_check_reasoning),
      cross_check_issues: issuesOf(v.cross_check_issues),
      ocg_result_status: str(v.ocg_result_status),
      ocg_result_text: str(v.ocg_result_text),
      ocg_verified_at: str(v.ocg_verified_at),
      certificate_url: certificateUrl,
      is_pdf: path ? path.toLowerCase().endsWith(".pdf") : false,
      first_name: profile?.first_name ?? null,
      last_name: profile?.last_name ?? null,
      email: profile?.email ?? null,
      profile_picture_url: profile?.profile_picture_url ?? null,
      history: hist,
      api_down_since: apiDownSince(hist),
    });
  }
  return splitDbsQueues(checks);
}
