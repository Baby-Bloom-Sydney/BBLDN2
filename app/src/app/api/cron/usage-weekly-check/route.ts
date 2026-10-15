import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { sendUsageLowAdminAlert, type UsageLowFamily } from "@/lib/email/usage-emails";
import { USAGE_CHECK_WINDOW_DAYS, USAGE_LOW_THRESHOLD_PER_CHILD_PER_WEEK } from "@/config/offer";
import { findLowFamilies, hasUsageAccess, type LinkedChild } from "./low-usage";

/**
 * Cron — usage-weekly-check (4e brief step 3; inventory N9; offer §7.4, ADR-092, runbook SOP 16 / M11, O-18).
 *
 * Weekly (Monday). For every family with access (`hasUsageAccess`), not a test user, each linked child's active
 * `bapp_logs` in the last `USAGE_CHECK_WINDOW_DAYS` are counted; a child below
 * `USAGE_LOW_THRESHOLD_PER_CHILD_PER_WEEK` marks the family low. **Raise only** (card 7a, 04 §36): ONE email to the
 * admin listing the low families, then a `usage.low` activity row per family (details: children + counts).
 * Nothing in-app, nothing to parents or nannies, no follow-up — the admin calls.
 *
 * Idempotent per week: a family stamped `usage.low` in the last `USAGE_CHECK_WINDOW_DAYS - 1` days is skipped.
 * The email goes first: if it fails nothing is stamped and the next run raises the same families.
 * Auth: `Authorization: Bearer $CRON_SECRET` — fails closed when the secret is unset. BB-LDN-4e-151026.
 */

const DAY_MS = 24 * 60 * 60 * 1000;
const RESTAMP_AFTER_DAYS = USAGE_CHECK_WINDOW_DAYS - 1;

interface SubRow {
  parent_user_id: string;
  status: string;
  access_toggled_on: boolean | null;
}

interface ProfileRow {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  is_test_user: boolean | null;
}

const fail = (step: string, message: string) => {
  console.error(`[cron:usage-weekly-check] ${step} failed`, message);
  return NextResponse.json({ error: `${step}_failed` }, { status: 500 });
};

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const admin = createAdminClient();
  const nowMs = Date.now();
  const sinceIso = new Date(nowMs - USAGE_CHECK_WINDOW_DAYS * DAY_MS).toISOString();
  const restampIso = new Date(nowMs - RESTAMP_AFTER_DAYS * DAY_MS).toISOString();

  const { data: subs, error: subErr } = await admin
    .from("parent_subscriptions")
    .select("parent_user_id, status, access_toggled_on")
    .returns<SubRow[]>();
  if (subErr) return fail("read_subscriptions", subErr.message);
  const withAccess = (subs ?? []).filter(hasUsageAccess).map((s) => s.parent_user_id);
  if (withAccess.length === 0) return NextResponse.json({ ok: true, checked: 0, low: 0, skipped: 0 });

  const { data: profileRows, error: profErr } = await admin
    .from("user_profiles")
    .select("user_id, first_name, last_name, email, is_test_user")
    .in("user_id", withAccess)
    .returns<ProfileRow[]>();
  if (profErr) return fail("read_profiles", profErr.message);
  const profiles = new Map((profileRows ?? []).map((p) => [p.user_id, p]));
  const checked = withAccess.filter((id) => profiles.get(id)?.is_test_user !== true);

  const { data: recent, error: recentErr } = await admin
    .from("activity_logs")
    .select("user_id")
    .eq("action_type", "usage.low")
    .gte("created_at", restampIso)
    .in("user_id", checked)
    .returns<Array<{ user_id: string | null }>>();
  if (recentErr) return fail("read_recent", recentErr.message);
  const stamped = new Set((recent ?? []).map((r) => r.user_id));
  const families = checked.filter((id) => !stamped.has(id));
  const skipped = checked.length - families.length;
  const done = (low: number) => NextResponse.json({ ok: true, checked: checked.length, low, skipped });
  if (families.length === 0) return done(0);

  const { data: childRows, error: childErr } = await admin
    .from("child_client")
    .select("id, parent_user_id, first_name")
    .in("parent_user_id", families)
    .neq("status", "closed")
    .returns<LinkedChild[]>();
  if (childErr) return fail("read_children", childErr.message);
  const children = (childRows ?? []).filter((c) => families.includes(c.parent_user_id));
  if (children.length === 0) return done(0);

  const { data: logRows, error: logErr } = await admin
    .from("bapp_logs")
    .select("child_client_id")
    .in("child_client_id", children.map((c) => c.id))
    .eq("is_active", true)
    .gte("created_at", sinceIso)
    .returns<Array<{ child_client_id: string }>>();
  if (logErr) return fail("read_logs", logErr.message);
  const posts = new Map<string, number>();
  for (const r of logRows ?? []) posts.set(r.child_client_id, (posts.get(r.child_client_id) ?? 0) + 1);

  const low = findLowFamilies(families, children, posts);
  if (low.length === 0) return done(0);

  const alert: UsageLowFamily[] = low.map((f) => {
    const p = profiles.get(f.parentUserId);
    return {
      ...f,
      name: [p?.first_name, p?.last_name].filter(Boolean).join(" "),
      email: p?.email ?? null,
    };
  });
  try {
    await sendUsageLowAdminAlert(alert, USAGE_CHECK_WINDOW_DAYS);
  } catch (e) {
    return fail("email", e instanceof Error ? e.message : String(e));
  }

  const { error: insErr } = await admin.from("activity_logs").insert(
    low.map((f) => ({
      user_id: f.parentUserId,
      action_type: "usage.low",
      action_details: {
        children: f.children.map((c) => ({ child_client_id: c.childId, first_name: c.firstName, posts: c.posts })),
        window_days: USAGE_CHECK_WINDOW_DAYS,
        threshold_per_child: USAGE_LOW_THRESHOLD_PER_CHILD_PER_WEEK,
        window_start: sinceIso,
      },
    })),
  );
  if (insErr) return fail("stamp", insErr.message);
  return done(low.length);
}
