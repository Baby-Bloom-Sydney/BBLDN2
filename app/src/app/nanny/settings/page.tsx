import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NannySettingsClient } from "./NannySettingsClient";
import { getDbsDisplayState } from "@/lib/dbs/nanny-display";
import type { ChildClient } from "@/types/bapp";
import { fetchPayoutsDashboardData } from "@/lib/payments/queryPayoutsDashboard";
import { fetchPayoutHistory } from "@/lib/payments/queryPayoutHistory";
import { fetchPayoutOnboardingViewData } from "@/lib/payments/queryNannyPayoutOnboarding";

export default async function NannySettingsPage() {
  const supabase = createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) redirect("/login");

  const admin = createAdminClient();

  const [
    profileRes,
    nannyRes,
    verificationRes,
    childrenRes,
    payoutsData,
    historyRows,
    payoutOnboarding,
  ] = await Promise.all([
    admin
      .from("user_profiles")
      .select(
        "first_name, last_name, email, mobile_number, date_of_birth, suburb, postcode",
      )
      .eq("user_id", user.id)
      .single(),
    admin
      .from("nannies")
      .select("verification_level")
      .eq("user_id", user.id)
      .single(),
    admin
      .from("verifications")
      .select(
        "wwcc_number, wwcc_status, wwcc_expiry_date, wwcc_user_guidance, cross_check_status, verification_status, ocg_result_status, ocg_verified_at",
      )
      .eq("user_id", user.id)
      .maybeSingle(),
    admin
      .from("child_client")
      .select("*")
      .eq("nanny_user_id", user.id)
      .order("created_at", { ascending: true }),
    fetchPayoutsDashboardData(user.id),
    fetchPayoutHistory(user.id),
    fetchPayoutOnboardingViewData(user.id),
  ]);

  return (
    <NannySettingsClient
      profile={{
        first_name: profileRes.data?.first_name || "",
        last_name: profileRes.data?.last_name || "",
        email: profileRes.data?.email || "",
        mobile_number: profileRes.data?.mobile_number || "",
        date_of_birth: profileRes.data?.date_of_birth || "",
        suburb: profileRes.data?.suburb || "",
        postcode: profileRes.data?.postcode || "",
      }}
      verificationLevel={nannyRes.data?.verification_level ?? 0}
      dbs={
        verificationRes.data
          ? {
              state: getDbsDisplayState(verificationRes.data),
              number: verificationRes.data.wwcc_number || null,
              issueDate: verificationRes.data.wwcc_expiry_date || null, // 3a: holds the issue date
              checkedAt: verificationRes.data.ocg_verified_at || null,
            }
          : null
      }
      managedChildren={(childrenRes.data ?? []) as ChildClient[]}
      payoutsDashboard={payoutsData}
      payoutHistory={historyRows}
      payoutOnboarding={{
        status: payoutOnboarding.status,
        email: user.email ?? null,
        bankSummary: payoutOnboarding.bankSummary,
      }}
    />
  );
}
