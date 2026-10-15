import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BAppLayout } from "@/components/bapp/BAppLayout";
import { InviteBanner } from "@/components/bapp/InviteBanner";
import { getInviteForChild } from "@/lib/actions/bapp/child-invites";
import {
  paywallCopyKey,
  requireChildFamilyAccess,
} from "@/lib/payments/access-gate";
import { hasParentMediaConsent } from "@/lib/legal/media-consent-gate";
import { ConsentRenewalModal } from "@/components/legal/ConsentRenewalModal";
import type { ChildClient } from "@/types/bapp";

export default async function ParentDevelopmentLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: { childId: string };
}) {
  const supabase = createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) redirect("/login");

  const admin = createAdminClient();

  // Fetch child and verify access
  const { data: child, error } = await admin
    .from("child_client")
    .select("*")
    .eq("id", params.childId)
    .single();

  if (error || !child) redirect("/parent");

  // Verify parent has access
  const c = child as ChildClient;
  if (c.parent_user_id !== user.id) {
    redirect("/parent");
  }

  // Banner shows when the parent created the invite (parent_to_nanny)
  // and the nanny hasn't claimed it yet. getInviteForChild gates on
  // creator-only access, so a child with a nanny-created invite won't
  // expose the token here.
  const showBanner = c.nanny_user_id === null;
  const inviteResult = showBanner ? await getInviteForChild(c.id) : null;

  // S4 — paywall gate. When the family lacks access, BAppLayout swaps
  // the FAB action into the SubscribeModal trigger + renders the
  // LapsedBanner above page content. Trial state has access; lapsed /
  // cancelled-after-period do not.
  const access = await requireChildFamilyAccess(c.id);

  // T-015 — check whether the parent's media consent is within the
  // T-7d renewal window or already expired. If so, render the
  // ConsentRenewalModal alongside the page content.
  const mediaConsentGate = await hasParentMediaConsent(
    { childId: c.id },
    { admin },
  );
  const showRenewalModal =
    mediaConsentGate.state === "nearing_expiry" ||
    mediaConsentGate.state === "expired";

  // Fetch nanny first name. UX-FIX-PLAN FIX-9 (2026-05-12 audit):
  // previously only fetched when access was lapsed (for the modal
  // copy); now fetched whenever a nanny is linked so the layout can
  // surface "Following with [Nanny]" on the parent side and make the
  // relational frame visible — not just during paywall moments.
  let nannyFirstName: string | undefined;
  if (c.nanny_user_id) {
    const { data: nannyProfile } = await admin
      .from("user_profiles")
      .select("first_name")
      .eq("user_id", c.nanny_user_id)
      .maybeSingle<{ first_name: string | null }>();
    nannyFirstName = nannyProfile?.first_name ?? undefined;
  }

  return (
    <BAppLayout
      child={c}
      role="parent"
      familyHasAccess={access.hasAccess}
      nannyFirstName={nannyFirstName}
      lapseReason={paywallCopyKey(access.reason)}
    >
      {inviteResult?.success && inviteResult.data && (
        <InviteBanner
          childId={c.id}
          childFirstName={c.first_name ?? "your child"}
          inviteToken={inviteResult.data.token}
          role="parent"
        />
      )}
      {children}
      {showRenewalModal && mediaConsentGate.expiresAt && (
        <ConsentRenewalModal
          childId={c.id}
          childFirstName={c.first_name ?? "your child"}
          role="parent"
          expiresAt={mediaConsentGate.expiresAt}
        />
      )}
    </BAppLayout>
  );
}
