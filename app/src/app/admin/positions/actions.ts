'use server';

import { requireAdmin } from '@/lib/admin/require-admin';
import { createAdminClient } from '@/lib/supabase/admin';
import { revalidatePath } from 'next/cache';
import type { UserData } from '@/app/admin/users/page';

// F-8: every export here is callable from the browser, so each proves admin before any client is made.
export async function fetchUserData(userId: string): Promise<UserData | null> {
  const gate = await requireAdmin();
  if (gate.error) return null;

  const admin = createAdminClient();

  const [profileRes, roleRes, nannyRes, parentRes, verificationRes] = await Promise.all([
    admin.from('user_profiles').select('user_id, first_name, last_name, email, suburb, postcode, profile_picture_url, mobile_number, date_of_birth, created_at').eq('user_id', userId).maybeSingle(),
    admin.from('user_roles').select('role').eq('user_id', userId).maybeSingle(),
    admin.from('nannies').select('id, status, verification_level, wwcc_verified, identity_verified, visible_in_bsr').eq('user_id', userId).maybeSingle(),
    admin.from('parents').select('status').eq('user_id', userId).maybeSingle(),
    admin.from('verifications').select('verification_status').eq('user_id', userId).maybeSingle(),
  ]);

  const profile = profileRes.data;
  if (!profile) return null;

  return {
    user_id: profile.user_id,
    first_name: profile.first_name,
    last_name: profile.last_name,
    email: profile.email,
    suburb: profile.suburb,
    postcode: profile.postcode,
    profile_picture_url: profile.profile_picture_url,
    mobile_number: profile.mobile_number,
    date_of_birth: profile.date_of_birth,
    created_at: profile.created_at,
    role: roleRes.data?.role ?? 'unknown',
    nanny_status: nannyRes.data?.status ?? null,
    verification_level: nannyRes.data?.verification_level ?? null,
    verification_status: verificationRes.data?.verification_status ?? null,
    wwcc_verified: nannyRes.data?.wwcc_verified ?? null,
    identity_verified: nannyRes.data?.identity_verified ?? null,
    parent_status: parentRes.data?.status ?? null,
    babysitter_eligible: nannyRes.data?.visible_in_bsr ?? null,
    nanny_id: nannyRes.data?.id ?? null,
  };
}

export async function closePositionAction(positionId: string): Promise<{ success: boolean; error: string | null }> {
  const gate = await requireAdmin();
  if (gate.error) return { success: false, error: gate.error };

  const admin = createAdminClient();

  const { error } = await admin
    .from('nanny_positions')
    .update({
      status: 'cancelled',
      stage: 60,
      position_status: 60,
      closed_at: new Date().toISOString(),
    })
    .eq('id', positionId);

  if (error) return { success: false, error: error.message };

  revalidatePath('/admin/positions');
  return { success: true, error: null };
}
