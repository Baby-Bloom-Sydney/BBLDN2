/**
 * Bot lifecycle helpers — lazy creation + children fetch.
 */

import { createAdminClient } from "@/lib/supabase/admin";
import type { BotRole } from "@/lib/ai/model-selector";
import type { ChildSummary } from "@/lib/chat/context";
import type { BotSettings } from "@/types/bapp";
import { seedDefaultSchedules } from "@/lib/chat/proactive/seed-defaults";
import { APP_TZ } from "@/lib/constants";

export interface BotRecord {
  id: string;
  user_id: string;
  role: BotRole;
  /** JSONB column typed as `BotSettings` so every caller (chat route,
   *  proactive dispatcher, modules) can read typed fields directly
   *  without per-callsite casts or `as any`. The forward-compat index
   *  signature on BotSettings preserves the read-merge-write JSONB
   *  pattern that other modules rely on. */
  settings: BotSettings;
  is_active: boolean;
  created_at: string;
}

/**
 * Gets the user's bot, creating it lazily on first access.
 * One bot per user — UNIQUE(user_id) enforces this at DB level.
 */
export async function getOrCreateBot(
  userId: string,
  role: BotRole,
): Promise<BotRecord> {
  const admin = createAdminClient();

  // Try read first
  const { data: existing, error: selectErr } = await admin
    .from("bloombot")
    .select("id, user_id, role, settings, is_active, created_at")
    .eq("user_id", userId)
    .maybeSingle();

  if (selectErr) {
    throw new Error(`bloombot select failed: ${selectErr.message}`);
  }

  if (existing) {
    return existing as BotRecord;
  }

  // Lazy create
  const { data: created, error: insertErr } = await admin
    .from("bloombot")
    .insert({
      user_id: userId,
      role,
      settings: {
        waking_hours: {
          start: "07:00",
          end: "22:00",
          timezone: APP_TZ,
        },
      },
    })
    .select("id, user_id, role, settings, is_active, created_at")
    .single();

  if (insertErr || !created) {
    // Edge case: concurrent insert raced us. Try read again.
    const { data: racer } = await admin
      .from("bloombot")
      .select("id, user_id, role, settings, is_active, created_at")
      .eq("user_id", userId)
      .maybeSingle();
    if (racer) return racer as BotRecord;
    throw new Error(
      `bloombot create failed: ${insertErr?.message ?? "no row returned"}`,
    );
  }

  // First-visit templated intro. Non-blocking — log and carry on on failure.
  try {
    await admin.from("chat_messages").insert({
      bloombot_id: created.id,
      role: "assistant",
      content: firstVisitIntro(role),
      trigger_source: "proactive_template",
      proactive_trigger_id: "bloombot.first_visit",
      is_read: false,
    });
  } catch (e) {
    console.warn("[bloombot] first-visit intro insert failed", e);
  }

  // Seed default proactive schedules (weekly_overview per child). Best-
  // effort: any failure is logged + swallowed, never blocks bot creation.
  // Idempotent inside seedDefaultSchedules itself, so a racy second
  // caller is safe.
  try {
    const children = await getUserChildren(userId, role);
    const tz =
      (created.settings as { waking_hours?: { timezone?: string } } | null)
        ?.waking_hours?.timezone ?? APP_TZ;
    await seedDefaultSchedules(admin, created.id, children, tz);
  } catch (e) {
    console.warn("[bloombot] seed default schedules failed", e);
  }

  return created as BotRecord;
}

/** Role-specific first-visit intro message (template tier, zero cost). */
function firstVisitIntro(role: BotRole): string {
  if (role === "parent") {
    return `Hi — I'm Katie.

I'll help you follow your child's development, manage the people in your care circle, and stay on top of your schedule — usually before you have to ask.

Try me: "show me this week's progress".`;
  }
  if (role === "admin") {
    return `Hi — I'm Katie (admin mode).

You can inspect my prompts, propose edits, and see what's deployed. I'll show diffs before applying anything. Protected sections need a second confirmation.`;
  }
  // nanny (default)
  return `Hi — I'm Katie.

I'll help you across all of Baby Bloom. Logging meals, tracking progress, planning activities, browsing jobs — I can handle it from here.

Try: "log Oliver's breakfast — banana and yogurt, 8am".`;
}

/**
 * Calculates child age in whole months from date_of_birth.
 */
function ageMonths(dob: string | null): number {
  if (!dob) return 0;
  const birth = new Date(dob);
  const now = new Date();
  let months = (now.getFullYear() - birth.getFullYear()) * 12;
  months += now.getMonth() - birth.getMonth();
  if (now.getDate() < birth.getDate()) months -= 1;
  return Math.max(0, months);
}

function ageBracket(months: number): string {
  if (months < 3) return "0-3 months";
  if (months < 6) return "3-6 months";
  if (months < 12) return "6-12 months";
  if (months < 18) return "12-18 months";
  if (months < 24) return "18-24 months";
  if (months < 32) return "24-32 months";
  return "32+ months";
}

/**
 * Fetches children the user has access to. Mirrors user_has_child_access():
 * direct nanny ownership OR placement-based access for both nannies and
 * parents. Scoped to under_three children (Katie is the under-three UI).
 *
 * `child_client.status` is not filtered: the canonical PG function
 * doesn't filter it either, and real values are multi-state
 * ('created_auto', 'created_manual', 'setup', 'active_nanny', …) with
 * no single literal meaning "live". A prior version filtered on
 * status='active' which never matched any real row. See PROGRESS.md
 * B-03 diagnosis (2026-04-23) for the incident.
 *
 * Returns ChildSummary[] ready for ModuleContext.children.
 */
