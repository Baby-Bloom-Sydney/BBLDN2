'use server';

/**
 * The admin's DBS decisions (unit 3d) — the final decision for every nanny (00-RULINGS #11).
 *
 * - `adminVerifyWWCC`   Approve → 40 / level 4 — the ONLY writer of `wwcc_verified=true` (P-1, D3 static test). Needs
 *                       identity verified + an Update Service pass + status 21 or 30; sync releases her held accepts.
 * - `adminBarDbs`       Bar → 27, level 0, suspended (#13, #23); `wwcc_verified=false` in the same UPDATE
 *                       (amendment 10: barred forbids verified); VER-010 + VER-011 via 3c's `sendBarredEmails`.
 * - `adminLiftDbsBar`   Lift bar → DBS section `not_started` (20, level 2) + `nannies.status='active'` (#36).
 * - `adminRunDbsCheck`  Run DBS check now (#30, P-8, #33): API-down row → 3c's full cross-check phase; level-4 row
 *                       with NEW_INFO / NO_MATCH → the failed re-check row (23 / 26, level 2); otherwise only the
 *                       result block. One `dbs_status_check` log row per call.
 * Reject (→ 22, P-4 email) and Ask for page 2 (#27) live in `lib/actions/admin.ts` (`adminRejectWWCC`, `adminSendEmail`).
 *
 * Contract
 * - Input: a verification id (+ reason for Bar). Every action calls `requireAdmin` first and writes nothing without it.
 * - Output: `{ success, error, warning? }` (`warning` = the decision stood but an email failed); Run check adds `result`.
 * - Writes are guarded on the status read, so a row that moved meanwhile is refused rather than overwritten.
 * - Never: writes 40 or `wwcc_verified=true` outside Approve, touches identity (P-8), tells a parent why a
 *   connection was dropped (P-9), or trusts anything from the browser beyond the id and the reason text.
 */
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/admin/require-admin';
import { syncNannyVerificationState } from '@/lib/actions/verification';
import { runCrossCheckPhase } from '@/lib/ai/verification-pipeline';
import { checkDbsStatus, type DbsCheckResult } from '@/lib/dbs/update-service';
import { applyDbsResult, type DbsApplyOutcome } from '@/lib/dbs/map-dbs-outcome';
import { logDbsStatusCheck } from '@/lib/dbs/log';
import { sendBarredEmails } from '@/lib/email/dbs-emails';
import { ADMIN_REASON_MAX_LENGTH, isApiResultCurrent } from '@/lib/admin/dbs-queues';
import {
  CROSS_CHECK_STATUS,
  GUIDANCE_MESSAGES,
  IDENTITY_STATUS,
  VERIFICATION_STATUS,
  WWCC_STATUS,
  deriveOverallStatus,
  isDbsApiPass,
  type CrossCheckStatus,
  type IdentityStatus,
  type WwccStatus,
} from '@/lib/verification';

type AdminClient = ReturnType<typeof createAdminClient>;

export interface AdminDbsResult {
  success: boolean;
  error: string | null;
  /** The decision stood, but a follow-up (an email) failed. */
  warning?: string;
}

export interface AdminDbsCheckResult extends AdminDbsResult {
  /** BLANK / NON_BLANK / NEW_INFO / NO_MATCH / ERROR, or null when the API-down phase ran. */
  result?: string | null;
  outcome?: DbsApplyOutcome | 'phase_run';
}

/** Statuses Approve may move to 40 (spec §3.1): list A (30) and list B (21). */
const APPROVABLE: readonly number[] = [VERIFICATION_STATUS.PENDING_WWCC_REVIEW, VERIFICATION_STATUS.PROVISIONALLY_VERIFIED];

const ROW_COLUMNS =
  'id, user_id, identity_status, wwcc_status, wwcc_status_at, cross_check_status, verification_status, ocg_result_status, ' +
  'ocg_verified_at, wwcc_user_guidance, ' +
  'extracted_wwcc_number, extracted_wwcc_surname, extracted_wwcc_dob, extracted_wwcc_expiry, extracted_wwcc_first_name';

