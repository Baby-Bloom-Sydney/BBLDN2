/**
 * Per-slot verification of an incoming PreloadedContext.
 *
 * Verification rules (per `04-data-contracts.md §5`):
 *   - Top-level `as_of` is REQUIRED. If absent OR older than
 *     `MAX_PRELOAD_AGE_SECONDS`, drop the WHOLE payload (every slot
 *     reported in `dropped` with reason `as_of_missing` or
 *     `as_of_too_old`). This closes a stale-replay vector — an
 *     attacker stripping `as_of` would otherwise bypass the
 *     freshness gate entirely.
 *   - Children-array slots (children_profiles, children_recent_feeds):
 *     bad entries dropped per-entry, slot survives with the good
 *     ones. Drop record includes `child_id`.
 *   - recent_agent_memory: ALL-OR-NOTHING per slot. One bad item
 *     drops the whole slot — partial-trust on memory is too risky.
 *   - my_jobs / my_job_matches: require role === "parent".
 *   - my_placement: cross-checked against DB; stale id dropped.
 *   - connection_detail: ownership check via DB.
 *   - my_profile_basics: accepted only when its `role` matches
 *     server-known `input.role`. Defense-in-depth — Katie's
 *     authoritative role still comes from the server session, but
 *     a mismatched pre-load is dropped to prevent any consumer
 *     accidentally trusting client-shipped role.
 *   - connection_inbox / verification_status: accepted (the user
 *     owns this data; no cross-user leakage path because the page
 *     publisher only emits when on the relevant page). Server-side
 *     builder takes priority on overlap (route merge rule).
 *
 * Failure semantics: `verifyPreload` NEVER throws. Failures land in
 * `dropped` with structured reasons + child_id (when applicable) so
 * telemetry can attribute.
 *
 * The result type `PreloadVerificationResult` brands the verified
 * subset via `VerifiedContext` so downstream code cannot accidentally
 * treat raw `PreloadedContext` as already-verified.
 *
 * Spec: system/APP/BLOOMBOT/Latency:Efficiency/04-data-contracts.md §5
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ChildSummary } from "@/lib/chat/context";
import type { BotRole } from "@/lib/ai/model-selector";
import type { PreloadedContext, PreloadSlotName } from "./types";
import { PRELOAD_SLOT_NAMES } from "./types";

export const MAX_PRELOAD_AGE_SECONDS = 30;

/**
 * Reason union for `DroppedSlot.reason`. Typed as a literal union so a
 * misspelling at a drop site is a compile error rather than silent
 * data loss in telemetry.
 */
export type DropReason =
  | "as_of_missing"
  | "as_of_too_old"
  | "child_not_in_user_scope"
  | "memory_item_not_in_scope"
  | "role_mismatch"
  | "placement_id_mismatch"
  | "connection_not_owned";

/** Slots whose drop record carries a `child_id` (per-entry array slots). */
export type ChildArraySlot = "children_profiles" | "children_recent_feeds";
type SingleSlot = Exclude<PreloadSlotName, ChildArraySlot>;

/**
 * Discriminated on the `slot` axis: array slots carry `child_id`,
 * single slots do not. Eliminates the `child_id | undefined` access
 * pattern at consumer call sites.
 */
export type DroppedSlot =
  | { slot: ChildArraySlot; reason: DropReason; child_id: string }
  | { slot: SingleSlot; reason: DropReason };

/**
 * Brand symbol for `VerifiedContext`. Nominal trust marker — the
 * verifier is the single authority that may stamp it. Consumers
 * receiving `VerifiedContext` know the slots inside have been through
 * the verification rules; downstream code that accepts
 * `PreloadedContext` as input cannot accidentally be passed verified
 * data without an explicit cast.
 */
declare const __verified: unique symbol;
export type VerifiedContext = PreloadedContext & {
  readonly [__verified]: true;
};

export interface PreloadVerificationResult {
  /** Slots that passed verification. Brand-typed to prevent
   *  accidental confusion with raw input. */
  accepted: VerifiedContext;
  /** Slots that were dropped, with reasons — for telemetry only. */
  dropped: DroppedSlot[];
}

export interface PreloadVerifyInput {
  preload: PreloadedContext | undefined;
  userId: string;
  role: BotRole;
  /** Children the user has access to (already loaded by getUserChildren). */
  childrenScope: ChildSummary[];
  supabase: SupabaseClient;
}

