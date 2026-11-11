/**
 * GET /api/chat/placement/[id] — returns the parent's active
 * placement keyed by id.
 *
 * Architectural commitment: Katie's `<PlacementTile />` renders the
 * SAME `<PlacementCard />` component used on /parent/position, so
 * this endpoint hands the tile the exact `PlacementData` shape that
 * the page consumes.
 *
 * Access control: parent-only. Reuses `getParentPlacement()` which
 * already scopes to the authenticated parent. `[id]` is matched
 * against the active placement's id — if it doesn't match, returns
 * 404 (the parent's currently-active placement is not the one being
 * requested).
 */

import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { KATIE_ENABLED } from "@/lib/chat/flags";
import { getParentPlacement } from "@/lib/actions/position-funnel";

export const runtime = "nodejs";

async function getAuthUser(): Promise<
  { ok: true; userId: string } | { ok: false; status: number; error: string }
> {
  const cookieStore = cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get: (name: string) => cookieStore.get(name)?.value,
        set: () => {},
        remove: () => {},
      },
    },
  );
  const { data, error } = await supabase.auth.getUser();
  if (error) {
    console.error("[chat/placement] auth.getUser error:", error);
    return {
      ok: false,
      status: 500,
      error: "Auth lookup failed — please try again in a moment.",
    };
  }
  if (!data.user) return { ok: false, status: 401, error: "unauthorized" };
  return { ok: true, userId: data.user.id };
}

async function checkParent(
  userId: string,
): Promise<{ ok: true } | { ok: false; status: number; error: string }> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    // Distinguish DB error (transient → retriable, 500) from "not a
    // parent" (authz, 403). See sibling /api/chat/position.
    console.error("[chat/placement] user_roles lookup error:", error);
    return {
      ok: false,
      status: 500,
      error: "Role lookup failed — please try again.",
    };
  }
  if ((data as { role?: string } | null)?.role !== "parent") {
    return { ok: false, status: 403, error: "parent only" };
  }
  return { ok: true };
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  if (!KATIE_ENABLED) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const auth = await getAuthUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const parentCheck = await checkParent(auth.userId);
  if (!parentCheck.ok) {
    return NextResponse.json(
      { error: parentCheck.error },
      { status: parentCheck.status },
    );
  }

  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: "missing id" }, { status: 400 });
  }

  const { data, error } = await getParentPlacement();
  if (error) {
    return NextResponse.json({ error }, { status: 500 });
  }
  if (!data || data.id !== id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // the tile shows the card (name, age, area, hours, rate, experience); the contact details stay on the hub's popup
  const { nannyEmail: _email, nannyPhone: _phone, ...card } = data;
  return NextResponse.json({
    id: data.id,
    placement: card,
  });
}
