import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { UpcomingPayoutsView } from "@/components/payments/UpcomingPayoutsView";
import { fetchPayoutsDashboardData } from "@/lib/payments/queryPayoutsDashboard";
import { payoutsEnabled } from "@/lib/payments/flags";

/**
 * `/nanny/payouts` — standalone dashboard route. Renders the same
 * `UpcomingPayoutsView` that the settings tree now embeds.
 */
export default async function NannyPayoutsPage() {
  // 4a-i (P-23): hidden unless PAYOUTS_ENABLED — 404 before any auth or data read.
  if (!payoutsEnabled()) notFound();
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/nanny/payouts");

  const admin = createAdminClient();
  const [data, nannyRes] = await Promise.all([
    fetchPayoutsDashboardData(user.id),
    admin
      .from("nannies")
      .select("payout_application_status")
      .eq("user_id", user.id)
      .maybeSingle<{ payout_application_status: string | null }>(),
  ]);

  return (
    <div className="mx-auto max-w-2xl px-4 pb-12 pt-4">
      <Link
        href="/nanny"
        aria-label="Back to dashboard"
        className="mb-3 inline-flex h-9 w-9 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-400"
      >
        <ArrowLeft className="h-5 w-5" aria-hidden="true" />
      </Link>
      <UpcomingPayoutsView
        data={data}
        payoutApplicationStatus={
          nannyRes.data?.payout_application_status ?? null
        }
        setupHref="/nanny/payouts/onboarding"
      />
    </div>
  );
}
