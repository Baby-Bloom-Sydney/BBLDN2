/**
 * Whether a user is linked to a child: its parent (`child_client.parent_user_id`) or its nanny (`nanny_user_id`),
 * optionally one role only. Read with the service key, so it is the check the child-scoped actions run before they
 * read or write that child's records. Server-only; never a `"use server"` file.
 *
 * BB-wave1-041126, 2026-11-09.
 */
import { createAdminClient } from "@/lib/supabase/admin";

export type ChildMemberRole = "parent" | "nanny";

/** The one answer a child-scoped action gives anyone not linked to the child (same as an unknown child). */
export const CHILD_NOT_FOUND = "Child not found";

export async function isChildMember(childId: string, userId: string, role?: ChildMemberRole): Promise<boolean> {
  if (!childId || !userId) return false;
  const { data, error } = await createAdminClient()
    .from("child_client")
    .select("parent_user_id, nanny_user_id")
    .eq("id", childId)
    .maybeSingle<{ parent_user_id: string | null; nanny_user_id: string | null }>();
  if (error || !data) return false;
  const isParent = data.parent_user_id === userId;
  const isNanny = data.nanny_user_id === userId;
  if (role === "parent") return isParent;
  if (role === "nanny") return isNanny;
  return isParent || isNanny;
}
