/**
 * The one table of Update Service meanings (unit 3c, brief change 6 table + change 7). Every caller — the first
 * check (pipeline), the admin's "Run DBS check now" (3d), the daily re-check (3i) — maps a result here, so the
 * meanings cannot drift.
 *
 * | Result (first check)            | One UPDATE                                                                | Status / level |
 * |---------------------------------|---------------------------------------------------------------------------|----------------|
 * | BLANK / NON_BLANK               | cross_check passed + ocg_* block                                          | 30 → level 3   |
 * | BLANK / NON_BLANK, API mismatch | cross_check review + `api_mismatch` + ocg_* block                          | 21, level 2    |
 * | NEW_INFO                        | wwcc 'expired', wwcc_status_at, cross_check not_started (P-7), guidance    | 23, level 2    |
 * | NO_MATCH                        | wwcc 'ocg_not_found', wwcc_status_at, cross_check not_started, guidance    | 26, level 2    |
 * | ERROR                           | cross_check pending, cross_check_at, TECHNICAL_RETRY — no ocg_* write      | 20, level 2    |
 *
 * `verification_status` always comes from `deriveOverallStatus`. Never writes `wwcc_verified` (the admin's) and never
 * writes 40. First-check writes are guarded on `cross_check_status='processing'` (the phase's claim), so a manual
 * review that lands meanwhile is never overwritten. A database refusal throws, so the caller can fail closed.
 */
import {
  CROSS_CHECK_STATUS,
  GUIDANCE_MESSAGES,
  WWCC_STATUS,
  deriveOverallStatus,
  type CrossCheckStatus,
  type IdentityStatus,
  type WwccStatus,
} from "@/lib/verification";
import type { createAdminClient } from "@/lib/supabase/admin";
import type { DbsCheckResult } from "./update-service";
import { datesMatch, forenamesMatch, surnamesMatch } from "./match";

type AdminClient = ReturnType<typeof createAdminClient>;

export type DbsApplyMode = "first" | "recheck" | "admin_result_only";

export interface DbsApplyContext {
  identityStatus: IdentityStatus;
  /** Issue date read from the certificate (stored in `extracted_wwcc_expiry`, re-meant by 3a). */
  certificateIssueDate: string | null;
  certificateSurname: string | null;
  certificateForenames: string | null;
}

export type DbsApplyOutcome =
  | "passed"
  | "api_mismatch"
  | "new_info"
  | "no_match"
  | "api_error"
  | "result_recorded"
  | "no_write"
  | "superseded";

type Row = Record<string, unknown>;

function apiMismatch(r: Extract<DbsCheckResult, { raw: string; status: string }>, ctx: DbsApplyContext): string[] {
  const issues: string[] = [];
  if (!datesMatch(r.printDate, ctx.certificateIssueDate)) issues.push("Update Service print date differs from the certificate issue date");
  if (!surnamesMatch(r.surname, ctx.certificateSurname)) issues.push("Update Service surname differs from the certificate");
  if (!forenamesMatch(r.forename, ctx.certificateForenames)) issues.push("Update Service forename differs from the certificate");
  return issues;
}

function firstCheckUpdate(result: DbsCheckResult, ctx: DbsApplyContext, now: string): { payload: Row; outcome: DbsApplyOutcome } {
  const derive = (wwcc: WwccStatus, cross: CrossCheckStatus) => deriveOverallStatus(ctx.identityStatus, wwcc, cross);

  if (result.result === "ERROR") {
    return {
      outcome: "api_error",
      payload: {
        cross_check_status: CROSS_CHECK_STATUS.PENDING,
        cross_check_at: now,
        cross_check_reasoning: `Surname + DOB match; Update Service unavailable (${result.reason}) — will retry`,
        wwcc_user_guidance: GUIDANCE_MESSAGES.TECHNICAL_RETRY,
        verification_status: derive(WWCC_STATUS.DOC_VERIFIED, CROSS_CHECK_STATUS.PENDING),
        updated_at: now,
      },
    };
  }

  const ocg = { ocg_result_status: result.status, ocg_result_text: result.raw, ocg_verified_at: now };

  if (result.result === "NEW_INFO" || result.result === "NO_MATCH") {
    const newInfo = result.result === "NEW_INFO";
    const wwcc = newInfo ? WWCC_STATUS.NEW_INFO : WWCC_STATUS.NO_MATCH;
    return {
      outcome: newInfo ? "new_info" : "no_match",
      payload: {
        wwcc_status: wwcc,
        wwcc_status_at: now,
        // P-7: must not stay `passed` — sync reads level 3 from it.
        cross_check_status: CROSS_CHECK_STATUS.NOT_STARTED,
        cross_check_reasoning: `Surname + DOB match; Update Service: ${result.status}`,
        cross_check_at: now,
        wwcc_user_guidance: newInfo ? GUIDANCE_MESSAGES.DBS_NEW_INFO : GUIDANCE_MESSAGES.DBS_NO_MATCH,
        ...ocg,
        verification_status: derive(wwcc, CROSS_CHECK_STATUS.NOT_STARTED),
        updated_at: now,
      },
    };
  }

  const mismatch = apiMismatch(result, ctx);
  if (mismatch.length > 0) {
    return {
      outcome: "api_mismatch",
      payload: {
        cross_check_status: CROSS_CHECK_STATUS.REVIEW,
        cross_check_reasoning: `Surname + DOB match; Update Service: ${result.status}; details differ from the certificate`,
        cross_check_issues: ["api_mismatch", ...mismatch],
        cross_check_at: now,
        ...ocg,
        verification_status: derive(WWCC_STATUS.DOC_VERIFIED, CROSS_CHECK_STATUS.REVIEW),
        updated_at: now,
      },
    };
  }

  return {
    outcome: "passed",
    payload: {
      cross_check_status: CROSS_CHECK_STATUS.PASSED,
      cross_check_reasoning: `Surname + DOB match; Update Service: ${result.status}`,
      cross_check_issues: null,
      cross_check_at: now,
      ...ocg,
      verification_status: derive(WWCC_STATUS.DOC_VERIFIED, CROSS_CHECK_STATUS.PASSED),
      updated_at: now,
    },
  };
}

export async function applyDbsResult(
  admin: AdminClient,
  verificationId: string,
  _userId: string,
  ctx: DbsApplyContext,
  result: DbsCheckResult,
  { mode }: { mode: DbsApplyMode },
): Promise<{ outcome: DbsApplyOutcome }> {
  const now = new Date().toISOString();

  if (mode === "recheck") throw new Error("not implemented: 3i");

  if (mode === "admin_result_only") {
    if (result.result === "ERROR") return { outcome: "no_write" };
    const { error } = await admin
      .from("verifications")
      .update({ ocg_result_status: result.status, ocg_result_text: result.raw, ocg_verified_at: now })
      .eq("id", verificationId);
    if (error) throw new Error(`DBS result write refused: ${error.message}`);
    return { outcome: "result_recorded" };
  }

  const { payload, outcome } = firstCheckUpdate(result, ctx, now);
  const { data, error } = await admin
    .from("verifications")
    .update(payload)
    .eq("id", verificationId)
    .eq("cross_check_status", CROSS_CHECK_STATUS.PROCESSING)
    .select("id");
  if (error) throw new Error(`DBS result write refused: ${error.message}`);
  if (!data || data.length === 0) return { outcome: "superseded" };
  return { outcome };
}