export async function getUserChildren(
  userId: string,
  role: "nanny" | "parent" | "admin",
): Promise<ChildSummary[]> {
  const admin = createAdminClient();

  // Role-aware enumeration (per Bailey's correction 2026-05-12):
  // - Nanny: their direct nanny ownership + placements where they are
  //   the nanny. They never see parent-only children even if they
  //   happen to also be a parent of some other family.
  // - Parent: their direct parent ownership + placements where they
  //   are the parent. Symmetric to the above.
  // - Admin: returns empty here. Admin context for Katie uses the
  //   admin module path (system inventory, prompt edits, etc.), not
  //   the per-family children enumeration.
  if (role === "admin") {
    return [];
  }

  const isNanny = role === "nanny";

  // Step 1: child_client rows where the user owns the role-side column.
  const ownerColumn = isNanny ? "nanny_user_id" : "parent_user_id";
  const { data: direct } = await admin
    .from("child_client")
    .select("id, first_name, gender, date_of_birth")
    .eq(ownerColumn, userId)
    .eq("under_three", true);

  // Step 2: placement-based access for the same role only. Placements
  // join to BOTH nannies + parents; filter to the side that matches
  // this user's role.
  const { data: placements } = await admin
    .from("nanny_placements")
    .select(
      "id, child_client:child_client!inner(id, first_name, gender, date_of_birth, under_three), nannies:nannies!inner(user_id), parents:parents!inner(user_id)",
    )
    .eq("status", "active");

  const viaPlacement = (placements ?? []).filter((p) => {
    if (isNanny) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (p.nannies as any)?.user_id === userId;
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (p.parents as any)?.user_id === userId;
  });

  // Deduplicate by child_client.id
  const all = new Map<
    string,
    {
      id: string;
      first_name: string;
      gender: string | null;
      date_of_birth: string | null;
    }
  >();
  for (const row of direct ?? []) {
    all.set(row.id as string, row);
  }
  for (const p of viaPlacement) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cc = p.child_client as any;
    if (cc && cc.under_three) {
      all.set(cc.id as string, cc);
    }
  }

  return Array.from(all.values()).map((row) => {
    const months = ageMonths(row.date_of_birth);
    return {
      id: row.id,
      firstName: row.first_name,
      ageMonths: months,
      ageBracket: ageBracket(months),
      gender: row.gender,
    };
  });
}

/**
 * Batch check: returns the subset of `userIds` that have at least one
 * connected child_client (either as direct nanny owner or via an
 * active placement). Used by the proactive-cron dispatcher (WU 14)
 * to skip AI work for bots whose user isn't an active app user.
 *
 * Mirrors the same access logic as `getUserChildren` but is shape-
 * optimised for batch checks: returns just user_ids, not full
 * child rows. Two queries total regardless of the input list size.
 *
 * Inactive nannies (signed up to the marketplace but never placed,
 * with no child) are the cost-explosion case — they have a
 * `bloombot` row but no developmental data to act on. Skipping
 * AI-tier proactives for them is the single-largest cost win
 * available. Marketplace-style notifications (job alerts, BSR
 * alerts) are a separate channel and unaffected.
 */
export async function getUsersWithChildren(
  userIds: string[],
): Promise<Set<string>> {
  const result = new Set<string>();
  if (userIds.length === 0) return result;
  const admin = createAdminClient();

  // Step 1: direct nanny ownership.
  const { data: direct } = await admin
    .from("child_client")
    .select("nanny_user_id")
    .in("nanny_user_id", userIds)
    .eq("under_three", true);
  for (const row of (direct ?? []) as Array<{ nanny_user_id: string }>) {
    if (row.nanny_user_id) result.add(row.nanny_user_id);
  }

  // Step 2: active placements — the placement table joins to
  // nannies/parents, each of which has a user_id. We can filter the
  // placement-side join, then collect the user_ids that match the
  // input list.
  const { data: placements } = await admin
    .from("nanny_placements")
    .select(
      "child_client:child_client!inner(under_three), nannies:nannies!inner(user_id), parents:parents!inner(user_id)",
    )
    .eq("status", "active");
  const lookup = new Set(userIds);
  // Supabase types nested joins as arrays at the type level, even when
  // the join is single-cardinality. We narrow inside the loop and use
  // `unknown` casts to keep the call site readable while staying
  // honest about the runtime shape.
  for (const raw of (placements ?? []) as unknown as Array<
    Record<string, unknown>
  >) {
    const cc = (raw.child_client ?? null) as
      | { under_three?: boolean }
      | { under_three?: boolean }[]
      | null;
    const ccObj = Array.isArray(cc) ? cc[0] : cc;
    if (!ccObj?.under_three) continue;

    const nannies = (raw.nannies ?? null) as
      | { user_id?: string }
      | { user_id?: string }[]
      | null;
    const nannyObj = Array.isArray(nannies) ? nannies[0] : nannies;
    const nannyUid = nannyObj?.user_id;
    if (nannyUid && lookup.has(nannyUid)) result.add(nannyUid);

    const parents = (raw.parents ?? null) as
      | { user_id?: string }
      | { user_id?: string }[]
      | null;
    const parentObj = Array.isArray(parents) ? parents[0] : parents;
    const parentUid = parentObj?.user_id;
    if (parentUid && lookup.has(parentUid)) result.add(parentUid);
  }

  return result;
}

/** Get the user's stored role from user_roles. */
export async function getUserRole(userId: string): Promise<BotRole | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .maybeSingle();
  const role = data?.role as string | undefined;
  if (role === "nanny" || role === "parent") return role;
  if (role === "admin" || role === "super_admin") return "admin";
  return null;
}
