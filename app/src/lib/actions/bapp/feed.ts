"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FeedItem } from "@/types/bapp";
import { isChildMember, CHILD_NOT_FOUND } from "@/lib/bapp/child-member";

export async function getFeed(
  childId: string,
  limit: number = 100,
): Promise<{
  success: boolean;
  error: string | null;
  data: FeedItem[];
}> {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error: authError,
    } = await supabase.auth.getUser();
    if (authError || !user) {
      return { success: false, error: "Not authenticated", data: [] };
    }

    // Only the child's parent or nanny.
    if (!(await isChildMember(childId, user.id))) {
      return { success: false, error: CHILD_NOT_FOUND, data: [] };
    }

    const admin = createAdminClient();

    // Fetch logs for this child, ordered newest first. is_active filter
    // keeps soft-deleted tiles (Katie delete_tile or user-initiated
    // softDeleteBAppLog) out of the feed.
    //
    // SECURITY: columns are enumerated explicitly to OMIT
    // `internal_notes` (Katie's private context-only column added
    // by katie-internal-notes.sql). See that migration's header
    // for the visibility-model rationale — Postgres has no
    // column-level RLS, so the app layer is the enforcement
    // boundary for this column. Adding a new column to bapp_logs
    // will NOT auto-flow through this query; the new column must
    // be added to the SELECT list below if the client should see
    // it.
    const { data: logs, error: logsError } = await admin
      .from("bapp_logs")
      .select(
        "id, child_client_id, author_id, type, status, context, parent_log_id, data, created_at, updated_at, is_active",
      )
      .eq("child_client_id", childId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (logsError) {
      console.error("getFeed logs error:", logsError);
      return { success: false, error: logsError.message, data: [] };
    }

    if (!logs || logs.length === 0) {
      return { success: true, error: null, data: [] };
    }

    // Collect unique author IDs and parent_log_ids for batch lookups
    const authorIds = Array.from(
      new Set(logs.map((l) => l.author_id).filter(Boolean)),
    );
    const parentLogIds = Array.from(
      new Set(logs.map((l) => l.parent_log_id).filter(Boolean)),
    ) as string[];

    // Batch fetch author names
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

    // Batch fetch parent logs (for report tiles that need parent activity data)
    const parentMap = new Map<
      string,
      { data: Record<string, unknown>; type: string }
    >();
    if (parentLogIds.length > 0) {
      const { data: parentLogs } = await admin
        .from("bapp_logs")
        .select("id, data, type")
        .in("id", parentLogIds);

      for (const p of parentLogs ?? []) {
        parentMap.set(p.id, {
          data: p.data as Record<string, unknown>,
          type: p.type,
        });
      }
    }

    // Assemble feed items
    const feedItems: FeedItem[] = logs.map((log) => {
      const parent = log.parent_log_id
        ? parentMap.get(log.parent_log_id)
        : undefined;

      return {
        ...log,
        data: log.data as Record<string, unknown>,
        author_name: authorMap.get(log.author_id) || "User",
        parent_data: parent?.data,
        parent_type: parent?.type as FeedItem["parent_type"],
      } as FeedItem;
    });

    return { success: true, error: null, data: feedItems };
  } catch (err) {
    console.error("getFeed unexpected error:", err);
    return { success: false, error: "Failed to fetch feed", data: [] };
  }
}
