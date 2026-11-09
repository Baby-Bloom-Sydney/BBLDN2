/**
 * /nanny/settings (server) — loads the profile, level, DBS row, children and payouts, and renders the client.
 * Unit 3b (BB-LDN-3b-061026, brief change 11): the DBS row is decoded here with `getDbsDisplayState` and passed as
 * `{state, number, issueDate, checkedAt}`; the stored expiry column holds the certificate's issue date (3a).
 * Never: writes; never passes raw section codes to the client.
 * Brief 06 (plan 06 §14.6 b3.4; BB-wave1-041126/06b3-build, 2026-11-07): the Business section is a server leaf passed
 * in as a slot, only with the invoice switch on and `?s=business`, so no other view reads any invoice data.
 * 06b-3 rework (ledger B06 §9.1 R1, R2; BB-wave1-041126/06b3-rework, 2026-11-09): the profile read adds her street line
 * and the row's version (Profile, Contact details and Business save with it); her address goes to the Business leaf
 * from this same read (one record).
 */
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { NannySettingsClient } from "./NannySettingsClient";
import { getDbsDisplayState } from "@/lib/dbs/nanny-display";
import type { ChildClient } from "@/types/bapp";
import { fetchPayoutsDashboardData } from "@/lib/payments/queryPayoutsDashboard";
import { fetchPayoutHistory } from "@/lib/payments/queryPayoutHistory";
import { fetchPayoutOnboardingViewData } from "@/lib/payments/queryNannyPayoutOnboarding";
import { payoutsEnabled } from "@/lib/payments/flags";
import { nannyInvoicesEnabled } from "@/lib/features/flags";
import { BusinessSettingsLeaf } from "@/app/nanny/invoices/business/BusinessSettingsLeaf";

export default async function NannySettingsPage({ searchParams }: { searchParams?: Record<string, string | string[] | undefined> }) {
  const supabase = createClient();
  const {
    data: { user },
    error: authError,
  } = await supabase.auth.getUser();
  if (authError || !user) redirect("/login");

  const admin = createAdminClient();
  const showPayouts = payoutsEnabled();

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
        "first_name, last_name, email, mobile_number, date_of_birth, suburb, postcode, address_line1, address_line2, updated_at",
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
    // 4a-i (P-23): no payout read while the surface is hidden.
    showPayouts ? fetchPayoutsDashboardData(user.id) : null,
    showPayouts ? fetchPayoutHistory(user.id) : null,
    showPayouts ? fetchPayoutOnboardingViewData(user.id) : null,
  ]);

  const profile = {
    first_name: profileRes.data?.first_name || "",
    last_name: profileRes.data?.last_name || "",
    email: profileRes.data?.email || "",
    mobile_number: profileRes.data?.mobile_number || "",
    date_of_birth: profileRes.data?.date_of_birth || "",
    suburb: profileRes.data?.suburb || "",
    postcode: profileRes.data?.postcode || "",
    address_line1: profileRes.data?.address_line1 || "",
    address_line2: profileRes.data?.address_line2 || "",
    updated_at: profileRes.data?.updated_at ?? null,
  };
  const home = { line1: profile.address_line1, line2: profile.address_line2, town: profile.suburb, postcode: profile.postcode };
  const hasHome = Object.values(home).some((part) => part.trim() !== "");

  return (
    <NannySettingsClient
      profile={profile}
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
        status: payoutOnboarding?.status ?? "not_applied",
        email: user.email ?? null,
        bankSummary: payoutOnboarding?.bankSummary ?? null,
      }}
      businessSection={
        nannyInvoicesEnabled() && searchParams?.s === "business"
          ? <BusinessSettingsLeaf home={hasHome ? home : null} homeUpdatedAt={profile.updated_at} />
          : null
      }
    />
  );
}