interface DbsRow {
  id: string;
  user_id: string;
  identity_status: string;
  wwcc_status: string;
  wwcc_status_at: string | null;
  cross_check_status: string;
  verification_status: number;
  ocg_result_status: string | null;
  ocg_verified_at: string | null;
  wwcc_user_guidance: { reason_code?: string } | null;
  extracted_wwcc_number: string | null;
  extracted_wwcc_surname: string | null;
  extracted_wwcc_dob: string | null;
  extracted_wwcc_expiry: string | null;
  extracted_wwcc_first_name: string | null;
}

async function readRow(admin: AdminClient, verificationId: string): Promise<DbsRow | null> {
  const { data, error } = await admin.from('verifications').select(ROW_COLUMNS).eq('id', verificationId).single();
  if (error || !data) return null;
  return data as unknown as DbsRow;
}

async function logActivity(admin: AdminClient, userId: string, actionType: string, details: Record<string, unknown>): Promise<void> {
  const { error } = await admin.from('activity_logs').insert({ user_id: userId, action_type: actionType, action_details: details });
  // The decision already stands; a lost history row is reported, not swallowed, and does not undo it.
  if (error) console.error(`[admin-dbs] could not write the ${actionType} log row:`, error.message);
}

/**
 * Runs the unchanged sync after a decision. The decision has already been written, so a sync failure is returned as a
 * warning (the admin can retry: every action re-syncs on its idempotent path) rather than thrown (code review M1).
 */
async function syncAfterDecision(userId: string): Promise<string | undefined> {
  try {
    await syncNannyVerificationState(userId);
    return undefined;
  } catch (err) {
    console.error('[admin-dbs] sync after decision failed:', err instanceof Error ? err.message : 'unknown');
    return 'Saved, but her account level did not update — repeat the action to retry';
  }
}

/** Trimmed reason, or an error message when it is empty or too long (security review L4). */
function checkReason(reason: string, what: string): { value: string } | { error: string } {
  const value = reason.trim();
  if (!value) return { error: `A reason is required to ${what}` };
  if (value.length > ADMIN_REASON_MAX_LENGTH) return { error: `The reason is too long (max ${ADMIN_REASON_MAX_LENGTH} characters)` };
  return { value };
}

const withWarning = (warnings: (string | undefined)[]): { warning?: string } => {
  const w = warnings.filter(Boolean).join(' · ');
  return w ? { warning: w } : {};
};

const derive = (identity: string, wwcc: string, cross: string) =>
  deriveOverallStatus(identity as IdentityStatus, wwcc as WwccStatus, cross as CrossCheckStatus);

// ── Approve ──

/**
 * Approve → level 4 (spec §3.1, P-1). Refuses unless identity is verified, the stored Update Service result is a pass
 * and she is at 21 or 30; already 40 is an idempotent success. The UPDATE is guarded on the status and result read, so
 * a re-check that landed meanwhile cannot be approved over.
 */
