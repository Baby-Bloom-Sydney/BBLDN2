'use server';

/**
 * submitDbsForManualReview — her "Request manual review" on the DBS step (unit 3c; 00-RULINGS #7, mirrors
 * `submitIdentityForManualReview`). Kept in its own file so 3b's edits to `lib/actions/verification.ts` never collide;
 * 3b's button imports this export.
 *
 * Allowed only after a failure she can act on — 24 (document failed), 23 (new information), 26 (no Update Service
 * match) — or the API-down state (`doc_verified` + cross-check `pending`). Anything else: an error, no write.
 * No attempt count: a second request after a failed resubmit is allowed.
 *
 * Contract
 * - Rulings: #7 (two buttons, no attempt count), #18 (turnaround string), P-8 (identity untouched).
 * - Input: none — the caller is the signed-in nanny (session client); she can only act on her own row.
 * - Output: `{ success, error }`; on success the DBS section is `review` (→ 21), cross-check reset, guidance cleared,
 *   sync run, VER-004-DBS sent, `/nanny/verification` revalidated.
 * - Never: takes an id from the client, writes wwcc_verified or a level directly, overwrites a row whose state changed
 *   since it was read (guarded update), or allows review while a check is in progress.
 */
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import {
  CROSS_CHECK_STATUS,
  WWCC_STATUS,
  deriveOverallStatus,
  type IdentityStatus,
} from '@/lib/verification';
import { syncNannyVerificationState } from './verification';
import { sendDbsManualReviewEmail } from '@/lib/email/dbs-emails';

const REVIEWABLE: ReadonlySet<string> = new Set([WWCC_STATUS.FAILED, WWCC_STATUS.NEW_INFO, WWCC_STATUS.NO_MATCH]);

/** 24 / 23 / 26, or the API-down state (doc_verified + cross-check pending). */
function canRequestReview(wwcc: string, cross: string): boolean {
  if (REVIEWABLE.has(wwcc)) return true;
  return wwcc === WWCC_STATUS.DOC_VERIFIED && cross === CROSS_CHECK_STATUS.PENDING;
}

export async function submitDbsForManualReview(): Promise<{ success: boolean; error: string | null }> {
  const supabase = createClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) return { success: false, error: 'Not authenticated' };

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from('verifications')
    .select('id, identity_status, wwcc_status, cross_check_status')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!existing) return { success: false, error: 'No verification record found' };

  const wwcc = String(existing.wwcc_status ?? '');
  const cross = String(existing.cross_check_status ?? '');
  if (cross === CROSS_CHECK_STATUS.PROCESSING) {
    return { success: false, error: 'Your certificate check is in progress — please refresh in a minute' };
  }
  if (!canRequestReview(wwcc, cross)) {
    return { success: false, error: 'Manual review is only available after your certificate check needs attention' };
  }

  const now = new Date().toISOString();
  // Guarded on the state just read, so a concurrent check finishing first is never overwritten.
  const { data: updated, error: updateErr } = await admin
    .from('verifications')
    .update({
      wwcc_status: WWCC_STATUS.REVIEW,
      wwcc_status_at: now,
      wwcc_user_guidance: null,
      cross_check_status: CROSS_CHECK_STATUS.NOT_STARTED,
      cross_check_reasoning: null,
      cross_check_issues: null,
      cross_check_at: null,
      verification_status: deriveOverallStatus(
        existing.identity_status as IdentityStatus,
        WWCC_STATUS.REVIEW,
        CROSS_CHECK_STATUS.NOT_STARTED,
      ),
      updated_at: now,
    })
    .eq('id', existing.id)
    .eq('wwcc_status', wwcc)
    .eq('cross_check_status', cross)
    .select('id');

  if (updateErr) {
    console.error('[submitDbsForManualReview] Update failed:', updateErr.message);
    return { success: false, error: 'Failed to submit for manual review' };
  }
  if (!updated || updated.length === 0) {
    return { success: false, error: 'Your certificate check changed just now — please refresh and try again' };
  }

  await syncNannyVerificationState(user.id);

  await sendDbsManualReviewEmail(user.id).catch((err) =>
    console.error('[submitDbsForManualReview] VER-004-DBS email error:', err),
  );

  revalidatePath('/nanny/verification');
  return { success: true, error: null };
}
