import { redirect } from 'next/navigation';
import { getPublicBsrProfile } from '@/lib/actions/babysitting';
import { createClient } from '@/lib/supabase/server';
import { createAdminClient } from '@/lib/supabase/admin';
import BsrPaymentClient from './BsrPaymentClient';
import { babysittingEnabled } from '@/lib/features/flags';

export default async function BsrPaymentPage({
  params,
}: {
  params: { id: string };
}) {
  // 5c (P-23): while BABYSITTING_ENABLED is off there is nothing to pay for — back to the "Coming soon." page
  // (this page's own fallback target), before any read.
  if (!babysittingEnabled()) {
    redirect('/parent/babysitting');
  }

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    redirect('/login');
  }

  // Verify this parent owns the BSR
  const admin = createAdminClient();
  const { data: parent } = await admin
    .from('parents')
    .select('id')
    .eq('user_id', user.id)
    .maybeSingle();

  if (!parent) {
    redirect('/parent/babysitting');
  }

  const { data: bsr } = await admin
    .from('babysitting_requests')
    .select('id, status, parent_id')
    .eq('id', params.id)
    .single();

  if (!bsr || bsr.parent_id !== parent.id) {
    redirect('/parent/babysitting');
  }

  // If already open/filled/etc, go to list
  if (bsr.status !== 'pending_payment') {
    redirect('/parent/babysitting');
  }

  // Get full BSR data for display
  const { data: profile } = await getPublicBsrProfile(params.id);
  if (!profile) {
    redirect('/parent/babysitting');
  }

  return <BsrPaymentClient bsr={profile} />;
}
