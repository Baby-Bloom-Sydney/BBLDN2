import { NextResponse } from 'next/server';
import { requireAdmin } from '@/lib/admin/require-admin';
import { createAdminClient } from '@/lib/supabase/admin';
import { syncNannyVerificationState } from '@/lib/actions/verification';
import { VERIFICATION_STATUS, deriveOverallStatus, type IdentityStatus, type WwccStatus, type CrossCheckStatus } from '@/lib/verification';

/**
 * POST /api/admin/reconcile-nannies
 *
 * One-time bulk reconciliation:
 * 1. Re-derives verification_status on verifications table using fixed deriveOverallStatus
 * 2. Runs syncNannyVerificationState() for every nanny to fix nannies table
 *
 * Admin-only. Idempotent — safe to run multiple times.
 */
export async function POST() {
  const gate = await requireAdmin();
  if (gate.error) {
    return NextResponse.json(
      { error: gate.error },
      { status: gate.error === 'Not authenticated' ? 401 : 403 },
    );
  }
  const admin = createAdminClient();

  // Step 1: Re-derive verification_status on all verifications records
  const { data: verifications, error: vError } = await admin
    .from('verifications')
    .select('id, user_id, identity_status, identity_verified, wwcc_status, wwcc_verified, cross_check_status, verification_status');

  if (vError || !verifications) {
    return NextResponse.json({ error: 'Failed to fetch verifications', details: vError }, { status: 500 });
  }

  let statusFixed = 0;
  const statusChanges: { user_id: string; old: number; new: number }[] = [];

  for (const v of verifications) {
    // FULLY_VERIFIED (40) is only reachable via the admin's Approve — deriveOverallStatus
    // doesn't know about wwcc_verified, so we handle it separately
    const isFullyVerified =
      v.identity_verified === true &&
      v.identity_status === 'verified' &&
      v.wwcc_verified === true;

    const correct = isFullyVerified
      ? VERIFICATION_STATUS.FULLY_VERIFIED
      : deriveOverallStatus(
          (v.identity_status || 'not_started') as IdentityStatus,
          (v.wwcc_status || 'not_started') as WwccStatus,
          (v.cross_check_status || 'not_started') as CrossCheckStatus,
        );

    if (v.verification_status !== correct) {
      await admin
        .from('verifications')
        .update({ verification_status: correct, updated_at: new Date().toISOString() })
        .eq('id', v.id);
      statusChanges.push({ user_id: v.user_id, old: v.verification_status, new: correct });
      statusFixed++;
    }
  }

  // Step 2: Sync nannies table for all nannies
  const { data: nannies, error: nError } = await admin
    .from('nannies')
    .select('user_id');

  if (nError || !nannies) {
    return NextResponse.json({ error: 'Failed to fetch nannies', details: nError }, { status: 500 });
  }

  const syncErrors: { user_id: string; error: string }[] = [];

  for (const nanny of nannies) {
    try {
      await syncNannyVerificationState(nanny.user_id);
    } catch (err) {
      syncErrors.push({
        user_id: nanny.user_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return NextResponse.json({
    verifications_checked: verifications.length,
    status_fixed: statusFixed,
    status_changes: statusChanges,
    nannies_synced: nannies.length - syncErrors.length,
    sync_errors: syncErrors.length > 0 ? syncErrors : undefined,
  });
}
