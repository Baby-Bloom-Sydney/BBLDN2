"use server";

/**
 * /admin/guarantees server actions (4e brief step 2; ADR-088, offer §4 + §7.5, runbook SOP 14). BB-LDN-4e-151026.
 *
 * `findGuaranteeFamily(email)` — the admin types the family's email; returns who it is, the G1/G2 window
 * information (never a block) and the promises already recorded.
 * `recordGuarantee(input)` — writes one `guarantee_events` row and an `activity_logs` `guarantee.recorded` row.
 *
 * Contract: `requireAdmin()` first, before any read or write. The recorder is the session's admin and the placement
 * is the family's own (from `parent_subscriptions`), never the client's. G4 is refused below
 * `G4.enabledAfterPlacements` placements. G1–G4 once per family is the database's partial unique index; its
 * violation comes back as `already_recorded`. Writes nothing a parent or a nanny sees.
 */
import { revalidatePath } from "next/cache";
import { requireAdmin } from "@/lib/admin/require-admin";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  g2WindowState,
  g4Enabled,
  isPromise,
  validateGuaranteeInput,
  type GuaranteeInputError,
  type GuaranteePromise,
  type WindowState,
} from "./rules";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const EMAIL_MAX = 254;
const UNIQUE_VIOLATION = "23505";

export interface GuaranteeFamily {
  parentUserId: string;
  name: string;
  email: string | null;
  placedAt: string | null;
  satisfactionWindowEndsAt: string | null;
  g2Window: WindowState;
  recorded: GuaranteePromise[];
}

export type FindFamilyResult =
  | { ok: true; family: GuaranteeFamily }
  | { ok: false; error: "not_authorized" | "invalid_email" | "not_found" | "ambiguous" | "not_a_family" | "lookup_failed" };

export type RecordResult =
  | { ok: true; id: string }
  | {
      ok: false;
      error: GuaranteeInputError | "not_authorized" | "not_a_family" | "g4_not_enabled" | "already_recorded" | "save_failed";
    };

const escapeLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

interface ProfileRow {
  user_id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
}

interface SubRow {
  placement_id: string | null;
  placed_at: string | null;
  satisfaction_window_ends_at: string | null;
}

type Admin = ReturnType<typeof createAdminClient>;

async function isFamily(admin: Admin, parentUserId: string): Promise<boolean> {
  const { data } = await admin.from("parents").select("id").eq("user_id", parentUserId).maybeSingle();
  return Boolean(data);
}

async function familySubscription(admin: Admin, parentUserId: string): Promise<SubRow | null> {
  const { data } = await admin
    .from("parent_subscriptions")
    .select("placement_id, placed_at, satisfaction_window_ends_at")
    .eq("parent_user_id", parentUserId)
    .maybeSingle<SubRow>();
  return data ?? null;
}

export async function findGuaranteeFamily(rawEmail: string): Promise<FindFamilyResult> {
  const { error: authError } = await requireAdmin();
  if (authError) return { ok: false, error: "not_authorized" };
  const email = typeof rawEmail === "string" ? rawEmail.trim().toLowerCase() : "";
  if (!email || email.length > EMAIL_MAX || !EMAIL_RE.test(email)) return { ok: false, error: "invalid_email" };

  const admin = createAdminClient();
  const { data: profiles, error } = await admin
    .from("user_profiles")
    .select("user_id, first_name, last_name, email")
    .ilike("email", escapeLike(email))
    .limit(2)
    .returns<ProfileRow[]>();
  if (error) return { ok: false, error: "lookup_failed" };
  if (!profiles || profiles.length === 0) return { ok: false, error: "not_found" };
  if (profiles.length > 1) return { ok: false, error: "ambiguous" };
  const p = profiles[0];
  if (!(await isFamily(admin, p.user_id))) return { ok: false, error: "not_a_family" };

  const sub = await familySubscription(admin, p.user_id);
  const { data: recordedRows } = await admin
    .from("guarantee_events")
    .select("promise")
    .eq("parent_user_id", p.user_id)
    .returns<Array<{ promise: string }>>();
  const recorded = [...new Set((recordedRows ?? []).map((r) => r.promise).filter(isPromise))];

  return {
    ok: true,
    family: {
      parentUserId: p.user_id,
      name: [p.first_name, p.last_name].filter(Boolean).join(" "),
      email: p.email,
      placedAt: sub?.placed_at ?? null,
      satisfactionWindowEndsAt: sub?.satisfaction_window_ends_at ?? null,
      g2Window: g2WindowState(sub?.satisfaction_window_ends_at ?? null),
      recorded,
    },
  };
}

export async function recordGuarantee(input: unknown): Promise<RecordResult> {
  const { userId: adminId, error: authError } = await requireAdmin();
  if (authError) return { ok: false, error: "not_authorized" };
  const parsed = validateGuaranteeInput(input);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const v = parsed.value;

  const admin = createAdminClient();
  if (!(await isFamily(admin, v.parentUserId))) return { ok: false, error: "not_a_family" };

  if (v.promise === "G4") {
    const { count } = await admin.from("nanny_placements").select("id", { count: "exact", head: true });
    if (!g4Enabled(count ?? 0)) return { ok: false, error: "g4_not_enabled" };
  }

  const sub = await familySubscription(admin, v.parentUserId);
  const { data: row, error: insErr } = await admin
    .from("guarantee_events")
    .insert({
      parent_user_id: v.parentUserId,
      placement_id: sub?.placement_id ?? null,
      promise: v.promise,
      condition_met: v.conditionMet,
      outcome: v.outcome,
      paid_out_pence: v.paidOutPence,
      notes: v.notes,
      recorded_by: adminId,
    })
    .select("id")
    .single<{ id: string }>();
  if (insErr || !row) {
    if (insErr?.code === UNIQUE_VIOLATION) return { ok: false, error: "already_recorded" };
    console.error("[admin/guarantees] insert failed", insErr?.message ?? "no row");
    return { ok: false, error: "save_failed" };
  }

  const { error: logErr } = await admin.from("activity_logs").insert({
    user_id: v.parentUserId,
    action_type: "guarantee.recorded",
    action_details: {
      guarantee_event_id: row.id,
      promise: v.promise,
      condition_met: v.conditionMet,
      paid_out_pence: v.paidOutPence,
      recorded_by: adminId,
    },
  });
  if (logErr) console.error("[admin/guarantees] guarantee.recorded row failed", logErr.message);

  revalidatePath("/admin/guarantees");
  return { ok: true, id: row.id };
}