export async function adminVerifyWWCC(verificationId: string): Promise<AdminDbsResult> {
  const { userId: adminId, error: authErr } = await requireAdmin();
  if (authErr) return { success: false, error: authErr };

  const admin = createAdminClient();
  const row = await readRow(admin, verificationId);
  if (!row) return { success: false, error: 'Verification record not found' };
  if (row.verification_status === VERIFICATION_STATUS.FULLY_VERIFIED) {
    // Idempotent — but re-sync, so a sync that failed after an earlier approve is repaired (M1).
    return { success: true, error: null, ...withWarning([await syncAfterDecision(row.user_id)]) };
  }

  if (row.identity_status !== IDENTITY_STATUS.VERIFIED) {
    return { success: false, error: 'Cannot approve: her passport check is not verified' };
  }
  if (!isDbsApiPass(row.ocg_result_status)) {
    return { success: false, error: 'Cannot approve: needs an Update Service pass — run the DBS check first' };
  }
  if (!isApiResultCurrent(row)) {
    return { success: false, error: 'Cannot approve: the Update Service result is older than her current certificate — run the DBS check again' };
  }
  if (!APPROVABLE.includes(row.verification_status)) {
    return { success: false, error: `Cannot approve from status ${row.verification_status}` };
  }

  const now = new Date().toISOString();
  const { data: written, error: updateErr } = await admin
    .from('verifications')
    .update({
      wwcc_verified: true,
      wwcc_verified_at: now,
      wwcc_verified_by: adminId,
      wwcc_doc_verified: true,
      wwcc_status: WWCC_STATUS.DOC_VERIFIED,
      cross_check_status: CROSS_CHECK_STATUS.PASSED,
      verification_status: VERIFICATION_STATUS.FULLY_VERIFIED,
      wwcc_rejection_reason: null,
      wwcc_user_guidance: null,
      updated_at: now,
    })
    .eq('id', verificationId)
    .eq('verification_status', row.verification_status)
    .eq('ocg_result_status', row.ocg_result_status as string)
    .select('id');

  if (updateErr) return { success: false, error: `Failed to approve: ${updateErr.message}` };
  if (!written || written.length === 0) return { success: false, error: 'Her record changed meanwhile — refresh and review again' };

  // Unchanged sync: level 4, active, promotePendingConnections (held stage-9 rows released, parents notified).
  const syncWarning = await syncAfterDecision(row.user_id);
  await logActivity(admin, row.user_id, 'verification_approved', {
    admin_id: adminId,
    decision: 'approve',
    api_result: row.ocg_result_status,
    ai_reason_code: row.wwcc_user_guidance?.reason_code ?? null,
  });

  revalidatePath('/admin/users');
  return { success: true, error: null, ...withWarning([syncWarning]) };
}

// ── Bar / Lift bar ──

/**
 * Bar → 27 (spec §3.4, #13/#23). Reason required. Writes `wwcc_verified=false` in the same UPDATE (amendment 10).
 * Sync's barred branch then sets level 0 + suspended and runs `cleanupPendingConnections` (silent to parents, P-9).
 * Already barred → idempotent success. An email failure returns a warning; the bar stands.
 */
export async function adminBarDbs(verificationId: string, reason: string): Promise<AdminDbsResult> {
  const { userId: adminId, error: authErr } = await requireAdmin();
  if (authErr) return { success: false, error: authErr };

  const checked = checkReason(reason, 'bar');
  if ('error' in checked) return { success: false, error: checked.error };
  const trimmed = checked.value;

  const admin = createAdminClient();
  const row = await readRow(admin, verificationId);
  if (!row) return { success: false, error: 'Verification record not found' };
  if (row.wwcc_status === WWCC_STATUS.BARRED) {
    return { success: true, error: null, ...withWarning([await syncAfterDecision(row.user_id)]) };
  }

  const now = new Date().toISOString();
  const { data: written, error: updateErr } = await admin
    .from('verifications')
    .update({
      wwcc_status: WWCC_STATUS.BARRED,
      wwcc_status_at: now,
      wwcc_rejection_reason: trimmed,
      wwcc_verified: false,
      wwcc_verified_by: adminId,
      wwcc_user_guidance: GUIDANCE_MESSAGES.DBS_BARRED,
      verification_status: derive(row.identity_status, WWCC_STATUS.BARRED, row.cross_check_status),
      updated_at: now,
    })
    .eq('id', verificationId)
    .eq('verification_status', row.verification_status)
    .select('id');

  if (updateErr) return { success: false, error: `Failed to bar: ${updateErr.message}` };
  if (!written || written.length === 0) return { success: false, error: 'Her record changed meanwhile — refresh and review again' };

  const syncWarning = await syncAfterDecision(row.user_id);
  await logActivity(admin, row.user_id, 'user_suspended', { admin_id: adminId, decision: 'bar', reason: trimmed });

  let emailWarning: string | undefined;
  try {
    await sendBarredEmails(row.user_id);
  } catch (err) {
    console.error('[adminBarDbs] barred emails failed:', err instanceof Error ? err.message : 'unknown');
    emailWarning = 'Barred, but the barred emails could not be sent — contact her manually';
  }

  revalidatePath('/admin/users');
  return { success: true, error: null, ...withWarning([syncWarning, emailWarning]) };
}