export async function verifyPreload(
  input: PreloadVerifyInput,
): Promise<PreloadVerificationResult> {
  const accepted: PreloadedContext = {};
  const dropped: DroppedSlot[] = [];

  if (!input.preload) {
    return { accepted: brandAccepted(accepted), dropped };
  }
  const p = input.preload;

  // ── Top-level as_of: required + must be fresh ──
  // Missing as_of is treated as stale (closes a replay vector — an
  // attacker stripping the field would otherwise bypass the gate).
  if (!p.as_of) {
    for (const slot of pickPresentSlots(p)) {
      dropped.push(makeDrop(slot, "as_of_missing"));
    }
    return { accepted: brandAccepted(accepted), dropped };
  }
  const ageSec = (Date.now() - new Date(p.as_of).getTime()) / 1000;
  if (!Number.isFinite(ageSec) || ageSec > MAX_PRELOAD_AGE_SECONDS) {
    for (const slot of pickPresentSlots(p)) {
      dropped.push(makeDrop(slot, "as_of_too_old"));
    }
    return { accepted: brandAccepted(accepted), dropped };
  }

  // Carry verified `as_of` into `accepted` so the renderer can stamp
  // it into per-slot headings. Only after staleness check passes —
  // wouldn't want a stale timestamp in the accepted payload even if
  // every slot dropped (defense-in-depth).
  accepted.as_of = p.as_of;

  const childIdsInScope = new Set(input.childrenScope.map((c) => c.id));

  // ── children_profiles — per-entry verification ──
  if (p.children_profiles) {
    const goodEntries: NonNullable<PreloadedContext["children_profiles"]> = [];
    for (const entry of p.children_profiles) {
      if (childIdsInScope.has(entry.child_id)) {
        goodEntries.push(entry);
      } else {
        dropped.push({
          slot: "children_profiles",
          reason: "child_not_in_user_scope",
          child_id: entry.child_id,
        });
      }
    }
    if (goodEntries.length > 0) {
      accepted.children_profiles = goodEntries;
    }
  }

  // ── children_recent_feeds — per-entry verification ──
  if (p.children_recent_feeds) {
    const goodEntries: NonNullable<PreloadedContext["children_recent_feeds"]> =
      [];
    for (const entry of p.children_recent_feeds) {
      if (childIdsInScope.has(entry.child_id)) {
        goodEntries.push(entry);
      } else {
        dropped.push({
          slot: "children_recent_feeds",
          reason: "child_not_in_user_scope",
          child_id: entry.child_id,
        });
      }
    }
    if (goodEntries.length > 0) {
      accepted.children_recent_feeds = goodEntries;
    }
  }

  // ── recent_agent_memory — all-or-nothing ──
  if (p.recent_agent_memory) {
    const allValid = p.recent_agent_memory.items.every((item) => {
      if (item.scope === "user") return true;
      if (item.scope === "shared_child") {
        return (
          item.child_id !== undefined && childIdsInScope.has(item.child_id)
        );
      }
      // Unknown scope — fail closed (drop the whole slot).
      return false;
    });
    if (allValid) {
      accepted.recent_agent_memory = p.recent_agent_memory;
    } else {
      dropped.push({
        slot: "recent_agent_memory",
        reason: "memory_item_not_in_scope",
      });
    }
  }

  // ── my_profile_basics — role cross-check ──
  // The user's authoritative role is `input.role` (server-resolved
  // from the auth session). If the client ships a different role in
  // its profile slot, drop the slot so no downstream consumer can
  // mis-trust it. Display fields (first_name, last_name) survive
  // the drop because dropping the slot still falls back to the
  // existing `BotContext.userName` source.
  if (p.my_profile_basics) {
    if (p.my_profile_basics.role === input.role) {
      accepted.my_profile_basics = p.my_profile_basics;
    } else {
      dropped.push({
        slot: "my_profile_basics",
        reason: "role_mismatch",
      });
    }
  }

  // ── my_placement — cross-check against DB ──
  if (p.my_placement) {
    const ok = await verifyPlacement(
      input.supabase,
      input.userId,
      p.my_placement.placement_id,
    );
    if (ok) {
      accepted.my_placement = p.my_placement;
    } else {
      dropped.push({ slot: "my_placement", reason: "placement_id_mismatch" });
    }
  }

  // ── my_jobs — role gate ──
  if (p.my_jobs) {
    if (input.role === "parent" && p.my_jobs.role === "parent") {
      accepted.my_jobs = p.my_jobs;
    } else {
      dropped.push({ slot: "my_jobs", reason: "role_mismatch" });
    }
  }

  // ── my_job_matches — role gate ──
  if (p.my_job_matches) {
    if (input.role === "parent" && p.my_job_matches.role === "parent") {
      accepted.my_job_matches = p.my_job_matches;
    } else {
      dropped.push({ slot: "my_job_matches", reason: "role_mismatch" });
    }
  }

  // ── connection_detail — ownership check ──
  if (p.connection_detail) {
    const ok = await verifyConnectionOwnership(
      input.supabase,
      input.userId,
      p.connection_detail.connection_id,
    );
    if (ok) {
      accepted.connection_detail = p.connection_detail;
    } else {
      dropped.push({
        slot: "connection_detail",
        reason: "connection_not_owned",
      });
    }
  }

  // ── connection_inbox / verification_status — always accept ──
  // Both are user-owned data with no cross-user leakage path: the
  // page publisher only emits these on the corresponding inbox /
  // verification surface (see WU8 page publishers). On any
  // overlapping pre-load + server-side data, the route's merge rule
  // must prefer server data — see route impl in WU4.
  if (p.connection_inbox) {
    accepted.connection_inbox = p.connection_inbox;
  }
  if (p.verification_status) {
    accepted.verification_status = p.verification_status;
  }

  return { accepted: brandAccepted(accepted), dropped };
}

