"use server";

/**
 * /admin/cohorts server actions (brief §3.1, §3.5, §3.7, §3.9–3.10; plan 02 step 7). BB-wave1-041126/02-build.
 *
 * Contract, for each: `cohortsEnabled()` first (off → `cohorts_disabled`, before any read), then `proveAdmin()`
 * (not an admin → `not_authorized`, before any client is made), then the input is validated with `rules.ts`, then
 * one place operation runs (it writes its own audit row in the same database step), then the page is revalidated.
 * The actor is always the session's admin, never the client's. Nothing is thrown: a failure is `save_failed`.
 * Only these three async functions are exported — every async export of a "use server" file is callable.
 */

import { revalidatePath } from "next/cache";
import { proveAdmin, type AdminProof } from "@/lib/calls/admin-proof";
import { actionErrorMessage, ALREADY_REOPENED, INVALID_PLACES } from "@/lib/cohorts/copy";
import { isLondonDate } from "@/lib/cohorts/dates";
import { logFailure, type AdminClient } from "@/lib/cohorts/db";
import { reopenPlace, saveSchedule, setCohortPlaces as setPlaces } from "@/lib/cohorts/places";
import { parsePlaces, validateReason, validateSchedule } from "@/lib/cohorts/rules";
import { cohortsEnabled } from "@/lib/features/flags";
import { createAdminClient } from "@/lib/supabase/admin";

export type CohortActionResult =
  | { readonly ok: true; readonly message?: string }
  | { readonly ok: false; readonly error: string; readonly message: string };

const PAGE = "/admin/cohorts";

const refused = (error: string, message: string = actionErrorMessage(error)): CohortActionResult => ({ ok: false, error, message });

const fieldsOf = (input: unknown): Record<string, unknown> => (typeof input === "object" && input !== null ? (input as Record<string, unknown>) : {});

/** The switch, then the admin, then a client — each only after the one before passed. */
async function gate(): Promise<{ readonly proof: AdminProof; readonly admin: AdminClient } | CohortActionResult> {
  if (!cohortsEnabled()) return refused("cohorts_disabled");
  const proof = await proveAdmin();
  if (!proof) return refused("not_authorized");
  try {
    return { proof, admin: createAdminClient() };
  } catch (thrown) {
    logFailure("admin/cohorts client", thrown);
    return refused("save_failed");
  }
}

const isGateRefusal = (g: Awaited<ReturnType<typeof gate>>): g is CohortActionResult => "ok" in g;

export async function saveCohortSchedule(input: unknown): Promise<CohortActionResult> {
  const g = await gate();
  if (isGateRefusal(g)) return g;
  const valid = validateSchedule(input);
  if (!valid.ok) return refused(valid.error, valid.message);
  const saved = await saveSchedule(g.proof, g.admin, valid.schedule);
  if (!saved.ok) return refused("save_failed");
  revalidatePath(PAGE);
  return { ok: true };
}

export async function setCohortPlaces(input: unknown): Promise<CohortActionResult> {
  const g = await gate();
  if (isGateRefusal(g)) return g;
  const fields = fieldsOf(input);
  if (!isLondonDate(fields.startDate)) return refused("invalid");
  const places = parsePlaces(fields.places);
  if (places === null) return refused("invalid_places", INVALID_PLACES);
  const set = await setPlaces(g.proof, g.admin, { startDate: fields.startDate, places });
  if (set.ok) {
    revalidatePath(PAGE);
    return { ok: true };
  }
  if (set.status === "below_taken") return refused("below_taken", set.message);
  return refused(set.status === "error" ? "save_failed" : set.status);
}

export async function reopenCohortPlace(input: unknown): Promise<CohortActionResult> {
  const g = await gate();
  if (isGateRefusal(g)) return g;
  const fields = fieldsOf(input);
  const reason = validateReason(fields.reason);
  if (!reason.ok) return refused(reason.error, reason.message);
  if (typeof fields.placeId !== "string") return refused("invalid");
  const done = await reopenPlace(g.proof, g.admin, { placeId: fields.placeId, reason: reason.reason });
  if (!done.ok) return refused(done.status === "error" ? "save_failed" : done.status);
  revalidatePath(PAGE);
  return done.status === "already_reopened" ? { ok: true, message: ALREADY_REOPENED } : { ok: true };
}
