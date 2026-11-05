/**
 * Who is asking, for the call page and its actions (plan B6; brief §9.15): the request's own session, never an id
 * from the browser. The cookie client's user, and her role read with that same client — as
 * `src/lib/admin/require-admin.ts` does, never with the service role.
 *
 * - `sessionCaller` tells the three apart (04b rework W1): the call slide lives at `/matchmaking/call`, which the
 *   middleware doesn't guard, so the page itself sends "signed out" to `/login?redirect=…` and 404s anyone signed in
 *   who isn't a parent. A throw counts as "not a parent" (a 404, never a login loop).
 * - `sessionParentId` is the actions' view of it: a parent → her user id; anyone else → null.
 *
 * Plain server module, deliberately NOT `"use server"`: it must never become an action of its own.
 *
 * BB-wave1-041126/04b-build, 2026-11-04; BB-wave1-041126/04b-rework, 2026-11-05.
 */

import { createClient } from "@/lib/supabase/server";

/** PostgREST's "no rows" for `.single()`: no role row, which is a plain "not a parent", not an error to log. */
const NO_ROWS = "PGRST116";

export type SessionCaller =
  | { readonly kind: "signed_out" }
  | { readonly kind: "not_a_parent" }
  | { readonly kind: "parent"; readonly parentId: string };

const SIGNED_OUT: SessionCaller = Object.freeze({ kind: "signed_out" });
const NOT_A_PARENT: SessionCaller = Object.freeze({ kind: "not_a_parent" });

export async function sessionCaller(): Promise<SessionCaller> {
  try {
    const supabase = createClient();
    const {
      data: { user },
      error,
    } = await supabase.auth.getUser();
    if (error || !user) return SIGNED_OUT;
    const { data: role, error: roleError } = await supabase.from("user_roles").select("role").eq("user_id", user.id).single();
    if (roleError && roleError.code !== NO_ROWS) {
      console.error("[calls/parent-session] the role read failed", { name: roleError.name, code: roleError.code });
    }
    return role?.role === "parent" ? { kind: "parent", parentId: user.id } : NOT_A_PARENT;
  } catch (thrown) {
    console.error("[calls/parent-session] the session check failed", { name: thrown instanceof Error ? thrown.name : typeof thrown });
    return NOT_A_PARENT;
  }
}

export async function sessionParentId(): Promise<string | null> {
  const caller = await sessionCaller();
  return caller.kind === "parent" ? caller.parentId : null;
}