/**
 * Returns every slot that's present (non-undefined) in `p`. Uses the
 * canonical `PRELOAD_SLOT_NAMES` tuple instead of a hand-written
 * `if` chain so adding a new slot to `PreloadedContext` +
 * `PRELOAD_SLOT_NAMES` automatically picks it up here too.
 */
function pickPresentSlots(p: PreloadedContext): PreloadSlotName[] {
  return PRELOAD_SLOT_NAMES.filter((slot) => p[slot] !== undefined);
}

/**
 * Builds a typed `DroppedSlot`. The `child_id` field is required on
 * array slots (per the discriminated union) and absent on single
 * slots. Used for whole-slot drops where there's no per-entry
 * child_id (e.g. `as_of_*`).
 */
function makeDrop(slot: PreloadSlotName, reason: DropReason): DroppedSlot {
  if (slot === "children_profiles" || slot === "children_recent_feeds") {
    // For whole-slot drops on array slots (e.g. as_of_too_old), there's
    // no specific child_id. Use a sentinel so the discriminated union's
    // requirement is satisfied without losing telemetry granularity.
    return { slot, reason, child_id: "*" };
  }
  return { slot, reason };
}

/**
 * Stamp the brand on the accepted slots. The single authority — only
 * `verifyPreload` calls this. Consumers receiving `VerifiedContext`
 * know it has been through the verifier.
 */
function brandAccepted(p: PreloadedContext): VerifiedContext {
  return p as VerifiedContext;
}

/**
 * Confirms `placementId` is the user's CURRENT active placement on
 * either side (nanny or parent). Returns true on match, false on
 * mismatch / absence / DB error.
 *
 * Cheap query: nanny_placements is small + indexed on both nanny_id
 * and parent_id.
 *
 * `userId` is the trusted server-side user id from the auth session.
 * It cannot be a SQL injection vector via PostgREST `.or()` — Supabase
 * Auth guarantees a UUID format. The validation below is defense-in-depth
 * to make this fact compile-checked rather than convention.
 */
async function verifyPlacement(
  supabase: SupabaseClient,
  userId: string,
  placementId: string,
): Promise<boolean> {
  // Sanity: bail if userId isn't UUID-shaped. Should be impossible
  // given auth source, but defense-in-depth against future refactors.
  if (!/^[0-9a-f-]{36}$/i.test(userId)) return false;
  try {
    const { data } = await supabase
      .from("nanny_placements")
      .select("id, parent_id, nanny_id, status")
      .or(`nanny_id.eq.${userId},parent_id.eq.${userId}`)
      .eq("status", "active")
      .limit(1)
      .maybeSingle<{ id: string }>();
    if (!data) return false;
    return data.id === placementId;
  } catch (err) {
    // Log so a transient DB failure is distinguishable from a genuine
    // mismatch in operator triage. Telemetry still records the slot
    // as `placement_id_mismatch` (we treat DB failure as "we cannot
    // confirm — drop"); the log line tells the operator WHY.
    console.warn("[verifyPlacement] DB error (slot will be dropped):", err);
    return false;
  }
}

/**
 * Confirms the user is one of the parties on the connection (parent
 * or nanny side). Returns true on match.
 *
 * Reads `connection_requests` (5e, R-4 — the legacy `interview_requests`
 * name does not exist in the London schema). The row carries profile ids
 * (`nanny_id` → nannies.id, `parent_id` → parents.id), so the auth user
 * ids come through the `nannies` / `parents` embeds. This query bypasses
 * RLS via the service-role client; ownership is enforced in app code by
 * comparing either embedded `user_id` to the authenticated `userId`.
 */
async function verifyConnectionOwnership(
  supabase: SupabaseClient,
  userId: string,
  connectionId: string,
): Promise<boolean> {
  try {
    const { data, error } = await supabase
      .from("connection_requests")
      .select(
        "id, nannies:nannies!inner(user_id), parents:parents!inner(user_id)",
      )
      .eq("id", connectionId)
      .maybeSingle<{
        id: string;
        nannies: { user_id: string | null } | null;
        parents: { user_id: string | null } | null;
      }>();
    if (error) throw error;
    if (!data) return false;
    return (
      data.nannies?.user_id === userId || data.parents?.user_id === userId
    );
  } catch (err) {
    console.warn(
      "[verifyConnectionOwnership] DB error (slot will be dropped):",
      err,
    );
    return false;
  }
}
