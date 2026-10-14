/**
 * The daily DBS re-check (unit 3i, BB-LDN-3i-141026) — the work behind `GET /api/cron/dbs-recheck`, plus the
 * after-fail step it shares with the admin's "Run DBS check now" on a level-4 nanny (README P-8).
 * Plain server module (NOT 'use server': nothing here is callable from the browser).
 *
 * Rulings: 00-RULINGS #12 (daily re-check of level-4 nannies; pass = no change, no queue; fail automatic → 23 / 26,
 * level 2, her email, admin alert) · #28 (`wwcc_verified=false`, approval history kept, last check in
 * `ocg_verified_at`) · #32 (API error → nothing changes, one log row, retried tomorrow) · #33 (passes not logged; fails
 * and errors logged as `dbs_status_check` `{trigger:'recheck', result}`) · #35 (alert = list C + admin email) ·
 * README P-3 (hired kept, the rest dropped), P-7 (level 2 via the cross-check reset in the same UPDATE — the mapper),
 * P-8 (admin run on level 4 = a failed re-check), P-9 (parents told nothing), P-10 (no nudges — 3g), P-14 (a bar is not
 * handled here — 3d's sync drops everything and sends the one VER-011).
 *
 * `runDbsRecheck(admin, deps)`
 * - Selects `verifications` at 40 with `wwcc_verified=true`, least recently checked first (`ocg_verified_at` ASC, nulls
 *   first), up to the batch limit; keeps only nannies at `verification_level = 4`.
 * - Sequential: the configured pause between calls; no new check starts once the time budget is spent (the rest are
 *   first tomorrow). One nanny's throw never stops the batch (counted as an error).
 * - Per nanny: missing number / surname / DOB → skipped + one error row (`missing_details`), never failed. ERROR →
 *   nothing written, one error row. Pass → the mapper writes the result block only, nothing logged. NEW_INFO / NO_MATCH
 *   → the mapper's guarded fail UPDATE; if it matched her row → `onDbsRecheckFailed` → one log row with the marker. A
 *   guarded UPDATE that matched nothing (an admin moved her meanwhile) → no email, no log (`skipped`).
 * - First (security review M2): `reconcileHalfFailed` repairs any nanny whose earlier re-check fail half-applied — her
 *   `nannies` row still says level 4 while her verification is 23 / 26 with an approval in its history (sync or drop
 *   failed, or a run was killed after the guarded UPDATE). It re-runs the idempotent sync and P-3 drop; no email is
 *   re-sent (the fail already sent them, or the log row's warnings say they failed). A read error here never blocks
 *   the run.
 * - Output: counts only `{ checked, passed, failed_new_info, failed_no_match, errors, skipped, stopped_on_budget,
 *   reconciled }`.
 *
 * `onDbsRecheckFailed(admin, { userId, nannyId?, result })` — after a guarded fail UPDATE matched her row (and the
 * marker row was written — code review MEDIUM 1): the unchanged sync (→ level 2), a re-read of her level (MEDIUM 2: the
 * sync ignores its own write error, so a level still ≥ 3 is reported as `sync_not_applied`), the P-3 drop, her email
 * (3g's `sendDbsRecheckFailedEmail`), the admin alert. Each step's failure is caught and returned as a warning, so the
 * rest still run and the log row records it.
 *
 * Never: logs or returns a name, certificate number or date of birth; writes 40 or `wwcc_verified=true`; touches
 * identity; calls the live DBS URL in tests (the adapter is injected); messages a parent.
 */
import type { createAdminClient } from "@/lib/supabase/admin";
import { syncNannyVerificationState } from "@/lib/actions/verification";
import { checkDbsStatus, type DbsCheckInput, type DbsCheckResult } from "./update-service";
import { applyDbsResult, type DbsApplyResult } from "./map-dbs-outcome";
import { getDbsRecheckConfig, type DbsRecheckConfig } from "./config";
import { completeRecheckFailure, logDbsStatusCheck, markRecheckFailure } from "./log";
import { dropNonHiredConnections } from "./recheck-connections";
import { sendDbsRecheckAdminAlert, sendDbsRecheckFailedEmail, type DbsRecheckFailure } from "@/lib/email/dbs-emails";
import { VERIFICATION_LEVEL, VERIFICATION_STATUS, type IdentityStatus } from "@/lib/verification";

type AdminClient = ReturnType<typeof createAdminClient>;

export interface RecheckSummary {
  checked: number;
  passed: number;
  failed_new_info: number;
  failed_no_match: number;
  errors: number;
  skipped: number;
  stopped_on_budget: boolean;
  /** Half-failed earlier re-check fails repaired this run (security review M2). */
  reconciled: number;
}

export interface RecheckDeps {
  check?: (input: DbsCheckInput) => Promise<DbsCheckResult>;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
  config?: DbsRecheckConfig;
}

export interface RecheckFailOutcome {
  kept: number;
  dropped: number;
  notDropped: number;
  warnings: string[];
}

