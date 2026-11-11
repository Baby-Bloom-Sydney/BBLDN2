"use server";

/**
 * The family's expired connections (shown on their lists with the reason and "Connect with NAME again") and their open
 * request count (the limit `ConnectModal` checks: `status = 'pending'`, as `createConnectionRequest` counts it). Read as
 * the signed-in family only.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import { readFamilyExpiredConnections, type ExpiredConnection } from "@/lib/connections/expired-rows";
import { getParentId } from "./parent";

const nameOf = (thrown: unknown): string => (thrown instanceof Error ? thrown.name : typeof thrown);

/** Never throws: a read that fails gives no expired rows (the hub still loads). */
export async function getParentExpiredConnections(): Promise<{ data: ExpiredConnection[]; error: string | null }> {
  try {
    const parentId = await getParentId();
    if (!parentId) return { data: [], error: "Not authenticated as parent" };
    return { data: await readFamilyExpiredConnections(createAdminClient(), parentId), error: null };
  } catch (thrown) {
    console.error("[expired-connections] read failed", { name: nameOf(thrown) });
    return { data: [], error: "Failed to read expired connections." };
  }
}

/** Never throws: a count that fails reads 0 (the server's own limit still applies on send). */
export async function getParentOpenRequestCount(): Promise<number> {
  try {
    const parentId = await getParentId();
    if (!parentId) return 0;
    const { count } = await createAdminClient()
      .from("connection_requests")
      .select("id", { count: "exact", head: true })
      .eq("parent_id", parentId)
      .eq("status", "pending");
    return count ?? 0;
  } catch (thrown) {
    console.error("[expired-connections] count failed", { name: nameOf(thrown) });
    return 0;
  }
}
