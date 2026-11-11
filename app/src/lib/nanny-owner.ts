/**
 * Whether the signed-in viewer is the nanny whose profile is shown: her own nannies row's id against the profile's.
 * Used by the profile pages (server components) so the profile itself never carries her account id. Server-only by
 * use (the service key); never a `"use server"` file.
 *
 * BB-wave1-041126, 2026-11-09.
 */
import { createAdminClient } from "@/lib/supabase/admin";

export async function viewerIsNanny(viewerUserId: string, nannyId: string): Promise<boolean> {
  const { data, error } = await createAdminClient().from("nannies").select("id").eq("user_id", viewerUserId).maybeSingle();
  return !error && data?.id === nannyId;
}
