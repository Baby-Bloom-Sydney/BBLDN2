import { createAdminClient } from '@/lib/supabase/admin';
import { sendEmail } from '@/lib/email/resend';
import { getUserEmailInfo } from '@/lib/email/helpers';
import {
  VERIFICATION_STATUS,
  IDENTITY_STATUS,
  WWCC_STATUS,
  CROSS_CHECK_STATUS,
  GUIDANCE_MESSAGES,
  DBS_CERTIFICATE_NUMBER_PATTERN,
  deriveOverallStatus,
  type IdentityStatus,
  type WwccStatus,
  type CrossCheckStatus,
  type UserGuidance,
} from '@/lib/verification';
import { capitalizeName } from '@/lib/utils';
import { syncNannyVerificationState } from '@/lib/actions/verification';
import { verifyPassport } from './verify-passport';
import { verifyDBS, type VerifyDbsResult } from './verify-dbs';
import { checkDbsStatus, type DbsCheckResult } from '@/lib/dbs/update-service';
import { applyDbsResult, type DbsApplyOutcome } from '@/lib/dbs/map-dbs-outcome';
import { logDbsStatusCheck } from '@/lib/dbs/log';
import { datesMatch, surnamesMatch } from '@/lib/dbs/match';
import { DBS_FALLBACK_GUIDANCE, DBS_REVIEW_GUIDANCE } from '@/lib/dbs/reason-guidance';
import { emailFooter } from "@/lib/email/brand";
import { SITE_URL } from "@/lib/constants";

