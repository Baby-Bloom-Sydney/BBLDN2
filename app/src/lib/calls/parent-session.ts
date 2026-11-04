/**
 * Who is asking, for `/parent/call` and its actions (plan B6; brief §9.15): the request's own session, never an id
 * from the browser. The cookie client's user, and her role read with that same client — as
 * `src/lib/admin/require-admin.ts` does, never with the service role. A parent → her user id; anyone else (signed
 * out, a nanny, an admin, no role row, an error) → null.
 *
 * Plain server module, deliberately NOT `"use server"`: it must never become an action of its own.
 *
 * BB-wave1-041126/04b-build, 2026-11-04.
 */

import { createClient } from "@/lib/supabase/server";

/** PostgREST's "no rows" for `.single()`: no role row, which is a plain "not a parent", not an error to log. */
const NO_ROWS = "PGRST116";

export async function sessionParentId(): Promise<string | null> {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) return null;
    const { data: role, error: roleError } = await supabase.from("user_roles").select("role").eq("user_id", user.id).single();
    if (roleError && roleError.code !== NO_ROWS) {
      console.error("[calls/parent-session] the role read failed", { name: roleError.name, code: roleError.code });
    }
    return role?.role === "parent" ? user.id : null;
  } catch (thrown) {
    console.error("[calls/parent-session] the session check failed", { name: thrown instanceof Error ? thrown.name : typeof thrown });
    return null;
  }
}