/**
 * Lift bar (#36 — supersedes spec §3.4's "writes 22"). Only from barred. Resets the DBS section to `not_started` so she
 * re-uploads, keeps `wwcc_verified_at/_by` and the ocg_* block as history, then sets `nannies.status='active'` itself
 * (sync only sets active at level 4).
 */
export async function adminLiftDbsBar(verificationId: string): Promise<AdminDbsResult> {
  const { userId: adminId, error: authErr } = await requireAdmin();
  if (authErr) return { success: false, error: authErr };

  const admin = createAdminClient();
  const row = await readRow(admin, verificationId);
  if (!row) return { success: false, error: 'Verification record not found' };
  if (row.wwcc_status !== WWCC_STATUS.BARRED) return { success: false, error: 'She is not barred' };

  const now = new Date().toISOString();
  const { data: written, error: updateErr } = await admin
    .from('verifications')
    .update({
      wwcc_status: WWCC_STATUS.NOT_STARTED,
      wwcc_status_at: now,
      wwcc_doc_verified: false,
      wwcc_verified: false,
      wwcc_user_guidance: null,
      wwcc_rejection_reason: null,
      cross_check_status: CROSS_CHECK_STATUS.NOT_STARTED,
      cross_check_reasoning: null,
      cross_check_issues: null,
      verification_status: derive(row.identity_status, WWCC_STATUS.NOT_STARTED, CROSS_CHECK_STATUS.NOT_STARTED),
      updated_at: now,
    })
    .eq('id', verificationId)
    .eq('wwcc_status', WWCC_STATUS.BARRED)
    .select('id');

  if (updateErr) return { success: false, error: `Failed to lift the bar: ${updateErr.message}` };
  if (!written || written.length === 0) return { success: false, error: 'Her record changed meanwhile — refresh and review again' };

  const syncWarning = await syncAfterDecision(row.user_id);
  const { error: nannyErr } = await admin
    .from('nannies')
    .update({ status: 'active', updated_at: now })
    .eq('user_id', row.user_id);
  // The bar is already lifted; report the stuck account as a warning so the admin sees it (code review L3).
  if (nannyErr) console.error('[adminLiftDbsBar] could not reactivate her account:', nannyErr.message);
  const nannyWarning = nannyErr ? 'Bar lifted, but her account is still suspended — reactivate it from the user drawer' : undefined;

  await logActivity(admin, row.user_id, 'user_reinstated', { admin_id: adminId, decision: 'lift_bar' });

  revalidatePath('/admin/users');
  return { success: true, error: null, ...withWarning([syncWarning, nannyWarning]) };
}

// ── Run DBS check now ──

/**
 * #30: the first check never completed — run 3c's phase (it claims the row, calls the API, maps, syncs and logs).
 * The phase returns nothing, so the row is re-read: still pending / processing = it did not run here (code review M4).
 */
async function runApiDownPhase(admin: AdminClient, verificationId: string): Promise<AdminDbsCheckResult> {
  try {
    await runCrossCheckPhase(verificationId, 'admin');
  } catch (err) {
    return { success: false, error: `The DBS check failed: ${err instanceof Error ? err.message : 'unknown'}` };
  }
  revalidatePath('/admin/users');
  const after = await readRow(admin, verificationId);
  const stillOpen =
    !after || after.cross_check_status === CROSS_CHECK_STATUS.PENDING || after.cross_check_status === CROSS_CHECK_STATUS.PROCESSING;
  if (stillOpen) {
    return { success: false, error: 'A check is already running, or it did not complete (the Update Service may still be down) — try again in a minute' };
  }
  return { success: true, error: null, result: after.ocg_result_status, outcome: 'phase_run' };
}

