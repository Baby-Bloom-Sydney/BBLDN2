/**
 * Done-for-you access (4c, brief steps 3, 4 and 8; triage row 4c, inventory N7/N8).
 *
 * - `openDfyAccess(admin, placementId)` — called by `_createPlacement` right after the `nanny_placements`
 *   insert. Turns the family's one subscription row into `family_type='dfy'`, `status='placed'` (access on,
 *   ADR-093), `payment_due_at = start + BILL_AFTER_START_DAYS` (ADR-094) and
 *   `satisfaction_window_ends_at = start + G2.windowDays` (ADR-088). A self-serve family with a live
 *   trial/paid state is left alone. Idempotent per placement. Never throws: a failure is logged and
 *   returned, so the placement is never rolled back.
 * - `isDfyFamily(admin, parentUserId)` — the trial guard at the two child-linking call sites.
 * - `balanceAfterWeek1Pence(...)` — the bill: fee − deposit (if paid) − min(first week's wages, cap).
 *
 * Takes the service-role client as an argument and imports only types and `@/config/*`, so the pure
 * amount function is safe to import from the admin client component. Every amount and window comes
 * from `@/config/prices` / `@/config/offer`. BB-LDN-4c-151026.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { PRICES } from "@/config/prices";
import { BILL_AFTER_START_DAYS, FIRST_WEEK_DISCOUNT_CAP, G2 } from "@/config/offer";

const DAY_MS = 24 * 60 * 60 * 1000;
const NONE = 0;

export type OpenDfyAccessResult = "opened" | "already_open" | "skipped_self_serve" | "failed";

interface PlacementRow {
  id: string;
  parent_id: string;
  start_date: string | null;
  hired_at: string | null;
}

interface SubRow {
  id: string;
  status: string;
  family_type: string | null;
  placement_id: string | null;
  trial_ends_at?: string | null;
  paid_period_ends_at?: string | null;
  past_due_grace_ends_at?: string | null;
}

const isFuture = (iso: string | null | undefined, now: number) => !!iso && Date.parse(iso) > now;

/** The original live self-serve states (the gate's clauses): a family already using the app on its own terms. */
export function isLiveSelfServe(
  sub: Pick<SubRow, "status" | "family_type" | "trial_ends_at" | "paid_period_ends_at" | "past_due_grace_ends_at">,
  now: number = Date.now(),
): boolean {
  if ((sub.family_type ?? "self_serve") !== "self_serve") return false;
  switch (sub.status) {
    case "trial":
      return isFuture(sub.trial_ends_at, now);
    case "active_monthly":
    case "active_upfront":
    case "cancelled":
      return isFuture(sub.paid_period_ends_at, now);
    case "past_due":
      return isFuture(sub.past_due_grace_ends_at, now);
    default:
      return false;
  }
}

/** The nanny's first day: the placement's `start_date` (a date, read as UTC midnight), else the hire time. */
function startMs(p: PlacementRow): number | null {
  const raw = p.start_date ? (p.start_date.length === 10 ? `${p.start_date}T00:00:00Z` : p.start_date) : p.hired_at;
  const ms = raw ? Date.parse(raw) : NaN;
  return Number.isNaN(ms) ? null : ms;
}

async function logActivity(admin: SupabaseClient, userId: string, actionType: string, details: Record<string, unknown>) {
  const { error } = await admin.from("activity_logs").insert({ user_id: userId, action_type: actionType, action_details: details });
  if (error) console.error(`[dfy-access] could not write ${actionType}:`, error.message);
}

