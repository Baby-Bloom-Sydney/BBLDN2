import { viewerIsNanny } from "@/lib/nanny-owner";
import { getPublicNannyProfile } from "@/lib/actions/nanny";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { HIDDEN_CONNECTION_STAGES } from "@/lib/position/constants";
import { ParentNannyProfileView } from "./ParentNannyProfileView";
import { notFound } from "next/navigation";
import Link from "next/link";
import { ChevronLeft } from "lucide-react";

export default async function ParentBrowseNannyPage({
  params,
}: {
  params: { id: string };
}) {
  const { data: nanny, error } = await getPublicNannyProfile(params.id);

  if (error || !nanny) {
    notFound();
  }

  // Check auth state for connect button logic
  let isOwner = false;
  let isParent = false;
  let pendingRequestCount = 0;
  let existingRequestStatus: string | null = null;
  let hasActivePlacement = false;
  let isActiveNanny = false;

  try {
    const supabase = createClient();
    const { data: { user } } = await supabase.auth.getUser();

    if (user) {
      if (await viewerIsNanny(user.id, nanny.nanny_id)) {
        isOwner = true;
      } else {
        const { data: role } = await supabase
          .from('user_roles')
          .select('role')
          .eq('user_id', user.id)
          .single();

        if (role?.role === 'parent') {
          isParent = true;

          const adminClient = createAdminClient();
          const { data: parentRecord } = await adminClient
            .from('parents')
            .select('id')
            .eq('user_id', user.id)
            .single();

          if (parentRecord) {
            const { count } = await adminClient
              .from('connection_requests')
              .select('id', { count: 'exact', head: true })
              .eq('parent_id', parentRecord.id)
              .eq('status', 'pending');

            pendingRequestCount = count ?? 0;

            const { data: existing } = await adminClient
              .from('connection_requests')
              .select('status, connection_stage')
              .eq('parent_id', parentRecord.id)
              .eq('nanny_id', nanny.nanny_id)
              .in('status', ['pending', 'accepted', 'confirmed'])
              .not('connection_stage', 'in', `(${HIDDEN_CONNECTION_STAGES.join(',')})`)
              .limit(1)
              .maybeSingle();

            existingRequestStatus = existing?.status ?? null;

            const { data: activePlacement } = await adminClient
              .from('nanny_placements')
              .select('id, nanny_id')
              .eq('parent_id', parentRecord.id)
              .eq('status', 'active')
              .limit(1)
              .maybeSingle();

            if (activePlacement) {
              hasActivePlacement = true;
              if (activePlacement.nanny_id === nanny.nanny_id) {
                isActiveNanny = true;
              }
            }
          }
        }
      }
    }
  } catch {
    // Not authenticated
  }

  return (
    <div className="mx-auto max-w-3xl">
      <Link
        href="/parent?t=childcare&s=nannies"
        className="inline-flex items-center gap-1 text-sm text-slate-400 hover:text-slate-600 transition-colors mb-4"
      >
        <ChevronLeft className="h-3.5 w-3.5" />
        Back
      </Link>

      <ParentNannyProfileView
        nanny={nanny}
        isOwner={isOwner}
        isParent={isParent}
        pendingRequestCount={pendingRequestCount}
        existingRequestStatus={existingRequestStatus}
        hasActivePlacement={hasActivePlacement}
        isActiveNanny={isActiveNanny}
      />
    </div>
  );
}
