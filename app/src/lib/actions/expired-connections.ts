"use server";

/**
 * The family's expired connections (shown on their lists with the reason and "Connect with NAME again") and their open
 * request count (the limit `ConnectModal` checks: `status = 'pending'`, as `createConnectionRequest` counts it). Read as
 * the signed-in family only.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { readFamilyExpiredConnections, type ExpiredConnection } from "@/lib/connections/expired-rows";
import { getParentId } from "./parent";

export async function getParentExpiredConnections(): Promise<{ data: ExpiredConnection[]; error: string | null }> {
  const parentId = await getParentId();
  if (!parentId) return { data: [], error: "Not authenticated as parent" };
  try {
    return { data: await readFamilyExpiredConnections(createAdminClient(), parentId), error: null };
  } catch (thrown) {
    console.error("[expired-connections] read failed", { name: thrown instanceof Error ? thrown.name : typeof thrown });
    return { data: [], error: "Failed to read expired connections." };
  }
}

export async function getParentOpenRequestCount(): Promise<number> {
  const parentId = await getParentId();
  if (!parentId) return 0;
  const { count } = await createAdminClient()
    .from("connection_requests")
    .select("id", { count: "exact", head: true })
    .eq("parent_id", parentId)
    .eq("status", "pending");
  return count ?? 0;
}
