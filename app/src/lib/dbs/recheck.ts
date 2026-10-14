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
 * - Two phases (README P-15, BAI 2026-10-14 — the safety cut-off): phase 1 asks every nanny and writes passes and
 *   errors, but only DECIDES the failures. If NEW_INFO + NO_MATCH among the answered checks (passes + failures; API
 *   errors are neither) is ABOVE `pauseRatio` (default 20 %) AND at least `pauseMinFailures` (default 3), the run applies
 *   NONE of them: one `dbs_status_check` row with no user `{result:'PAUSED', failed, answered, …}` and one admin email
 *   ("re-check paused: N of M failed — check the DBS service"); they are simply checked again tomorrow. Otherwise phase
 *   2 applies each failure exactly as #12 says.
 * - Output: counts only `{ checked, passed, failed_new_info, failed_no_match, errors, skipped, stopped_on_budget,
 *   reconciled, paused_on_fail_ratio, failures_held }` (failed_* = failures APPLIED).
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
import {
  sendDbsRecheckAdminAlert,
  sendDbsRecheckFailedEmail,
  sendDbsRecheckPausedAlert,
  type DbsRecheckFailure,
} from "@/lib/email/dbs-emails";
import { DBS_ACTIVITY, VERIFICATION_LEVEL, VERIFICATION_STATUS, type IdentityStatus } from "@/lib/verification";

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
  /** README P-15: the failure share tripped the safety cut-off, so no failure was applied this run. */
  paused_on_fail_ratio: boolean;
  /** README P-15: failures decided but NOT applied because the run paused (0 otherwise). */
  failures_held: number;
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

/** A failure decided in phase 1 and not yet applied (README P-15). */
interface HeldFailure {
  row: Candidate;
  nannyId: string;
  result: DbsCheckResult & { result: "NEW_INFO" | "NO_MATCH" };
}

type Asked = { kind: "passed" | "skipped" | "error" } | { kind: "failed"; held: HeldFailure };

const ctxOf = (row: Candidate) => ({
  identityStatus: row.identity_status as IdentityStatus,
  certificateIssueDate: row.extracted_wwcc_expiry,
  certificateSurname: row.extracted_wwcc_surname,
  certificateForenames: row.extracted_wwcc_first_name,
});

/**
 * Phase 1 for one nanny: ask the Update Service. ERROR → one log row. Pass → the result block is written now (a pass
 * is never held). NEW_INFO / NO_MATCH → returned as a held failure, nothing written yet (README P-15).
 */
async function askOne(
  admin: AdminClient,
  row: Candidate,
  nannyId: string,
  check: (input: DbsCheckInput) => Promise<DbsCheckResult>,
): Promise<Asked> {
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
    return { kind: "error" };
  }
  if (result.result === "NEW_INFO" || result.result === "NO_MATCH") {
    return { kind: "failed", held: { row, nannyId, result: result as HeldFailure["result"] } };
  }
  try {
    const { outcome } = await applyDbsResult(admin, row.id, row.user_id, ctxOf(row), result, { mode: "recheck" });
    return { kind: outcome === "superseded" ? "skipped" : "passed" };
  } catch {
    await logDbsStatusCheck(row.user_id, { trigger: "recheck", result: result.result, reason: "write_refused" }, admin);
    return { kind: "error" };
  }
}

/** Phase 2 for one held failure, below the cut-off: the guarded fail write, the marker, the after-fail step. */
async function applyFailure(admin: AdminClient, { row, nannyId, result }: HeldFailure): Promise<Kind> {
  let applied: DbsApplyResult;
  try {
    applied = await applyDbsResult(admin, row.id, row.user_id, ctxOf(row), result, { mode: "recheck" });
  } catch {
    await logDbsStatusCheck(row.user_id, { trigger: "recheck", result: result.result, reason: "write_refused" }, admin);
    return "error";
  }
  if (applied.outcome !== "new_info" && applied.outcome !== "no_match") return "skipped";

  const failure: DbsRecheckFailure = applied.outcome === "new_info" ? "NEW_INFO" : "NO_MATCH";
  const statusAt = applied.statusAt ?? "";
  const markerId = await markRecheckFailure(admin, row.user_id, { trigger: "recheck", result: failure, statusAt });
  const after = await onDbsRecheckFailed(admin, { userId: row.user_id, nannyId, result: failure });
  await completeRecheckFailure(admin, row.user_id, markerId, { trigger: "recheck", result: failure, marker: { statusAt, ...after } });
  return applied.outcome;
}