/** Calls the adapter; an adapter throw is the ERROR shape (fail closed — nothing is written on ERROR). */
async function callUpdateService(row: DbsRow): Promise<DbsCheckResult> {
  try {
    return await checkDbsStatus({
      certificateNumber: row.extracted_wwcc_number ?? '',
      surname: row.extracted_wwcc_surname ?? '',
      dateOfBirth: row.extracted_wwcc_dob ?? '',
    });
  } catch (err) {
    console.error('[adminRunDbsCheck] Update Service adapter threw:', err instanceof Error ? err.message : 'unknown');
    return { result: 'ERROR', reason: 'exception' };
  }
}

/**
 * Run DBS check now (spec §3.5 as amended by #30 and P-8). Refused when the certificate number, surname or DOB is
 * missing, and on a barred row. API-down row (`doc_verified` + cross-check `pending`) → 3c's full phase (it logs).
 * Level-4 row + NEW_INFO / NO_MATCH → mapper `recheck` (23 / 26, level 2, sync). Otherwise → `admin_result_only`
 * (result block only, never status). ERROR writes nothing and returns the reason.
 */
export async function adminRunDbsCheck(verificationId: string): Promise<AdminDbsCheckResult> {
  const { error: authErr } = await requireAdmin();
  if (authErr) return { success: false, error: authErr };

  const admin = createAdminClient();
  const row = await readRow(admin, verificationId);
  if (!row) return { success: false, error: 'Verification record not found' };
  if (row.wwcc_status === WWCC_STATUS.BARRED) return { success: false, error: 'She is barred — lift the bar first' };
  if (!row.extracted_wwcc_number || !row.extracted_wwcc_surname || !row.extracted_wwcc_dob) {
    return { success: false, error: 'Cannot run: the certificate number, surname and date of birth must all be read first' };
  }

  if (row.wwcc_status === WWCC_STATUS.DOC_VERIFIED && row.cross_check_status === CROSS_CHECK_STATUS.PENDING) {
    return runApiDownPhase(admin, verificationId);
  }

  const result = await callUpdateService(row);
  const logEntry = { trigger: 'admin' as const, result: result.result, ...(result.result === 'ERROR' ? { reason: result.reason } : {}) };

  if (result.result === 'ERROR') {
    await logDbsStatusCheck(row.user_id, logEntry, admin);
    return { success: false, error: `The Update Service did not answer (${result.reason}) — nothing was saved`, result: 'ERROR' };
  }

  const ctx = {
    identityStatus: row.identity_status as IdentityStatus,
    certificateIssueDate: row.extracted_wwcc_expiry,
    certificateSurname: row.extracted_wwcc_surname,
    certificateForenames: row.extracted_wwcc_first_name,
  };
  const failedOnLevelFour =
    row.verification_status === VERIFICATION_STATUS.FULLY_VERIFIED && !isDbsApiPass(result.status);

  let outcome: DbsApplyOutcome;
  try {
    ({ outcome } = await applyDbsResult(admin, verificationId, row.user_id, ctx, result, {
      mode: failedOnLevelFour ? 'recheck' : 'admin_result_only',
    }));
  } catch (err) {
    await logDbsStatusCheck(row.user_id, { ...logEntry, reason: 'write_refused' }, admin);
    return { success: false, error: `The result could not be saved: ${err instanceof Error ? err.message : 'unknown'}`, result: result.result };
  }

  // P-8: a level-4 fail drops her to level 2. Connections (P-3), her email and the admin alert email are 3i's path.
  const syncWarning = failedOnLevelFour ? await syncAfterDecision(row.user_id) : undefined;
  await logDbsStatusCheck(row.user_id, logEntry, admin);

  revalidatePath('/admin/users');
  return { success: true, error: null, result: result.result, outcome, ...withWarning([syncWarning]) };
}