interface Candidate {
  id: string;
  user_id: string;
  identity_status: string;
  extracted_wwcc_number: string | null;
  extracted_wwcc_surname: string | null;
  extracted_wwcc_dob: string | null;
  extracted_wwcc_first_name: string | null;
  extracted_wwcc_expiry: string | null;
}

type Kind = "passed" | "new_info" | "no_match" | "error" | "skipped";

const CANDIDATE_COLUMNS =
  "id, user_id, identity_status, extracted_wwcc_number, extracted_wwcc_surname, extracted_wwcc_dob, " +
  "extracted_wwcc_first_name, extracted_wwcc_expiry, ocg_verified_at";

/** Keeps the `.in()` list short enough for a PostgREST URL. */
const USER_ID_CHUNK = 100;

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs one step; a throw becomes a warning (logged without PII), so the remaining steps still run. */
async function attempt<T>(warnings: string[], label: string, step: () => Promise<T>): Promise<T | undefined> {
  try {
    return await step();
  } catch (err) {
    console.error(`[dbs-recheck] ${label}:`, err instanceof Error ? err.message : "unknown");
    warnings.push(label);
    return undefined;
  }
}

/**
 * After a guarded fail UPDATE matched her row (cron or the admin's P-8 run): sync → level 2, P-3 drop, her email,
 * the admin alert. Never throws; failures come back as `warnings`.
 */
export async function onDbsRecheckFailed(
  admin: AdminClient,
  args: { userId: string; nannyId?: string; result: DbsRecheckFailure },
): Promise<RecheckFailOutcome> {
  const warnings: string[] = [];
  await attempt(warnings, "sync_failed", () => syncNannyVerificationState(args.userId));

  const nanny = await attempt(warnings, "nanny_read_failed", async () => {
    const { data, error } = await admin.from("nannies").select("id, verification_level").eq("user_id", args.userId).maybeSingle();
    if (error) throw new Error(error.message);
    return data as { id: string; verification_level: number } | null;
  });
  if (nanny && nanny.verification_level >= VERIFICATION_LEVEL.PROVISIONALLY_VERIFIED) warnings.push("sync_not_applied");
  const nannyId = args.nannyId ?? nanny?.id;

  const counts = nannyId
    ? await attempt(warnings, "connections_not_dropped", () => dropNonHiredConnections(admin, nannyId))
    : undefined;
  const { kept = 0, dropped = 0, notDropped = 0 } = counts ?? {};

  await attempt(warnings, "nanny_email_failed", () => sendDbsRecheckFailedEmail(args.userId, args.result));
  await attempt(warnings, "admin_email_failed", () =>
    sendDbsRecheckAdminAlert(args.userId, args.result, { checkedAt: new Date().toISOString(), kept, dropped, notDropped }),
  );
  return { kept, dropped, notDropped, warnings };
}

/** A failed re-check's verification status (23 / 26) — the rows reconcile looks for. */
const RECHECK_FAIL_STATUSES = [VERIFICATION_STATUS.DBS_NEW_INFO, VERIFICATION_STATUS.DBS_NO_MATCH];

/**
 * Security review M2: nannies still at level 4 whose verification is a re-check fail (23 / 26, approval in history) —
 * re-sync + P-3 drop, no emails. Returns how many were repaired; never throws.
 */
async function reconcileHalfFailed(admin: AdminClient): Promise<number> {
  try {
    const { data: nannies, error } = await admin.from("nannies").select("id, user_id").eq("verification_level", VERIFICATION_LEVEL.FULLY_VERIFIED);
    if (error) throw new Error(error.message);
    const nannyOf = new Map((nannies ?? []).map((n) => [n.user_id as string, n.id as string]));
    const userIds = [...nannyOf.keys()];
    let repaired = 0;
    for (let i = 0; i < userIds.length; i += USER_ID_CHUNK) {
      const { data: rows, error: vErr } = await admin
        .from("verifications")
        .select("user_id, wwcc_verified_at")
        .in("verification_status", RECHECK_FAIL_STATUSES)
        .in("user_id", userIds.slice(i, i + USER_ID_CHUNK));
      if (vErr) throw new Error(vErr.message);
      for (const r of (rows ?? []).filter((x) => x.wwcc_verified_at)) {
        await syncNannyVerificationState(r.user_id as string);
        await dropNonHiredConnections(admin, nannyOf.get(r.user_id as string)!);
        repaired++;
      }
    }
    return repaired;
  } catch (err) {
    console.error("[dbs-recheck] reconcile pass failed:", err instanceof Error ? err.message : "unknown");
    return 0;
  }
}

