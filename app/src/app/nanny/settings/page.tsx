/**
 * /nanny/settings (server) — loads the profile, level, DBS row, children and payouts, and renders the client.
 * Unit 3b (BB-LDN-3b-061026, brief change 11): the DBS row is decoded here with `getDbsDisplayState` and passed as
 * `{state, number, issueDate, checkedAt}`; the stored expiry column holds the certificate's issue date (3a).
 * Never: writes; never passes raw section codes to the client.
 * Brief 06 (plan 06 §14.6 b3.4; BB-wave1-041126/06b3-build, 2026-11-07): the Business section is a server leaf passed
 * in as a slot, only with the invoice switch on and `?s=business`, so no other view reads any invoice data.
 * 06b-3 rework (ledger B06 §9.1 R1, R2; BB-wave1-041126/06b3-rework, 2026-11-09): the profile read adds the row's
 * version (Profile and Contact details save with it). Her address is her own home address row, read with her own
 * session (security H1, coordinator option (a), §9.11) — never her profile's street line — and with its version goes
 * to Profile and to the Business leaf (one record); with no row, her area from her profile is shown, as before.
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
import { readOwnHome, shownHome } from "@/lib/settings/home-address";

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
    own,
  ] = await Promise.all([
    admin
      .from("user_profiles")
      .select(
        "first_name, last_name, email, mobile_number, date_of_birth, suburb, postcode, updated_at",
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
    // her home address: her own row, read with her own session (RLS: hers only) — never her profile (security H1)
    readOwnHome(supabase, user.id),
  ]);

  // what she sees: her home row, or with none her area from her profile (as before); unreadable → her area, no version,
  // so a save of it is refused as stale rather than overwriting a row she didn't see
  const home = shownHome(own?.home ?? null, { suburb: profileRes.data?.suburb ?? null, postcode: profileRes.data?.postcode ?? null });
  const homeUpdatedAt = own?.updatedAt ?? null;
  const profile = {
    first_name: profileRes.data?.first_name || "",
    last_name: profileRes.data?.last_name || "",
    email: profileRes.data?.email || "",
    mobile_number: profileRes.data?.mobile_number || "",
    date_of_birth: profileRes.data?.date_of_birth || "",
    suburb: home?.town ?? "",
    postcode: home?.postcode ?? "",
    address_line1: home?.line1 ?? "",
    address_line2: home?.line2 ?? "",
    updated_at: profileRes.data?.updated_at ?? null,
    address_updated_at: homeUpdatedAt,
  };

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
          ? <BusinessSettingsLeaf home={home} homeUpdatedAt={homeUpdatedAt} />
          : null
      }
    />
  );
}
