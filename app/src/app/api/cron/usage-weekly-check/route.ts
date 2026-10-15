import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendUsageLowAdminAlert, type UsageLowFamily } from "@/lib/email/usage-emails";
import { USAGE_CHECK_WINDOW_DAYS, USAGE_LOW_THRESHOLD_PER_CHILD_PER_WEEK } from "@/config/offer";
import { findLowFamilies, hasUsageAccess, type AccessRow, type LinkedChild } from "./low-usage";
import { chunk, readAll, readAllIn } from "./read";

/**
 * Cron — usage-weekly-check (4e brief step 3; inventory N9; offer §7.4, ADR-092, runbook SOP 16 / M11, O-18).
 *
 * Weekly (Monday). For every family with access (`hasUsageAccess`), not a test user, each linked child's active
 * `bapp_logs` in the last `USAGE_CHECK_WINDOW_DAYS` are counted (exact head counts, one per child); a child below
 * `USAGE_LOW_THRESHOLD_PER_CHILD_PER_WEEK` marks the family low. **Raise only** (card 7a, 04 §36): ONE email to the
 * admin listing the low families, then a `usage.low` activity row per family (details: child ids + counts — names
 * stay out of the log). Nothing in-app, nothing to parents or nannies, no follow-up — the admin calls.
 *
 * Idempotent per week: a family stamped `usage.low` in the last `USAGE_CHECK_WINDOW_DAYS - 1` days is skipped.
 * The email goes first: if it fails nothing is stamped and the next run raises the same families. If the stamp
 * fails after the email went, the route answers 500 and the next run emails them again (at-least-once, admin only).
 * Auth: `Authorization: Bearer $CRON_SECRET` — fails closed when the secret is unset. BB-LDN-4e-151026.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const RESTAMP_AFTER_DAYS = USAGE_CHECK_WINDOW_DAYS - 1;
/** Parallel head-count requests per batch. */
const COUNT_BATCH = 10;

type Admin = ReturnType<typeof createAdminClient>;

interface SubRow extends AccessRow {
  parent_user_id: string;
}

interface ProfileRow {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  is_test_user: boolean | null;
}

/** Families with access, minus test users; their profiles for the email. */
async function familiesWithAccess(admin: Admin, nowMs: number) {
  const subs = await readAll<SubRow>((from, to) =>
    admin
      .from("parent_subscriptions")
      .select("parent_user_id, status, access_toggled_on, trial_ends_at, paid_period_ends_at")
      .order("id")
      .range(from, to)
      .returns<SubRow[]>(),
  );
  const withAccess = subs.filter((s) => hasUsageAccess(s, nowMs)).map((s) => s.parent_user_id);
  const profileRows = await readAllIn<ProfileRow>(withAccess, (ids, from, to) =>
    admin
      .from("user_profiles")
      .select("user_id, first_name, last_name, email, is_test_user")
      .in("user_id", ids)
      .order("user_id")
      .range(from, to)
      .returns<ProfileRow[]>(),
  );
  const profiles = new Map(profileRows.map((p) => [p.user_id, p]));
  return { checked: withAccess.filter((id) => profiles.get(id)?.is_test_user !== true), profiles };
}

async function recentlyStamped(admin: Admin, ids: string[], sinceIso: string): Promise<Set<string | null>> {
  const rows = await readAllIn<{ user_id: string | null }>(ids, (part, from, to) =>
    admin
      .from("activity_logs")
      .select("user_id")
      .eq("action_type", "usage.low")
      .gte("created_at", sinceIso)
      .in("user_id", part)
      .order("id")
      .range(from, to)
      .returns<Array<{ user_id: string | null }>>(),
  );
  return new Set(rows.map((r) => r.user_id));
}

async function linkedChildren(admin: Admin, families: string[]): Promise<LinkedChild[]> {
  const rows = await readAllIn<LinkedChild>(families, (ids, from, to) =>
    admin
      .from("child_client")
      .select("id, parent_user_id, first_name")
      .in("parent_user_id", ids)
      .neq("status", "closed")
      .order("id")
      .range(from, to)
      .returns<LinkedChild[]>(),
  );
  return rows.filter((c) => families.includes(c.parent_user_id));
}

/** Exact active-post count per child in the window (head counts — no row cap). */
async function postsPerChild(admin: Admin, childIds: string[], sinceIso: string): Promise<Map<string, number>> {
  const posts = new Map<string, number>();
  for (const batch of chunk(childIds, COUNT_BATCH)) {
    const counts = await Promise.all(
      batch.map(async (id) => {
        const { count, error } = await admin
          .from("bapp_logs")
          .select("id", { count: "exact", head: true })
          .eq("child_client_id", id)
          .eq("is_active", true)
          .gte("created_at", sinceIso);
        if (error) throw new Error(error.message);
        return [id, count ?? 0] as const;
      }),
    );
    for (const [id, n] of counts) posts.set(id, n);
  }
  return posts;
}

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const admin = createAdminClient();
  const nowMs = Date.now();
  const sinceIso = new Date(nowMs - USAGE_CHECK_WINDOW_DAYS * DAY_MS).toISOString();
  const restampIso = new Date(nowMs - RESTAMP_AFTER_DAYS * DAY_MS).toISOString();

  try {
    const { checked, profiles } = await familiesWithAccess(admin, nowMs);
    const stamped = checked.length ? await recentlyStamped(admin, checked, restampIso) : new Set<string | null>();
    const families = checked.filter((id) => !stamped.has(id));
    const done = (low: number) =>
      NextResponse.json({ ok: true, checked: checked.length, low, skipped: checked.length - families.length });
    if (families.length === 0) return done(0);

    const children = await linkedChildren(admin, families);
    if (children.length === 0) return done(0);
    const posts = await postsPerChild(admin, children.map((c) => c.id), sinceIso);
    const low = findLowFamilies(families, children, posts);
    if (low.length === 0) return done(0);

    const alert: UsageLowFamily[] = low.map((f) => {
      const p = profiles.get(f.parentUserId);
      return { ...f, name: [p?.first_name, p?.last_name].filter(Boolean).join(" "), email: p?.email ?? null };
    });
    await sendUsageLowAdminAlert(alert, USAGE_CHECK_WINDOW_DAYS);

    const { error: insErr } = await admin.from("activity_logs").insert(
      low.map((f) => ({
        user_id: f.parentUserId,
        action_type: "usage.low",
        action_details: {
          children: f.children.map((c) => ({ child_client_id: c.childId, posts: c.posts })),
          window_days: USAGE_CHECK_WINDOW_DAYS,
          threshold_per_child: USAGE_LOW_THRESHOLD_PER_CHILD_PER_WEEK,
          window_start: sinceIso,
        },
      })),
    );
    if (insErr) throw new Error(`stamp: ${insErr.message}`);
    return done(low.length);
  } catch (e) {
    console.error("[cron:usage-weekly-check] failed", e instanceof Error ? e.message : String(e));
    return NextResponse.json({ error: "check_failed" }, { status: 500 });
  }
}