/** README P-15: above the ratio AND at least the floor. Errors are neither failures nor answers. */
function tripsCutOff(failed: number, answered: number, config: DbsRecheckConfig): boolean {
  return answered > 0 && failed >= config.pauseMinFailures && failed / answered > config.pauseRatio;
}

/** README P-15: apply none of the held failures — one run-level log row (no user) and one admin email. */
async function pauseRun(admin: AdminClient, held: HeldFailure[], answered: number, config: DbsRecheckConfig): Promise<void> {
  const newInfo = held.filter((f) => f.result.result === "NEW_INFO").length;
  const details: Record<string, unknown> = {
    trigger: "recheck", result: "PAUSED", failed: held.length, answered, new_info: newInfo, no_match: held.length - newInfo,
    threshold_ratio: config.pauseRatio, min_failures: config.pauseMinFailures,
  };
  try {
    await sendDbsRecheckPausedAlert({
      failed: held.length, answered, newInfo, noMatch: held.length - newInfo,
      thresholdRatio: config.pauseRatio, minFailures: config.pauseMinFailures,
    });
  } catch (err) {
    console.error("[dbs-recheck] paused alert not sent:", err instanceof Error ? err.message : "unknown");
    details.warnings = ["admin_email_failed"];
  }
  const { error } = await admin.from("activity_logs").insert({ user_id: null, action_type: DBS_ACTIVITY.STATUS_CHECK, action_details: details });
  if (error) console.error("[dbs-recheck] could not write the paused log row:", error.message);
}

const hasDetails = (r: Candidate) => !!(r.extracted_wwcc_number && r.extracted_wwcc_surname && r.extracted_wwcc_dob);

function tally(summary: RecheckSummary, kind: Kind): void {
  if (kind === "passed") summary.passed++;
  else if (kind === "new_info") summary.failed_new_info++;
  else if (kind === "no_match") summary.failed_no_match++;
  else if (kind === "skipped") summary.skipped++;
  else summary.errors++;
}

/** Phase 1 over the batch: throttle, budget, ask each nanny; returns the held failures (see the module header). */
async function askAll(admin: AdminClient, config: DbsRecheckConfig, deps: Required<Omit<RecheckDeps, "config">>, summary: RecheckSummary): Promise<HeldFailure[]> {
  const started = deps.now();
  const held: HeldFailure[] = [];
  for (const { row, nannyId } of await selectCandidates(admin, config.batchLimit)) {
    if (!hasDetails(row)) {
      await logDbsStatusCheck(row.user_id, { trigger: "recheck", result: "ERROR", reason: "missing_details" }, admin);
      summary.skipped++;
      continue;
    }
    if (summary.checked > 0) await deps.sleep(config.intervalMs);
    if (deps.now() - started >= config.timeBudgetMs) {
      summary.stopped_on_budget = true;
      break;
    }
    summary.checked++;
    let asked: Asked;
    try {
      asked = await askOne(admin, row, nannyId, deps.check);
    } catch (err) {
      console.error("[dbs-recheck] one nanny failed:", err instanceof Error ? err.message : "unknown");
      asked = { kind: "error" };
    }
    if (asked.kind === "failed") held.push(asked.held);
    else tally(summary, asked.kind);
  }
  return held;
}

/** The daily run (see the module header). Throws only when the selection read fails. */
export async function runDbsRecheck(admin: AdminClient, deps: RecheckDeps = {}): Promise<RecheckSummary> {
  const config = deps.config ?? getDbsRecheckConfig();
  const summary: RecheckSummary = {
    checked: 0, passed: 0, failed_new_info: 0, failed_no_match: 0, errors: 0, skipped: 0, stopped_on_budget: false,
    reconciled: await reconcileHalfFailed(admin), paused_on_fail_ratio: false, failures_held: 0,
  };
  const held = await askAll(admin, config, {
    check: deps.check ?? ((input: DbsCheckInput) => checkDbsStatus(input)),
    sleep: deps.sleep ?? realSleep,
    now: deps.now ?? Date.now,
  }, summary);

  if (tripsCutOff(held.length, summary.passed + held.length, config)) {
    await pauseRun(admin, held, summary.passed + held.length, config);
    return { ...summary, paused_on_fail_ratio: true, failures_held: held.length };
  }
  for (const f of held) {
    let kind: Kind;
    try {
      kind = await applyFailure(admin, f);
    } catch (err) {
      console.error("[dbs-recheck] one failure could not be applied:", err instanceof Error ? err.message : "unknown");
      kind = "error";
    }
    tally(summary, kind);
  }
  return summary;
}
