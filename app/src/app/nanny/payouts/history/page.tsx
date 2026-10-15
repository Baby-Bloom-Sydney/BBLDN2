import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { createClient } from "@/lib/supabase/server";
import { PayoutHistoryView } from "@/components/payments/PayoutHistoryView";
import { fetchPayoutHistory } from "@/lib/payments/queryPayoutHistory";
import { payoutsEnabled } from "@/lib/payments/flags";

/**
 * `/nanny/payouts/history` — standalone history route. Renders the
 * same `PayoutHistoryView` that the settings tree embeds.
 */
export default async function NannyPayoutHistoryPage() {
  // 4a-i (P-23): hidden unless PAYOUTS_ENABLED — 404 before any auth or data read.
  if (!payoutsEnabled()) notFound();
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login?next=/nanny/payouts/history");

  const rows = await fetchPayoutHistory(user.id);

  return (
    <div className="mx-auto max-w-2xl px-4 py-12">
      <Link
        href="/nanny/payouts"
        className="text-sm text-slate-500 hover:text-slate-700"
      >
        ← Back to payouts
      </Link>
      <div className="mt-4">
        <PayoutHistoryView rows={rows} />
      </div>
    </div>
  );
}
