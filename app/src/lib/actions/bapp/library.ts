"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import type { FeedItem } from "@/types/bapp";
import { isChildMember, CHILD_NOT_FOUND } from "@/lib/bapp/child-member";

/**
 * getLibraryImages — Paginated fetch of all logs with images for a child.
 * Returns full FeedItem objects so tiles can be rendered in the modal.
 */
export async function getLibraryImages(
  childId: string,
  cursor: string | null,
  limit: number = 12,
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

    // is_active filter keeps soft-deleted tiles out of the image library.
    // SECURITY: explicit column list excludes `internal_notes` (Katie's
    // private context column — see katie-internal-notes.sql header).
    let query = admin
      .from("bapp_logs")
      .select(
        "id, child_client_id, author_id, type, status, context, parent_log_id, data, created_at, updated_at, is_active",
      )
      .eq("child_client_id", childId)
      .eq("is_active", true)
      .not("data->image_url", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit + 1);

    if (cursor) {
      query = query.lt("created_at", cursor);
    }

    const { data: logs, error: logsError } = await query;

    if (logsError) {
      console.error("getLibraryImages error:", logsError);
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

    // Filter out rows where image_url is null/empty in JSONB
    const filtered = logs.filter((l) => {
      const d = l.data as Record<string, unknown>;
      return (
        d.image_url && typeof d.image_url === "string" && d.image_url.length > 0
      );
    });

    const hasMore = filtered.length > limit;
    const pageItems = hasMore ? filtered.slice(0, limit) : filtered;
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

    // Batch fetch parent logs (for report tiles)
    const parentLogIds = Array.from(
      new Set(pageItems.map((l) => l.parent_log_id).filter(Boolean)),
    ) as string[];
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

    const feedItems: FeedItem[] = pageItems.map((log) => {
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

    return { success: true, error: null, data: feedItems, nextCursor };
  } catch (err) {
    console.error("getLibraryImages unexpected error:", err);
    return {
      success: false,
      error: "Failed to fetch library",
      data: [],
      nextCursor: null,
    };
  }
}