/** Race a promise against a timeout. Throws on timeout. */
function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms / 1000}s`)), ms)
    ),
  ]);
}

const AI_ATTEMPT_TIMEOUT = 45_000; // 45s per AI attempt (GPT-4o vision needs breathing room)
const RETRY_DELAY = 5_000;        // 5s between attempts

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ── Phase 1: Identity Verification (Passport AI) ──

export async function runIdentityPhase(verificationId: string): Promise<void> {
  const supabase = createAdminClient();

  // Atomic claim: only one invocation can proceed
  const { data: claimed } = await supabase
    .from('verifications')
    .update({
      identity_status: IDENTITY_STATUS.PROCESSING,
      identity_status_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', verificationId)
    .eq('identity_status', IDENTITY_STATUS.PENDING)
    .select('id, user_id, surname, given_names, date_of_birth, passport_country, passport_upload_url, identification_photo_url, wwcc_status')
    .single();

  if (!claimed) {
    console.log(`[Identity] Skipping — could not claim (already processing or not pending)`);
    return;
  }

  const { passport_upload_url: passportPath, identification_photo_url: selfiePath } = claimed;

  if (!passportPath || !selfiePath) {
    await setIdentityReview(supabase, verificationId, ['Missing passport or selfie file'], null, claimed.wwcc_status as WwccStatus, claimed.user_id);
    return;
  }

  // Generate signed URLs
  const [passportUrlResult, selfieUrlResult] = await Promise.all([
    supabase.storage.from('verification-documents').createSignedUrl(passportPath, 3600),
    supabase.storage.from('verification-documents').createSignedUrl(selfiePath, 3600),
  ]);

  if (passportUrlResult.error || selfieUrlResult.error || !passportUrlResult.data?.signedUrl || !selfieUrlResult.data?.signedUrl) {
    await setIdentityReview(supabase, verificationId, ['Could not access uploaded documents'], null, claimed.wwcc_status as WwccStatus, claimed.user_id);
    return;
  }

  const submittedData = {
    surname: claimed.surname ?? '',
    given_names: claimed.given_names ?? '',
    date_of_birth: claimed.date_of_birth ?? '',
    passport_country: claimed.passport_country ?? '',
  };

  // ── 2-attempt retry for technical failures ──
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await withTimeout(
        verifyPassport(passportUrlResult.data.signedUrl, selfieUrlResult.data.signedUrl, submittedData),
        AI_ATTEMPT_TIMEOUT,
        `Passport AI (attempt ${attempt})`
      );

      // Write extraction results
      await supabase.from('verifications').update({
        extracted_surname: capitalizeName(result.extracted.surname),
        extracted_given_names: capitalizeName(result.extracted.given_names),
        extracted_dob: result.extracted.dob,
        extracted_nationality: result.extracted.nationality,
        extracted_passport_number: result.extracted.passport_number,
        extracted_passport_expiry: result.extracted.expiry,
        identity_ai_reasoning: result.reasoning,
        identity_ai_issues: JSON.stringify(result.issues),
        updated_at: new Date().toISOString(),
      }).eq('id', verificationId);

      if (!result.pass) {
        // AI ran and found a real problem — set failed with guidance.
        // WWCC data is preserved so user doesn't have to re-upload.
        // Cross-check is reset (can't run without verified identity).
        await supabase.from('verifications').update({
          identity_status: IDENTITY_STATUS.FAILED,
          identity_status_at: new Date().toISOString(),
          identity_user_guidance: result.user_guidance ?? null,
          // Reset cross-check (identity is prerequisite)
          cross_check_status: CROSS_CHECK_STATUS.NOT_STARTED,
          cross_check_reasoning: null,
          verification_status: deriveOverallStatus(IDENTITY_STATUS.FAILED as IdentityStatus, (claimed.wwcc_status || WWCC_STATUS.NOT_STARTED) as WwccStatus, CROSS_CHECK_STATUS.NOT_STARTED as CrossCheckStatus),
          updated_at: new Date().toISOString(),
        }).eq('id', verificationId);

        // Sync nannies (resets identity_verified if previously true)
        await syncNannyVerificationState(claimed.user_id);

        console.log(`[Identity] FAILED — AI found issues, WWCC data preserved`);
        return;
      }

      // Passport passed
      await supabase.from('verifications').update({
        identity_status: IDENTITY_STATUS.VERIFIED,
        identity_status_at: new Date().toISOString(),
        identity_verified: true,
        identity_verified_at: new Date().toISOString(),
        identity_user_guidance: null,
        verification_status: deriveOverallStatus(IDENTITY_STATUS.VERIFIED as IdentityStatus, claimed.wwcc_status as WwccStatus, CROSS_CHECK_STATUS.NOT_STARTED as CrossCheckStatus),
        updated_at: new Date().toISOString(),
      }).eq('id', verificationId);

      await syncNannyVerificationState(claimed.user_id);

      // Sync verified DOB and surname back to user_profiles using passport-extracted values.
      // We use extracted (not claimed) because the user may have swapped surname/given names.
      // Given names are NOT updated because people often go by different names.
      const profileUpdate: Record<string, string> = { updated_at: new Date().toISOString() };
      if (result.extracted.dob) profileUpdate.date_of_birth = result.extracted.dob;
      if (result.extracted.surname) profileUpdate.last_name = capitalizeName(result.extracted.surname);
      await supabase.from('user_profiles').update(profileUpdate).eq('user_id', claimed.user_id);

      console.log(`[Identity] PASSED — level 2`);

      // Always attempt cross-check — triggerCrossCheck re-reads current DB state,
      // so it handles the race where WWCC was submitted during identity processing
      await triggerCrossCheck(verificationId);

      // Auto-fire WWCC AI if Service NSW screenshot is waiting (PENDING = not yet processed)
      if (claimed.wwcc_status === WWCC_STATUS.PENDING) {
        runWWCCDocPhase(verificationId).catch(err => {
          console.error('[Identity] Auto WWCC doc phase error:', err);
        });
      }
      return;

    } catch (error) {
      console.error(`[Identity] Attempt ${attempt} error:`, error);

      if (attempt === 1) {
        // First attempt failed technically — update issues and retry
        await supabase.from('verifications').update({
          identity_ai_issues: JSON.stringify(['Taking a little longer than usual...']),
          updated_at: new Date().toISOString(),
        }).eq('id', verificationId);
        await delay(RETRY_DELAY);
        continue;
      }

      // Both attempts failed technically — set back to pending with retry guidance
      await supabase.from('verifications').update({
        identity_status: IDENTITY_STATUS.PENDING,
        identity_status_at: new Date().toISOString(),
        identity_ai_issues: JSON.stringify([`Technical error: ${error instanceof Error ? error.message : 'Unknown'}`]),
        identity_user_guidance: GUIDANCE_MESSAGES.TECHNICAL_RETRY,
        verification_status: deriveOverallStatus(IDENTITY_STATUS.PENDING as IdentityStatus, claimed.wwcc_status as WwccStatus, CROSS_CHECK_STATUS.NOT_STARTED as CrossCheckStatus),
        updated_at: new Date().toISOString(),
      }).eq('id', verificationId);

      await syncNannyVerificationState(claimed.user_id);
      console.log(`[Identity] Both attempts failed technically — set back to pending`);
      return;
    }
  }
}

// ── Phase 2: DBS certificate — verify-dbs reads page 1 (image or PDF) ──
// Export name kept (D-4): run-verification calls it by name.

function nameOrNull(s: string | null): string | null {
  return s ? capitalizeName(s) : null;
}

/** Columns written from the certificate read (D-4 names; 03-alignment-gaps §5 meanings). */
function certificateColumns(result: VerifyDbsResult, issues: string[]): Record<string, unknown> {
  const e = result.extracted;
  const number = e.certificate_number;
  const issueDate = e.issue_date;
  return {
    extracted_wwcc_surname: nameOrNull(e.surname),
    extracted_wwcc_first_name: nameOrNull(e.forenames),
    extracted_wwcc_other_names: nameOrNull(e.other_names),
    extracted_wwcc_number: number,
    extracted_wwcc_dob: e.date_of_birth,
    extracted_wwcc_expiry: issueDate, // re-meant by 3a: the certificate's issue date
    extracted_wwcc_clearance_type: JSON.stringify({
      level: e.level,
      page: e.page,
      workforce: e.workforce,
      position_applied_for: e.position_applied_for,
      employer_name: e.employer_name,
      registered_body: e.registered_body,
      countersignatory: e.countersignatory,
      police_records: e.police_records,
      s142_list: e.s142_list,
      childrens_barred_list: e.childrens_barred_list,
      adults_barred_list: e.adults_barred_list,
      other_police_info: e.other_police_info,
      statutory_statement_section: e.statutory_statement_section,
      has_disclosed_content: e.has_disclosed_content,
    }),
    wwcc_ai_reasoning: result.reasoning,
    wwcc_ai_issues: JSON.stringify(issues),
    // Only a well-formed value reaches the checked / typed columns (chk_wwcc_number_dbs; date column).
    ...(number && DBS_CERTIFICATE_NUMBER_PATTERN.test(number) ? { wwcc_number: number } : {}),
    ...(issueDate && datesMatch(issueDate, issueDate) ? { wwcc_expiry_date: issueDate.slice(0, 10) } : {}),
    updated_at: new Date().toISOString(),
  };
}

/** #24: reason_code + confidence ride inside the guidance JSON. */
function withReason(base: UserGuidance, result: VerifyDbsResult): UserGuidance {
  return { ...base, ...(result.reason_code ? { reason_code: result.reason_code } : {}), confidence: result.confidence };
}

export async function runWWCCDocPhase(verificationId: string): Promise<void> {
  const supabase = createAdminClient();

  // Atomic claim
  const { data: claimed } = await supabase
    .from('verifications')
    .update({
      wwcc_status: WWCC_STATUS.PROCESSING,
      wwcc_status_at: new Date().toISOString(),
      verification_status: VERIFICATION_STATUS.WWCC_PROCESSING,
      updated_at: new Date().toISOString(),
    })
    .eq('id', verificationId)
    .eq('wwcc_status', WWCC_STATUS.PENDING)
    .select('id, user_id, extracted_surname, extracted_dob, wwcc_service_nsw_screenshot_url, identity_status')
    .single();

  if (!claimed) {
    console.log(`[DBS] Skipping — could not claim`);
    return;
  }

  const docPath: string | null = claimed.wwcc_service_nsw_screenshot_url;
  if (!docPath) {
    await setWwccFailed(supabase, verificationId, ['Missing DBS certificate'], null, claimed.identity_status as IdentityStatus, claimed.user_id);
    return;
  }

  const docUrlResult = await supabase.storage
    .from('verification-documents')
    .createSignedUrl(docPath, 3600);

  if (docUrlResult.error || !docUrlResult.data?.signedUrl) {
    await setWwccFailed(supabase, verificationId, ['Could not access DBS certificate'], null, claimed.identity_status as IdentityStatus, claimed.user_id);
    return;
  }

  const options = {
    isPdf: /\.pdf$/i.test(docPath),
    passportSurname: claimed.extracted_surname ?? '',
    passportDob: claimed.extracted_dob ?? '',
    documentPath: docPath,
  };

  // ── 2-attempt retry ──
  for (let attempt = 1; attempt <= 2; attempt++) {
    try {
      const result = await withTimeout(
        verifyDBS(docUrlResult.data.signedUrl, options),
        AI_ATTEMPT_TIMEOUT,
        `DBS AI (attempt ${attempt})`
      );

      const issues = [
        ...result.issues,
        ...result.tamper_flags,
        ...(result.outcome === 'pass' ? [`confidence:${result.confidence}`] : []), // #31
      ];
      const { error: extractErr } = await supabase.from('verifications')
        .update(certificateColumns(result, issues))
        .eq('id', verificationId);
      if (extractErr) console.error('[DBS] Could not store the certificate read:', extractErr.message);

      if (result.outcome === 'fail') {
        await setWwccFailed(supabase, verificationId, issues, withReason(result.user_guidance ?? DBS_FALLBACK_GUIDANCE, result), claimed.identity_status as IdentityStatus, claimed.user_id);
        console.log(`[DBS] FAILED — ${result.reason_code}`);
        return;
      }

      if (result.outcome === 'review') {
        await setWwccReview(supabase, verificationId, issues, withReason(result.user_guidance ?? DBS_REVIEW_GUIDANCE, result), claimed.identity_status as IdentityStatus, claimed.user_id);
        console.log(`[DBS] REVIEW — sent to a person`);
        return;
      }

      // Certificate read passed
      await supabase.from('verifications').update({
        wwcc_status: WWCC_STATUS.DOC_VERIFIED,
        wwcc_status_at: new Date().toISOString(),
        wwcc_doc_verified: true,
        wwcc_doc_verified_at: new Date().toISOString(),
        wwcc_user_guidance: null,
        verification_status: deriveOverallStatus(claimed.identity_status as IdentityStatus, WWCC_STATUS.DOC_VERIFIED as WwccStatus, CROSS_CHECK_STATUS.NOT_STARTED as CrossCheckStatus),
        updated_at: new Date().toISOString(),
      }).eq('id', verificationId);

      console.log(`[DBS] Certificate read PASSED`);

      // Always attempt cross-check — triggerCrossCheck re-reads current DB state,
      // so it handles the race where identity finished during the certificate read
      await triggerCrossCheck(verificationId);
      return;

    } catch (error) {
      console.error(`[DBS] Attempt ${attempt} error:`, error);

      if (attempt === 1) {
        await supabase.from('verifications').update({
          wwcc_ai_issues: JSON.stringify(['Taking a little longer than usual...']),
          updated_at: new Date().toISOString(),
        }).eq('id', verificationId);
        await delay(RETRY_DELAY);
        continue;
      }

      // Both attempts failed — set back to pending with retry guidance
      await supabase.from('verifications').update({
        wwcc_status: WWCC_STATUS.PENDING,
        wwcc_status_at: new Date().toISOString(),
        wwcc_ai_issues: JSON.stringify([`Technical error: ${error instanceof Error ? error.message : 'Unknown'}`]),
        wwcc_user_guidance: GUIDANCE_MESSAGES.TECHNICAL_RETRY,
        verification_status: deriveOverallStatus(claimed.identity_status as IdentityStatus, WWCC_STATUS.PENDING as WwccStatus, CROSS_CHECK_STATUS.NOT_STARTED as CrossCheckStatus),
        updated_at: new Date().toISOString(),
      }).eq('id', verificationId);

      await syncNannyVerificationState(claimed.user_id);
      console.log(`[DBS] Both attempts failed technically — set back to pending`);
      return;
    }
  }
}

// ── Phase 3: Cross-check (passport vs certificate: surname + DOB) → DBS Update Service ──
// `passed` (→ 30, level 3) is written only after an Update Service pass (#30); the meanings live in
// lib/dbs/map-dbs-outcome.ts. API down → cross-check stays `pending` (level 2), retried on her next poll.

export type CrossCheckTrigger = 'first' | 'retry' | 'admin';

interface CrossCheckRow {
  extracted_surname: string | null;
  extracted_dob: string | null;
  extracted_wwcc_surname: string | null;
  extracted_wwcc_dob: string | null;
}

/** Why passport and certificate disagree (empty = they match). C5–C9: any problem → review, no API call. */
function crossCheckProblems(r: CrossCheckRow): string[] {
  const missing = [
    !r.extracted_surname && 'passport surname',
    !r.extracted_dob && 'passport date of birth',
    !r.extracted_wwcc_surname && 'certificate surname',
    !r.extracted_wwcc_dob && 'certificate date of birth',
  ].filter(Boolean);
  if (missing.length > 0) return [`Missing data for cross-check: ${missing.join(', ')}`];
  const problems: string[] = [];
  if (!surnamesMatch(r.extracted_surname, r.extracted_wwcc_surname)) {
    problems.push(`Surname mismatch: passport "${r.extracted_surname}" vs certificate "${r.extracted_wwcc_surname}"`);
  }
  if (!datesMatch(r.extracted_dob, r.extracted_wwcc_dob)) {
    problems.push(`Date of birth mismatch: passport "${r.extracted_dob}" vs certificate "${r.extracted_wwcc_dob}"`);
  }
  return problems;
}

export async function runCrossCheckPhase(verificationId: string, trigger: CrossCheckTrigger = 'first'): Promise<void> {
  const supabase = createAdminClient();

  // Atomic claim — also what stops two polls calling DBS twice
  const { data: claimed } = await supabase
    .from('verifications')
    .update({
      cross_check_status: CROSS_CHECK_STATUS.PROCESSING,
      cross_check_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('id', verificationId)
    .eq('cross_check_status', CROSS_CHECK_STATUS.PENDING)
    .select('id, user_id, identity_status, wwcc_status, extracted_surname, extracted_dob, extracted_wwcc_surname, extracted_wwcc_first_name, extracted_wwcc_dob, extracted_wwcc_number, extracted_wwcc_expiry')
    .single();

  if (!claimed) {
    console.log(`[CrossCheck] Skipping — could not claim`);
    return;
  }

  const identityStatus = claimed.identity_status as IdentityStatus;
  const problems = crossCheckProblems(claimed);
  if (problems.length > 0) {
    await supabase.from('verifications').update({
      cross_check_status: CROSS_CHECK_STATUS.REVIEW,
      cross_check_reasoning: problems.join('; '),
      cross_check_issues: problems,
      cross_check_at: new Date().toISOString(),
      verification_status: deriveOverallStatus(identityStatus, claimed.wwcc_status as WwccStatus, CROSS_CHECK_STATUS.REVIEW as CrossCheckStatus),
      updated_at: new Date().toISOString(),
    }).eq('id', verificationId).eq('cross_check_status', CROSS_CHECK_STATUS.PROCESSING);

    await syncNannyVerificationState(claimed.user_id);
    console.log(`[CrossCheck] REVIEW — passport and certificate disagree; no Update Service call`);
    return;
  }

  let result: DbsCheckResult;
  try {
    result = await checkDbsStatus({
      certificateNumber: claimed.extracted_wwcc_number ?? '',
      surname: claimed.extracted_wwcc_surname ?? '',
      dateOfBirth: claimed.extracted_wwcc_dob ?? '',
    });
  } catch (err) {
    console.error('[CrossCheck] Update Service adapter threw:', err instanceof Error ? err.message : 'unknown');
    result = { result: 'ERROR', reason: 'exception' };
  }

  const ctx = {
    identityStatus,
    certificateIssueDate: claimed.extracted_wwcc_expiry,
    certificateSurname: claimed.extracted_wwcc_surname,
    certificateForenames: claimed.extracted_wwcc_first_name,
  };
  let outcome: DbsApplyOutcome;
  try {
    ({ outcome } = await applyDbsResult(supabase, verificationId, claimed.user_id, ctx, result, { mode: 'first' }));
  } catch (err) {
    // Fail closed: a refused write leaves her at level 2 with the retry guidance, never at 30.
    console.error('[CrossCheck] Result write refused:', err instanceof Error ? err.message : 'unknown');
    ({ outcome } = await applyDbsResult(supabase, verificationId, claimed.user_id, ctx, { result: 'ERROR', reason: 'exception' }, { mode: 'first' })
      .catch(() => ({ outcome: 'api_error' as DbsApplyOutcome })));
  }

  await syncNannyVerificationState(claimed.user_id);
  await logDbsStatusCheck(
    claimed.user_id,
    { trigger, result: result.result, ...(result.result === 'ERROR' ? { reason: result.reason } : {}) },
    supabase,
  );
  console.log(`[CrossCheck] Update Service → ${outcome}`);

  if (outcome === 'passed') await sendVerifiedEmail(claimed.user_id);
}

/** VER-001 — only after an Update Service pass with no mismatch (copy stays for 3g). */
async function sendVerifiedEmail(userId: string): Promise<void> {
  const userInfo = await getUserEmailInfo(userId);
  if (!userInfo) return;
  const appUrl = SITE_URL;
  sendEmail({
    to: userInfo.email,
    subject: "You're verified! Welcome to Baby Bloom 🎉",
    html: `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin:0;padding:0;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#1e293b;background:#f8fafc;">
