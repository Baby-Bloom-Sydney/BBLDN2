import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { BAppLayout } from "@/components/bapp/BAppLayout";
import { InviteBanner } from "@/components/bapp/InviteBanner";
import { getInviteForChild } from "@/lib/actions/bapp/child-invites";
import {
  isDfyFamily,
  paywallCopyKey,
  requireChildFamilyAccess,
} from "@/lib/payments/access-gate";
import { createSubscribeInvite } from "@/lib/actions/payments/createSubscribeInvite";
import {
  hasChildConsent,
  NANNY_ATTESTATION_AGREEMENT_ID,
} from "@/lib/legal/media-consent-gate";
import { ConsentRenewalModal } from "@/components/legal/ConsentRenewalModal";
import type { ChildClient } from "@/types/bapp";

export default async function DevelopmentLayout({
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

  if (error || !child) redirect("/nanny");

  // Verify user has access (nanny or parent)
  const c = child as ChildClient;
  if (c.nanny_user_id !== user.id && c.parent_user_id !== user.id) {
    redirect("/nanny");
  }

  // Banner shows on the nanny side when the parent hasn't claimed yet.
  // getInviteForChild authorises by creator, so a parent visiting a
  // shared child layout won't see the token via this surface.
  const showBanner = c.nanny_user_id === user.id && c.parent_user_id === null;
  const inviteResult = showBanner ? await getInviteForChild(c.id) : null;

  // S4 + S5 — paywall gate. When the family lacks access (parent
  // hasn't subscribed / trial expired / cancelled past period end),
  // BAppLayout swaps the FAB action into the SubscribeModalNanny
  // trigger + renders the LapsedBanner above page content. The modal
  // needs a pre-minted nanny-share invite (S5) to render its share
  // CTA. We mint it here so the modal can fire instantly on FAB tap.
  const access = await requireChildFamilyAccess(c.id);

  let nannyShareUrl: string | undefined;
  let nannyShareText: string | undefined;
  let parentFirstName: string | undefined;
  // 4g (ADR-091): a done-for-you family is never sent the self-serve share link, including via the nanny.
  let familyIsDfy = false;
  if (!access.hasAccess && c.parent_user_id !== null) {
    const { data: familySub } = await admin
      .from("parent_subscriptions")
      .select("family_type, status")
      .eq("parent_user_id", c.parent_user_id)
      .maybeSingle<{ family_type: string | null; status: string | null }>();
    familyIsDfy = isDfyFamily(familySub);
  }
  if (
    !access.hasAccess &&
    c.parent_user_id !== null &&
    c.nanny_user_id === user.id
  ) {
    const inviteRes = familyIsDfy ? null : await createSubscribeInvite(c.id);
    if (inviteRes?.success) {
      nannyShareUrl = inviteRes.data.url;
      nannyShareText = inviteRes.data.shareText;
    }
    const { data: parentProfile } = await admin
      .from("user_profiles")
      .select("first_name")
      .eq("user_id", c.parent_user_id)
      .maybeSingle<{ first_name: string | null }>();
    parentFirstName = parentProfile?.first_name ?? undefined;
  }

  return (
    <BAppLayout
      child={c}
      role="nanny"
      familyHasAccess={access.hasAccess}
      parentFirstName={parentFirstName}
      familyIsDfy={familyIsDfy}
      nannyShareUrl={nannyShareUrl}
      nannyShareText={nannyShareText}
      lapseReason={paywallCopyKey(access.reason)}
    >
      {inviteResult?.success && inviteResult.data && (
        <InviteBanner
          childId={c.id}
          childFirstName={c.first_name ?? "your child"}
          inviteToken={inviteResult.data.token}
          role="nanny"
        />
      )}
      {children}
      {c.nanny_user_id === user.id &&
        (await (async () => {
          const nannyGate = await hasChildConsent(
            {
              childId: c.id,
              agreementId: NANNY_ATTESTATION_AGREEMENT_ID,
            },
            { admin },
          );
          if (
            (nannyGate.state === "nearing_expiry" ||
              nannyGate.state === "expired") &&
            nannyGate.expiresAt
          ) {
            return (
              <ConsentRenewalModal
                childId={c.id}
                childFirstName={c.first_name ?? "the child"}
                role="nanny"
                expiresAt={nannyGate.expiresAt}
              />
            );
          }
          return null;
        })())}
    </BAppLayout>
  );
}
