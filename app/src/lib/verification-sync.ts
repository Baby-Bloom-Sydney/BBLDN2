/**
 * `syncNannyVerificationState` — the one place `nannies.verification_level` is derived from her verification row
 * (body pinned by G5, `lib/actions/verification.sync.test.ts`). A server-only module, not a server action; callers
 * run their own checks before calling it.
 *
 * Unit 3d (BB-LDN-3d-141026), README P-14 (BAI 2026-10-14): when she is barred — by ANY path (admin Bar, pipeline,
 * re-check), from ANY old level — the sync's barred branch drops every live connection she has at any stage (hired
 * included) and sends the VER-011 admin alert listing the affected families, once per bar (`onNannyBarred`,
 * lib/connections/silent-hold.ts, which also now holds `promotePendingConnections`, moved verbatim).
 * Inputs: a user id. Outputs: nannies row written; connections released (level 4) or dropped (barred).
 * Never: tells a parent why a connection was dropped or sends a parent anything on a bar (P-9).
 * Moved from `lib/actions/verification.ts` unchanged (BB-wave1-041126, 2026-11-09).
 */
import { createAdminClient } from '@/lib/supabase/admin';
import { promotePendingConnections, onNannyBarred } from '@/lib/connections/silent-hold';

/**
 * Sync nannies table from verifications (source of truth).
 * Idempotent — safe to call multiple times.
 * MUST be called after every verifications table mutation.
 */
export async function syncNannyVerificationState(userId: string): Promise<void> {
  const admin = createAdminClient();

  // 0. Read old verification level for comparison (silent hold promotion/cleanup)
  const { data: existingNanny } = await admin
    .from('nannies')
    .select('id, verification_level, status')
    .eq('user_id', userId)
    .single();

  const oldLevel = existingNanny?.verification_level ?? 0;
  const nannyId = existingNanny?.id;

  // 1. Read current verifications state
  const { data: v } = await admin
    .from('verifications')
    .select('identity_status, identity_verified, wwcc_status, wwcc_verified, cross_check_status')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  // 2. If no verification record, reset nannies to baseline
  if (!v) {
    await admin
      .from('nannies')
      .update({
        identity_verified: false,
        wwcc_verified: false,
        verification_level: 0, // SIGNED_UP
        updated_at: new Date().toISOString(),
      })
      .eq('user_id', userId);
    return;
  }

  // 3. Derive correct nannies fields from verifications
  const identityVerified = v.identity_verified === true && v.identity_status === 'verified';
  const wwccVerified = v.wwcc_verified === true;

  let level: number;
  if (wwccVerified && identityVerified) {
    level = 4; // FULLY_VERIFIED — OCG cleared + identity verified
  } else if (v.cross_check_status === 'passed' && identityVerified) {
    level = 3; // PROVISIONALLY_VERIFIED
  } else if (identityVerified) {
    level = 2; // ID_VERIFIED
  } else if (v.identity_status !== 'not_started') {
    level = 1; // REGISTERED (identity submitted but not verified)
  } else {
    level = 0; // SIGNED_UP
  }

  // 4. Build update object
  const update: Record<string, unknown> = {
    identity_verified: identityVerified,
    wwcc_verified: wwccVerified,
    verification_level: level,
    updated_at: new Date().toISOString(),
  };

  // 5. Handle BARRED — suspend account
  if (v.wwcc_status === 'barred') {
    update.verification_level = 0;
    update.status = 'suspended';
  }

  // 6. Handle FULLY_VERIFIED — activate
  if (level === 4) {
    update.status = 'active';
  }

  // 7. Write to nannies
  await admin
    .from('nannies')
    .update(update)
    .eq('user_id', userId);

  // 8. Silent Hold: Promote or cleanup pending connections
  if (nannyId) {
    const finalLevel = (v.wwcc_status === 'barred') ? 0 : level;

    // PROMOTION: Old level < 4, new level = 4
    if (oldLevel < 4 && finalLevel === 4) {
      await promotePendingConnections(admin, nannyId, userId);
    }

    // CLEANUP (P-14): barred from ANY level → drop every live connection + one admin alert naming the families
    if (v.wwcc_status === 'barred') {
      const alreadyBarred = oldLevel === 0 && existingNanny?.status === 'suspended';
      await onNannyBarred(admin, { nannyId, userId, alreadyBarred });
    }
  }
}
