"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DashboardData } from "@/types/bapp";
import { isChildMember, CHILD_NOT_FOUND } from "@/lib/bapp/child-member";

// ---------------------------------------------------------------------------
// getProgressMatrix — flat map of {milestoneId: score}
// ---------------------------------------------------------------------------

export async function getProgressMatrix(childId: string): Promise<{
  success: boolean;
  error: string | null;
  data: Record<string, number>;
}> {
  try {
    const {
      data: { user },
      error: authError,
    } = await createClient().auth.getUser();
    if (authError || !user) {
      return { success: false, error: "Not authenticated", data: {} };
    }

    // Only the child's parent or nanny.
    if (!(await isChildMember(childId, user.id))) {
      return { success: false, error: CHILD_NOT_FOUND, data: {} };
    }

    const admin = createAdminClient();
    const { data, error } = await admin
      .from("bapp_progress_scores")
      .select("scores")
      .eq("child_client_id", childId);

    if (error) {
      console.error("getProgressMatrix error:", error);
      return { success: false, error: error.message, data: {} };
    }

    const matrix: Record<string, number> = {};
    for (const row of data ?? []) {
      const scores = row.scores as Record<string, number>;
      for (const [milestoneId, score] of Object.entries(scores)) {
        matrix[milestoneId] = score;
      }
    }

    return { success: true, error: null, data: matrix };
  } catch (err) {
    console.error("getProgressMatrix unexpected error:", err);
    return {
      success: false,
      error: "Failed to fetch progress matrix",
      data: {},
    };
  }
}

// ---------------------------------------------------------------------------
// getDashboardData
// ---------------------------------------------------------------------------

export async function getDashboardData(childId: string): Promise<{
  success: boolean;
  error: string | null;
  data: DashboardData | null;
}> {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "Not authenticated", data: null };
    }

    // Only the child's parent or nanny.
    if (!(await isChildMember(childId, user.id))) {
      return { success: false, error: CHILD_NOT_FOUND, data: null };
    }

    const admin = createAdminClient();

    // Parallel: progress scores + log counts + first log date.
    // is_active filter on bapp_logs keeps soft-deleted tiles out of
    // dashboard counts.
    const [scoresRes, activityCount, obsCount, firstLogRes] = await Promise.all(
      [
        admin
          .from("bapp_progress_scores")
          .select("domain, scores, percent")
          .eq("child_client_id", childId),
        admin
          .from("bapp_logs")
          .select("id", { count: "exact", head: true })
          .eq("child_client_id", childId)
          .eq("type", "activity")
          .eq("is_active", true),
        admin
          .from("bapp_logs")
          .select("id", { count: "exact", head: true })
          .eq("child_client_id", childId)
          .eq("type", "observation")
          .eq("context", "adhoc")
          .eq("is_active", true),
        admin
          .from("bapp_logs")
          .select("created_at")
          .eq("child_client_id", childId)
          .eq("is_active", true)
          .order("created_at", { ascending: true })
          .limit(1),
      ],
    );

    // Domain data
    const domains: Record<
      string,
      { score: number; total: number; percent: number }
    > = {};
    let strongestDomain = "";
    let highestPercent = -1;

    for (const row of scoresRes.data ?? []) {
      const scores = row.scores as Record<string, number>;
      const sumScores = Object.values(scores).reduce((a, b) => a + b, 0);
      domains[row.domain] = {
        score: sumScores,
        total: Object.keys(scores).length * 4,
        percent: row.percent ?? 0,
      };
      if ((row.percent ?? 0) > highestPercent) {
        highestPercent = row.percent ?? 0;
        strongestDomain = row.domain;
      }
    }

    // Days active
    const firstLog = firstLogRes.data?.[0];
    const daysActive = firstLog
      ? Math.max(
          1,
          Math.ceil(
            (Date.now() - new Date(firstLog.created_at).getTime()) /
              (1000 * 60 * 60 * 24),
          ),
        )
      : 0;

    return {
      success: true,
      error: null,
      data: {
        domains,
        stats: {
          totalActivities: activityCount.count ?? 0,
          totalObservations: obsCount.count ?? 0,
          daysActive,
          strongestDomain,
        },
      },
    };
  } catch (err) {
    console.error("getDashboardData unexpected error:", err);
    return {
      success: false,
      error: "Failed to fetch dashboard data",
      data: null,
    };
  }
}
