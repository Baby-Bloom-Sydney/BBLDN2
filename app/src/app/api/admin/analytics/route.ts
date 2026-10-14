/**
 * Admin analytics API. Unit 3d: the pending-verification count reads 3a's ADMIN_PENDING_CODES (it compared an
 * integer column with the string 'pending' and was always 0) — the same number as the Verification tab (S1).
 */
import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { ADMIN_PENDING_CODES } from "@/lib/verification";

export const dynamic = "force-dynamic";

export async function GET() {
  const supabase = createAdminClient();

  const now = new Date();
  const oneWeekAgo = new Date(now);
  oneWeekAgo.setDate(oneWeekAgo.getDate() - 7);
  const twoWeeksAgo = new Date(now);
  twoWeeksAgo.setDate(twoWeeksAgo.getDate() - 14);
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());

  const [
    totalUsersResult,
    totalNanniesResult,
    totalParentsResult,
    totalAdminsResult,
    signupsThisWeekResult,
    signupsLastWeekResult,
    pendingVerificationsResult,
    tier2NanniesResult,
    tier3NanniesResult,
    activeNanniesResult,
    inactiveNanniesResult,
    activeParentsResult,
    totalPlacementsResult,
    activePlacementsResult,
    endedPlacementsResult,
    interviewsThisMonthResult,
    activePositionsResult,
    totalVisitsResult,
    visitsThisWeekResult,
    visitsTodayResult,
    allVisitorsResult,
    topPagesResult,
  ] = await Promise.all([
    supabase.from("user_roles").select("*", { count: "exact", head: true }),
    supabase
      .from("user_roles")
      .select("*", { count: "exact", head: true })
      .eq("role", "nanny"),
    supabase
      .from("user_roles")
      .select("*", { count: "exact", head: true })
      .eq("role", "parent"),
    supabase
      .from("user_roles")
      .select("*", { count: "exact", head: true })
      .in("role", ["admin", "super_admin"]),
    supabase
      .from("user_roles")
      .select("*", { count: "exact", head: true })
      .gte("created_at", oneWeekAgo.toISOString()),
    supabase
      .from("user_roles")
      .select("*", { count: "exact", head: true })
      .gte("created_at", twoWeeksAgo.toISOString())
      .lt("created_at", oneWeekAgo.toISOString()),
    supabase
      .from("verifications")
      .select("*", { count: "exact", head: true })
      .in("verification_status", [...ADMIN_PENDING_CODES]), // 3d: same codes as the Verification tab (S1)
    supabase
      .from("nannies")
      .select("*", { count: "exact", head: true })
      .eq("wwcc_verified", true)
      .eq("identity_verified", true),
    supabase
      .from("nannies")
      .select("*", { count: "exact", head: true })
      .eq("visible_in_bsr", true),
    supabase
      .from("nannies")
      .select("*", { count: "exact", head: true })
      .eq("status", "active"),
    supabase
      .from("nannies")
      .select("*", { count: "exact", head: true })
      .in("status", ["inactive", "deactivated"]),
    supabase
      .from("parents")
      .select("*", { count: "exact", head: true })
      .eq("status", "active"),
    supabase
      .from("nanny_placements")
      .select("*", { count: "exact", head: true }),
    supabase
      .from("nanny_placements")
      .select("*", { count: "exact", head: true })
      .eq("status", "active"),
    supabase
      .from("nanny_placements")
      .select("*", { count: "exact", head: true })
      .eq("status", "ended"),
    supabase
      .from("interview_requests")
      .select("*", { count: "exact", head: true })
      .gte("created_at", thisMonthStart.toISOString()),
    supabase
      .from("nanny_positions")
      .select("*", { count: "exact", head: true })
      .eq("status", "open"),
    supabase.from("page_visits").select("*", { count: "exact", head: true }),
    supabase
      .from("page_visits")
      .select("*", { count: "exact", head: true })
      .gte("created_at", oneWeekAgo.toISOString()),
    supabase
      .from("page_visits")
      .select("*", { count: "exact", head: true })
      .gte("created_at", todayStart.toISOString()),
    supabase.from("page_visits").select("visitor_id"),
    supabase
      .from("page_visits")
      .select("page_path")
      .order("created_at", { ascending: false })
      .limit(2000),
  ]);

  const thisWeekSignups = signupsThisWeekResult.count ?? 0;
  const lastWeekSignups = signupsLastWeekResult.count ?? 0;
  const signupTrend =
    lastWeekSignups > 0
      ? Math.round(
          ((thisWeekSignups - lastWeekSignups) / lastWeekSignups) * 100,
        )
      : thisWeekSignups > 0
        ? 100
        : 0;

  const totalNannies = totalNanniesResult.count ?? 0;
  const tier2Nannies = tier2NanniesResult.count ?? 0;
  const verificationRate =
    totalNannies > 0 ? Math.round((tier2Nannies / totalNannies) * 100) : 0;

  const allVisitors = (allVisitorsResult.data ?? []).map(
    (r: { visitor_id: string }) => r.visitor_id,
  );
  const uniqueVisitors = new Set(allVisitors).size;

  const pageCounts: Record<string, number> = {};
  for (const row of (topPagesResult.data ?? []) as { page_path: string }[]) {
    pageCounts[row.page_path] = (pageCounts[row.page_path] || 0) + 1;
  }
  const topPages = Object.entries(pageCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([path, count]) => ({ path, count }));

  return NextResponse.json({
    totalUsers: totalUsersResult.count ?? 0,
    totalNannies,
    totalParents: totalParentsResult.count ?? 0,
    totalAdmins: totalAdminsResult.count ?? 0,
    signupsThisWeek: thisWeekSignups,
    signupsLastWeek: lastWeekSignups,
    signupTrend,
    signupTrendIsPositive: signupTrend >= 0,
    pendingVerifications: pendingVerificationsResult.count ?? 0,
    tier2Nannies,
    tier3Nannies: tier3NanniesResult.count ?? 0,
    verificationRate,
    activeNannies: activeNanniesResult.count ?? 0,
    inactiveNannies: inactiveNanniesResult.count ?? 0,
    activeParents: activeParentsResult.count ?? 0,
    totalPlacements: totalPlacementsResult.count ?? 0,
    activePlacements: activePlacementsResult.count ?? 0,
    endedPlacements: endedPlacementsResult.count ?? 0,
    interviewsThisMonth: interviewsThisMonthResult.count ?? 0,
    activePositions: activePositionsResult.count ?? 0,
    totalPageViews: totalVisitsResult.count ?? 0,
    pageViewsThisWeek: visitsThisWeekResult.count ?? 0,
    pageViewsToday: visitsTodayResult.count ?? 0,
    uniqueVisitors,
    topPages,
  });
}