/** The level-4 rows to check today, oldest-checked first (see the module header). Throws on a read error. */
async function selectCandidates(admin: AdminClient, batchLimit: number): Promise<{ row: Candidate; nannyId: string }[]> {
  const { data, error } = await admin
    .from("verifications")
    .select(CANDIDATE_COLUMNS)
    .eq("verification_status", VERIFICATION_STATUS.FULLY_VERIFIED)
    .eq("wwcc_verified", true)
    .order("ocg_verified_at", { ascending: true, nullsFirst: true })
    .limit(batchLimit);
  if (error) throw new Error(`re-check selection failed: ${error.message}`);
  const rows = (data ?? []) as unknown as Candidate[];

  const nannyOf = new Map<string, string>();
  const userIds = [...new Set(rows.map((r) => r.user_id))];
  for (let i = 0; i < userIds.length; i += USER_ID_CHUNK) {
    const { data: nannies, error: nErr } = await admin
      .from("nannies")
      .select("id, user_id")
      .eq("verification_level", VERIFICATION_LEVEL.FULLY_VERIFIED)
      .in("user_id", userIds.slice(i, i + USER_ID_CHUNK));
    if (nErr) throw new Error(`re-check nanny read failed: ${nErr.message}`);
    for (const n of nannies ?? []) nannyOf.set(n.user_id as string, n.id as string);
  }
  return rows.filter((r) => nannyOf.has(r.user_id)).map((row) => ({ row, nannyId: nannyOf.get(row.user_id)! }));
}

/** Checks one nanny and applies the result (see the module header). */
async function checkOne(
  admin: AdminClient,
  row: Candidate,
  nannyId: string,
  check: (input: DbsCheckInput) => Promise<DbsCheckResult>,
): Promise<Kind> {
  let result: DbsCheckResult;
  try {
    result = await check({
      certificateNumber: row.extracted_wwcc_number ?? "",
      surname: row.extracted_wwcc_surname ?? "",
      dateOfBirth: row.extracted_wwcc_dob ?? "",
    });
  } catch (err) {
    console.error("[dbs-recheck] Update Service adapter threw:", err instanceof Error ? err.message : "unknown");
    result = { result: "ERROR", reason: "exception" };
  }

  if (result.result === "ERROR") {
    await logDbsStatusCheck(row.user_id, { trigger: "recheck", result: "ERROR", reason: result.reason }, admin);
    return "error";
  }

  const ctx = {
    identityStatus: row.identity_status as IdentityStatus,
    certificateIssueDate: row.extracted_wwcc_expiry,
    certificateSurname: row.extracted_wwcc_surname,
    certificateForenames: row.extracted_wwcc_first_name,
  };
  let applied: DbsApplyResult;
  try {
    applied = await applyDbsResult(admin, row.id, row.user_id, ctx, result, { mode: "recheck" });
  } catch {
    await logDbsStatusCheck(row.user_id, { trigger: "recheck", result: result.result, reason: "write_refused" }, admin);
    return "error";
  }

  if (applied.outcome === "superseded") return "skipped";
  if (applied.outcome !== "new_info" && applied.outcome !== "no_match") return "passed";

  const failure: DbsRecheckFailure = applied.outcome === "new_info" ? "NEW_INFO" : "NO_MATCH";
  const statusAt = applied.statusAt ?? "";
  const markerId = await markRecheckFailure(admin, row.user_id, { trigger: "recheck", result: failure, statusAt });
  const after = await onDbsRecheckFailed(admin, { userId: row.user_id, nannyId, result: failure });
  await completeRecheckFailure(admin, row.user_id, markerId, { trigger: "recheck", result: failure, marker: { statusAt, ...after } });
  return applied.outcome;
}

const hasDetails = (r: Candidate) => !!(r.extracted_wwcc_number && r.extracted_wwcc_surname && r.extracted_wwcc_dob);

/** The daily run (see the module header). Throws only when the selection read fails. */
export async function runDbsRecheck(admin: AdminClient, deps: RecheckDeps = {}): Promise<RecheckSummary> {
  const config = deps.config ?? getDbsRecheckConfig();
  const check = deps.check ?? ((input: DbsCheckInput) => checkDbsStatus(input));
  const sleep = deps.sleep ?? realSleep;
  const now = deps.now ?? Date.now;
  const started = now();
  const summary: RecheckSummary = {
    checked: 0, passed: 0, failed_new_info: 0, failed_no_match: 0, errors: 0, skipped: 0, stopped_on_budget: false,
    reconciled: await reconcileHalfFailed(admin),
  };

  for (const { row, nannyId } of await selectCandidates(admin, config.batchLimit)) {
    if (!hasDetails(row)) {
      await logDbsStatusCheck(row.user_id, { trigger: "recheck", result: "ERROR", reason: "missing_details" }, admin);
      summary.skipped++;
      continue;
    }
    if (summary.checked > 0) await sleep(config.intervalMs);
    if (now() - started >= config.timeBudgetMs) {
      summary.stopped_on_budget = true;
      break;
    }
    summary.checked++;
    let kind: Kind;
    try {
      kind = await checkOne(admin, row, nannyId, check);
    } catch (err) {
      console.error("[dbs-recheck] one nanny failed:", err instanceof Error ? err.message : "unknown");
      kind = "error";
    }
    if (kind === "passed") summary.passed++;
    else if (kind === "new_info") summary.failed_new_info++;
    else if (kind === "no_match") summary.failed_no_match++;
    else if (kind === "skipped") summary.skipped++;
    else summary.errors++;
  }
  return summary;
}
