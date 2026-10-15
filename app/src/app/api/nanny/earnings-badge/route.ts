/**
 * GET /api/nanny/earnings-badge
 *
 * Returns the nanny's earnings total for the global header wallet badge.
 *
 * T-018: pulls from the same `fetchPayoutsDashboardData` function the
 * full dashboard uses, eliminating drift between pill + list views.
 *
 * Value definition:
 *  - `realTotalCents`: sum of real `paid|pending|held` rows for current
 *    cycle (`period_start <= today`).
 *  - `trialTeaserAudCents`: £100 per connected family currently in trial
 *    state. Loss-aversion engine — nanny sees money waiting before
 *    parent subscribes.
 *
 * Header hides the badge when totalAud = 0.
 */

import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fetchPayoutsDashboardData } from "@/lib/payments/queryPayoutsDashboard";
import { payoutsEnabled } from "@/lib/payments/flags";

export const dynamic = "force-dynamic";

export async function GET() {
  // 4a-i (P-23): hidden unless PAYOUTS_ENABLED — 404 before any auth, read or work.
  if (!payoutsEnabled()) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  const supabase = createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }

  const data = await fetchPayoutsDashboardData(user.id);
  if (!data) {
    return NextResponse.json({ error: "lookup_failed" }, { status: 500 });
  }

  const totalAud =
    Math.floor(data.realTotalCents / 100) +
    Math.floor(data.trialTeaserAudCents / 100);
  return NextResponse.json({ totalAud });
}
