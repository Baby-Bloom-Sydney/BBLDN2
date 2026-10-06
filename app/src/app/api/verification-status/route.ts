import { NextResponse } from 'next/server';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { IDENTITY_STATUS, WWCC_STATUS, CROSS_CHECK_STATUS, GUIDANCE_MESSAGES, deriveOverallStatus, type IdentityStatus, type WwccStatus, type CrossCheckStatus } from '@/lib/verification';
import { syncNannyVerificationState } from '@/lib/actions/verification';
import { runCrossCheckPhase } from '@/lib/ai/verification-pipeline';
import { getDbsConfig } from '@/lib/dbs/config';

// Two 15 s Update Service attempts + the 5 s delay between them, when a poll retries a pending check (#30).
export const maxDuration = 60;

// If a section has been 'processing' for this long, escalate to 'review'.
const STALE_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes

export async function GET() {
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ status: null }, { status: 401 });
  }

  const SELECT = `
      id, verification_status,
      identity_status, wwcc_status, contact_status, cross_check_status,
      identity_status_at, wwcc_status_at,
      identity_verified, identity_rejection_reason, identity_user_guidance,
      surname, given_names, date_of_birth,
      extracted_passport_number, extracted_nationality,
      wwcc_number, wwcc_expiry_date, wwcc_doc_verified, wwcc_verified,
      wwcc_rejection_reason, wwcc_user_guidance,
      ocg_result_status, ocg_verified_at,
      cross_check_reasoning, cross_check_at,
      updated_at
    `;
  const read = () => supabase.from('verifications').select(SELECT).eq('user_id', user.id).single();
  let { data } = await read();

  if (!data) {
    return NextResponse.json({ status: null });
  }

  let { identity_status, wwcc_status } = data;
  const now = Date.now();

  // Staleness safety net: processing stuck too long → escalate to review
  if (identity_status === IDENTITY_STATUS.PROCESSING && data.identity_status_at) {
    const stuckMs = now - new Date(data.identity_status_at).getTime();
    if (stuckMs > STALE_THRESHOLD_MS) {
      const admin = createAdminClient();
      await admin.from('verifications').update({
        identity_status: IDENTITY_STATUS.REVIEW,
        identity_status_at: new Date().toISOString(),
        identity_ai_issues: JSON.stringify(['Auto-check timed out — escalated to manual review']),
        identity_user_guidance: GUIDANCE_MESSAGES.TECHNICAL_STALE,
        verification_status: deriveOverallStatus(IDENTITY_STATUS.REVIEW as IdentityStatus, (wwcc_status || 'not_started') as WwccStatus, (data.cross_check_status || 'not_started') as CrossCheckStatus),
        updated_at: new Date().toISOString(),
      }).eq('user_id', user.id);

      await syncNannyVerificationState(user.id);
      identity_status = IDENTITY_STATUS.REVIEW;
      console.log(`[verification-status] Identity stale for user ${user.id} — escalated to review`);
    }
  }

  if (wwcc_status === WWCC_STATUS.PROCESSING && data.wwcc_status_at) {
    const stuckMs = now - new Date(data.wwcc_status_at).getTime();
    if (stuckMs > STALE_THRESHOLD_MS) {
      const admin = createAdminClient();
      await admin.from('verifications').update({
        wwcc_status: WWCC_STATUS.REVIEW,
        wwcc_status_at: new Date().toISOString(),
        wwcc_ai_issues: JSON.stringify(['Auto-check timed out — escalated to manual review']),
        wwcc_user_guidance: GUIDANCE_MESSAGES.TECHNICAL_STALE,
        verification_status: deriveOverallStatus((identity_status || 'not_started') as IdentityStatus, WWCC_STATUS.REVIEW as WwccStatus, (data.cross_check_status || 'not_started') as CrossCheckStatus),
        updated_at: new Date().toISOString(),
      }).eq('user_id', user.id);

      await syncNannyVerificationState(user.id);
      wwcc_status = WWCC_STATUS.REVIEW;
      console.log(`[verification-status] WWCC stale for user ${user.id} — escalated to review`);
    }
  }

  // API down at the first check (#30): cross-check left `pending` → retry on her poll, once per cooldown.
  // The phase's atomic claim (pending → processing) stops concurrent polls calling DBS twice.
  if (
    identity_status === IDENTITY_STATUS.VERIFIED &&
    wwcc_status === WWCC_STATUS.DOC_VERIFIED &&
    data.cross_check_status === CROSS_CHECK_STATUS.PENDING &&
    (!data.cross_check_at || now - new Date(data.cross_check_at).getTime() > getDbsConfig().retryCooldownMs)
  ) {
    try {
      await runCrossCheckPhase(data.id, 'retry');
      const { data: fresh } = await read();
      if (fresh) {
        data = fresh;
        wwcc_status = fresh.wwcc_status;
      }
    } catch (err) {
      console.error('[verification-status] DBS retry failed:', err instanceof Error ? err.message : 'unknown');
    }
  }

  return NextResponse.json({
    status: data.verification_status,
    identity_status,
    identity_verified: data.identity_verified,
    identity_rejection_reason: data.identity_rejection_reason,
    identity_user_guidance: data.identity_user_guidance,
    surname: data.surname,
    given_names: data.given_names,
    date_of_birth: data.date_of_birth,
    extracted_passport_number: data.extracted_passport_number,
    extracted_nationality: data.extracted_nationality,
    wwcc_status,
    wwcc_number: data.wwcc_number,
    wwcc_expiry_date: data.wwcc_expiry_date,
    wwcc_doc_verified: data.wwcc_doc_verified,
    wwcc_verified: data.wwcc_verified,
    wwcc_rejection_reason: data.wwcc_rejection_reason,
    wwcc_user_guidance: data.wwcc_user_guidance,
    ocg_result_status: data.ocg_result_status,
    ocg_verified_at: data.ocg_verified_at,
    contact_status: data.contact_status,
    cross_check_status: data.cross_check_status,
    cross_check_reasoning: data.cross_check_reasoning,
  });
}
