import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { PayoutOnboardingPageClient } from "./PayoutOnboardingPageClient";
import { fetchPayoutOnboardingViewData } from "@/lib/payments/queryNannyPayoutOnboarding";
import { payoutsEnabled } from "@/lib/payments/flags";

/**
 * `/nanny/payouts/onboarding` — standalone onboarding route. Renders
 * the same `PayoutOnboardingPageClient` that the settings tree
 * embeds. Card-style layout modelled on `/nanny/verification`.
 */
export default async function NannyOnboardingPage() {
  // 4a-i (P-23): hidden unless PAYOUTS_ENABLED — 404 before any auth or data read.
  if (!payoutsEnabled()) notFound();
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/nanny/payouts/onboarding");

  const data = await fetchPayoutOnboardingViewData(user.id);

  return (
    <PayoutOnboardingPageClient
      status={data.status}
      email={user.email ?? null}
      bankSummary={data.bankSummary}
    />
  );
}
