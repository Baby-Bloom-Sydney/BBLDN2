"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FeedItem } from "@/types/bapp";
import { isChildMember, CHILD_NOT_FOUND } from "@/lib/bapp/child-member";

/**
 * getActivities — Fetch only activity-type logs for a child (no reports/progress).
 */
export async function getActivities(
  childId: string,
  cursor: string | null = null,
  limit: number = 20,
): Promise<{
  success: boolean;
  error: string | null;
  data: FeedItem[];
  nextCursor: string | null;
}> {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return {
        success: false,
        error: "Not authenticated",
        data: [],
        nextCursor: null,
      };
    }

    // Only the child's parent or nanny.
    if (!(await isChildMember(childId, user.id))) {
      return { success: false, error: CHILD_NOT_FOUND, data: [], nextCursor: null };
    }

    const admin = createAdminClient();

    // is_active filter keeps soft-deleted activities out of the list.
    // SECURITY: explicit column list excludes `internal_notes` (Katie's
    // private context column — see katie-internal-notes.sql header).
    let query = admin
      .from("bapp_logs")
      .select(
        "id, child_client_id, author_id, type, status, context, parent_log_id, data, created_at, updated_at, is_active",
      )
      .eq("child_client_id", childId)
      .eq("type", "activity")
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(limit + 1);

    if (cursor) {
      query = query.lt("created_at", cursor);
    }

    const { data: logs, error: logsError } = await query;

    if (logsError) {
      console.error("getActivities error:", logsError);
      return {
        success: false,
        error: logsError.message,
        data: [],
        nextCursor: null,
      };
    }

    if (!logs || logs.length === 0) {
      return { success: true, error: null, data: [], nextCursor: null };
    }

    const hasMore = logs.length > limit;
    const pageItems = hasMore ? logs.slice(0, limit) : logs;
    const nextCursor = hasMore
      ? pageItems[pageItems.length - 1].created_at
      : null;

    // Batch fetch author names
    const authorIds = Array.from(
      new Set(pageItems.map((l) => l.author_id).filter(Boolean)),
    );
    const authorMap = new Map<string, string>();
    if (authorIds.length > 0) {
      const { data: profiles } = await admin
        .from("user_profiles")
        .select("user_id, first_name")
        .in("user_id", authorIds);
      for (const p of profiles ?? []) {
        authorMap.set(p.user_id, p.first_name || "User");
      }
    }

    const feedItems: FeedItem[] = pageItems.map(
      (log) =>
        ({
          ...log,
          data: log.data as Record<string, unknown>,
          author_name: authorMap.get(log.author_id) || "User",
        }) as FeedItem,
    );

    return { success: true, error: null, data: feedItems, nextCursor };
  } catch (err) {
    console.error("getActivities unexpected error:", err);
    return {
      success: false,
      error: "Failed to fetch activities",
      data: [],
      nextCursor: null,
    };
  }
}
