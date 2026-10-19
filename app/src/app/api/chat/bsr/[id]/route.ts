/**
 * GET /api/chat/bsr/[id] — returns a single BSR (babysitting
 * request / job) enriched + translated to plain English, role-aware,
 * for Katie's inline BsrJobTile.
 *
 * Nanny sees their invitation view (bucket + slots + rate + expiry).
 * Parent sees their own request view (bucket + slots + rate + expiry +
 * requester_count when known).
 *
 * Like /api/chat/connections/[id], this is the live-fetch endpoint
 * for the id-only `bsr_job` tile. Never returns nanny phone or
 * parent address (the module's read path never surfaces those).
 */

import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { createAdminClient } from "@/lib/supabase/admin";
import { KATIE_ENABLED } from "@/lib/chat/flags";
import { babysittingEnabled } from "@/lib/features/flags";
import {
  getNannyBabysittingJobs,
  getParentBabysittingRequests,
} from "@/lib/actions/babysitting";
import {
  summariseNannyJob,
  summariseParentRequest,
  type ParentBsrRow,
} from "@/lib/chat/modules/bsr-shared";

export const runtime = "nodejs";

type Role = "nanny" | "parent";

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
    console.error("[chat/bsr] auth.getUser error:", error);
    return {
      ok: false,
      status: 500,
      error: "Auth lookup failed — please try again in a moment.",
    };
  }
  if (!data.user) return { ok: false, status: 401, error: "unauthorized" };
  return { ok: true, userId: data.user.id };
}

async function resolveRole(
  userId: string,
): Promise<
  { ok: true; role: Role } | { ok: false; status: number; error: string }
> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) {
    console.error("[chat/bsr] user_roles lookup error:", error);
    return {
      ok: false,
      status: 500,
      error: "Role lookup failed — please try again.",
    };
  }
  const role = (data as { role?: string } | null)?.role;
  if (role === "nanny" || role === "parent") return { ok: true, role };
  return { ok: false, status: 403, error: "role not found" };
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  // 5c (P-23): 404 while BABYSITTING_ENABLED is off, before auth and any read.
  if (!KATIE_ENABLED || !babysittingEnabled()) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const auth = await getAuthUser();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const roleResult = await resolveRole(auth.userId);
  if (!roleResult.ok) {
    return NextResponse.json(
      { error: roleResult.error },
      { status: roleResult.status },
    );
  }
  const role = roleResult.role;

  const { id } = params;
  if (!id) {
    return NextResponse.json({ error: "missing id" }, { status: 400 });
  }

  if (role === "nanny") {
    const result = await getNannyBabysittingJobs();
    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 500 });
    }
    const job = result.data.find((j) => j.id === id);
    if (!job) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({
      ...summariseNannyJob(job),
      role,
    });
  }

  // parent
  const result = await getParentBabysittingRequests();
  if (result.error) {
    return NextResponse.json({ error: result.error }, { status: 500 });
  }
  const rows = (result.data as unknown as ParentBsrRow[]) ?? [];
  const row = rows.find((r) => r.id === id);
  if (!row) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  return NextResponse.json({
    ...summariseParentRequest(row),
    role,
  });
}