<div style="max-width:600px;margin:0 auto;padding:32px 16px;">
  <div style="background:#fff;border-radius:16px;border:1px solid #e2e8f0;padding:32px;">
    <div style="text-align:center;margin-bottom:24px;">
      <div style="display:inline-block;background:#f5f3ff;border-radius:50%;width:56px;height:56px;line-height:56px;font-size:28px;">&#127881;</div>
    </div>
    <h1 style="font-size:22px;font-weight:700;text-align:center;margin:0 0 8px;">You're verified, ${userInfo.firstName}!</h1>
    <p style="text-align:center;color:#64748b;margin:0 0 24px;">Your identity and WWCC have been confirmed.</p>
    <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;">Your profile is now visible to families on Baby Bloom. When a family is interested, they'll send you a connection request — you'll be notified by email and in your dashboard.</p>
    <p style="font-size:15px;color:#475569;line-height:1.6;margin:0 0 12px;">Make sure your profile is up to date so families can see the best version of you.</p>
    <div style="text-align:center;margin-top:24px;">
      <a href="${appUrl}/nanny/profile" style="display:inline-block;background:#8b5cf6;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;font-size:15px;">View Your Profile</a>
    </div>
    ${emailFooter()}
  </div>
</div>
</body></html>`,
    emailType: 'verification_approved',
    recipientUserId: userId,
  }).catch(err => console.error('[CrossCheck] VER-001 email error:', err));
}

// ── Trigger cross-check if both phases are ready ──

export async function triggerCrossCheck(verificationId: string): Promise<void> {
  const supabase = createAdminClient();

  // Re-read current state
  const { data } = await supabase
    .from('verifications')
    .select('identity_status, wwcc_status, cross_check_status')
    .eq('id', verificationId)
    .single();

  if (!data) return;

  if (
    data.identity_status === IDENTITY_STATUS.VERIFIED &&
    data.wwcc_status === WWCC_STATUS.DOC_VERIFIED &&
    data.cross_check_status === CROSS_CHECK_STATUS.NOT_STARTED
  ) {
    // Set to pending, then run
    await supabase.from('verifications').update({
      cross_check_status: CROSS_CHECK_STATUS.PENDING,
      updated_at: new Date().toISOString(),
    }).eq('id', verificationId);

    await runCrossCheckPhase(verificationId);
  }
}

// ── Helpers ──

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function setIdentityReview(supabase: any, verificationId: string, issues: string[], guidance: UserGuidance | null, wwccStatus: WwccStatus = WWCC_STATUS.NOT_STARTED as WwccStatus, userId?: string) {
  await supabase.from('verifications').update({
    identity_status: IDENTITY_STATUS.REVIEW,
    identity_status_at: new Date().toISOString(),
    identity_ai_issues: JSON.stringify(issues),
    identity_user_guidance: guidance,
    verification_status: deriveOverallStatus(IDENTITY_STATUS.REVIEW as IdentityStatus, wwccStatus, CROSS_CHECK_STATUS.NOT_STARTED as CrossCheckStatus),
    updated_at: new Date().toISOString(),
  }).eq('id', verificationId);

  if (userId) await syncNannyVerificationState(userId);
}

async function setWwccReview(supabase: ReturnType<typeof createAdminClient>, verificationId: string, issues: string[], guidance: UserGuidance, identityStatus: IdentityStatus, userId: string) {
  await supabase.from('verifications').update({
    wwcc_status: WWCC_STATUS.REVIEW,
    wwcc_status_at: new Date().toISOString(),
    wwcc_ai_issues: JSON.stringify(issues),
    wwcc_user_guidance: guidance,
    verification_status: deriveOverallStatus(identityStatus, WWCC_STATUS.REVIEW as WwccStatus, CROSS_CHECK_STATUS.NOT_STARTED as CrossCheckStatus),
    updated_at: new Date().toISOString(),
  }).eq('id', verificationId);

  await syncNannyVerificationState(userId);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function setWwccFailed(supabase: any, verificationId: string, issues: string[], guidance: UserGuidance | null, identityStatus: IdentityStatus = IDENTITY_STATUS.VERIFIED as IdentityStatus, userId?: string) {
  await supabase.from('verifications').update({
    wwcc_status: WWCC_STATUS.FAILED,
    wwcc_status_at: new Date().toISOString(),
    wwcc_ai_issues: JSON.stringify(issues),
    wwcc_user_guidance: guidance,
    verification_status: deriveOverallStatus(identityStatus, WWCC_STATUS.FAILED as WwccStatus, CROSS_CHECK_STATUS.NOT_STARTED as CrossCheckStatus),
    updated_at: new Date().toISOString(),
  }).eq('id', verificationId);

  if (userId) await syncNannyVerificationState(userId);
}