export async function openDfyAccess(admin: SupabaseClient, placementId: string): Promise<OpenDfyAccessResult> {
  try {
    const { data: placement, error: pErr } = await admin
      .from("nanny_placements")
      .select("id, parent_id, start_date, hired_at")
      .eq("id", placementId)
      .maybeSingle<PlacementRow>();
    if (pErr || !placement) throw new Error(`placement ${placementId} not readable: ${pErr?.message ?? "not found"}`);

    const { data: parent, error: parErr } = await admin
      .from("parents")
      .select("user_id")
      .eq("id", placement.parent_id)
      .maybeSingle<{ user_id: string }>();
    if (parErr || !parent?.user_id) throw new Error(`parent for placement ${placementId} not readable`);
    const parentUserId = parent.user_id;

    const { data: sub, error: sErr } = await admin
      .from("parent_subscriptions")
      .select("id, status, family_type, placement_id, trial_ends_at, paid_period_ends_at, past_due_grace_ends_at")
      .eq("parent_user_id", parentUserId)
      .maybeSingle<SubRow>();
    if (sErr) throw new Error(`subscription read failed: ${sErr.message}`);

    if (sub?.placement_id === placementId) return "already_open";

    const now = Date.now();
    if (sub && isLiveSelfServe(sub, now)) {
      await logActivity(admin, parentUserId, "dfy_access.skipped_self_serve", {
        placement_id: placementId,
        status: sub.status,
      });
      return "skipped_self_serve";
    }

    const start = startMs(placement);
    if (start === null) throw new Error(`placement ${placementId} has no start or hire time`);
    const fields = {
      family_type: "dfy",
      status: "placed",
      placement_id: placementId,
      placed_at: new Date(now).toISOString(),
      payment_due_at: new Date(start + BILL_AFTER_START_DAYS * DAY_MS).toISOString(),
      satisfaction_window_ends_at: new Date(start + G2.windowDays * DAY_MS).toISOString(),
    };
    const { error: wErr } = sub
      ? await admin.from("parent_subscriptions").update(fields).eq("id", sub.id)
      : await admin.from("parent_subscriptions").insert({ parent_user_id: parentUserId, ...fields });
    if (wErr) throw new Error(`subscription write failed: ${wErr.message}`);

    await logActivity(admin, parentUserId, "dfy_access.opened", {
      placement_id: placementId,
      previous_status: sub?.status ?? null,
      payment_due_at: fields.payment_due_at,
      satisfaction_window_ends_at: fields.satisfaction_window_ends_at,
    });
    return "opened";
  } catch (err) {
    console.error("[dfy-access] openDfyAccess failed:", err instanceof Error ? err.message : "unknown");
    return "failed";
  }
}

/**
 * A DFY family gets no trial (ADR-093): `family_type='dfy'` or a DFY-only status. On a read error it answers
 * false and logs: the trial RPC itself no-ops for any family that already has a row, so the guard failing
 * open cannot mint a DFY trial.
 */
export async function isDfyFamily(admin: SupabaseClient, parentUserId: string): Promise<boolean> {
  const { data, error } = await admin
    .from("parent_subscriptions")
    .select("family_type, status")
    .eq("parent_user_id", parentUserId)
    .maybeSingle<{ family_type: string | null; status: string }>();
  if (error) console.error("[dfy-access] isDfyFamily read failed:", error.message);
  if (!data) return false;
  return data.family_type === "dfy" || data.status === "deposit_paid" || data.status === "placed";
}

/** The bill one week after the start (ADR-094): fee − deposit (if paid, ADR-097) − min(wages, cap) (ADR-100). */
export function balanceAfterWeek1Pence(args: { depositPaid: boolean; firstWeekWagesPence: number }): number {
  const { depositPaid, firstWeekWagesPence } = args;
  if (!Number.isInteger(firstWeekWagesPence) || firstWeekWagesPence < 0) {
    throw new Error("first week's wages must be whole, non-negative pence");
  }
  const cap = FIRST_WEEK_DISCOUNT_CAP.hourlyPence * FIRST_WEEK_DISCOUNT_CAP.maxHours;
  const depositCredit = depositPaid ? PRICES.dfy.depositPence : NONE;
  const credit = depositCredit + Math.min(firstWeekWagesPence, cap);
  return Math.max(0, PRICES.dfy.feePence - credit);
}

const PENCE_PER_POUND = 100;

/** First week's wages from a placement snapshot: `weekly_hours × hourly_rate` (rate in pounds), as pence. */
export function wagesPenceFromSnapshot(
  weeklyHours: number | string | null | undefined,
  hourlyRate: number | string | null | undefined,
): number | null {
  if (weeklyHours === null || weeklyHours === undefined || hourlyRate === null || hourlyRate === undefined) return null;
  const hours = Number(weeklyHours);
  const rate = Number(hourlyRate);
  if (!Number.isFinite(hours) || !Number.isFinite(rate) || hours <= 0 || rate <= 0) return null;
  return Math.round(hours * rate * PENCE_PER_POUND);
}
