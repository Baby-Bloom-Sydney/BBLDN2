'use server';

import { createAdminClient } from '@/lib/supabase/admin';
import { getNannyId } from './connection';
import { CONNECTION_STAGE, CONNECTION_WAIT_WINDOW_MS } from '@/lib/position/constants';

export async function applyToPosition(positionId: string): Promise<{
  success: boolean;
  error?: string;
}> {
  const identity = await getNannyId();
  if (!identity) return { success: false, error: 'not_authenticated' };

  const { nannyId } = identity;
  const admin = createAdminClient();

  // Verify nanny is at least provisionally verified (level >= 3)
  const { data: nanny } = await admin
    .from('nannies')
    .select('id, verification_level')
    .eq('id', nannyId)
    .single();

  if (!nanny || (nanny.verification_level ?? 0) < 3) {
    return { success: false, error: 'not_verified' };
  }

  // Verify position exists and is active
  const { data: position } = await admin
    .from('nanny_positions')
    .select('id, parent_id, status')
    .eq('id', positionId)
    .single();

  if (!position || position.status !== 'active') {
    return { success: false, error: 'position_inactive' };
  }

  // Check for existing connection (block duplicates, allow re-apply after expiry/cancellation)
  const { data: existing } = await admin
    .from('connection_requests')
    .select('id, connection_stage')
    .eq('nanny_id', nannyId)
    .eq('position_id', positionId)
    .not('connection_stage', 'in', '(1,3)')
    .limit(1);

  if (existing && existing.length > 0) {
    return { success: false, error: 'already_applied' };
  }

  // Create connection request — level 3 gets pending stage, level 4+ gets real stage
  const verificationLevel = nanny.verification_level ?? 0;
  const expiresAt = new Date(Date.now() + CONNECTION_WAIT_WINDOW_MS).toISOString();

  const { error: insertError } = await admin
    .from('connection_requests')
    .insert({
      parent_id: position.parent_id,
      nanny_id: nannyId,
      position_id: positionId,
      status: 'pending',
      connection_stage: verificationLevel >= 4
        ? CONNECTION_STAGE.NANNY_APPLIED
        : CONNECTION_STAGE.NANNY_APPLIED_PENDING,
      proposed_times: [],
      expires_at: expiresAt,
    });

  if (insertError) {
    console.error('Failed to create application:', insertError);
    return { success: false, error: 'insert_failed' };
  }

  return { success: true };
}
