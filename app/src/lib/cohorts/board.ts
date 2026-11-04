/**
 * The /admin/cohorts board (brief §3; plan 02 step 4, §8): every cohort's numbers, the families in each, the warnings
 * box, and the two numbers 02 shows but doesn't own. Server-only, not `"use server"`. It returns families' names,
 * so it takes an `AdminProof` first and reads nothing without a real one (04a security review H2e).
 *
 * One page load = the schedule, the stored cohorts, every place but released holds, the warnings function and the
 * names, each bounded (`db.ts`). A failed core read fails the board (the page says so, never an empty list); a
 * failed warnings read or 03/04 number is flagged on its own and the rest still shows.
 *
 * BB-wave1-041126/02-build, 2026-11-04.
 */

import { z } from "zod";
import { isAdminProof, type AdminProof } from "@/lib/calls/admin-proof";
import { nextMonday } from "./dates";
import { allPagesByIds, callRpc, dbOk, DB_FAILED, logFailure, type AdminClient, type DbResult } from "./db";
import { callsThisWeekSource, preBookedSource } from "./links";
import { readFrame, readShownPlaces } from "./read";
import { countsOf, isLiveHold, viewOf } from "./rules";
import type {
  CallsFigure,
  CohortBoard,
  CohortEntry,
  CohortPlace,
  CohortSlot,
  CohortWarning,
  FamilyRow,
  PreBookedFigure,
  WarningsFigure,
} from "./types";

/** The warnings function returns at most this many rows a list (amendment 17, cohort_warnings). */
const WARNINGS_LIMIT = 100;
const STATE_ORDER: Readonly<Record<FamilyRow["state"], number>> = { taken: 0, held: 1, reopened: 2 };

const warningsReply = z.object({
  refunded_but_held: z.array(z.object({ place_id: z.string().min(1), parent_user_id: z.string().min(1), cohort_start_date: z.string().min(1) })),
  paid_without_place: z.array(z.object({ parent_user_id: z.string().min(1) })),
});
type RawWarnings = z.infer<typeof warningsReply>;

const profileRow = z.object({
  user_id: z.string().min(1),
  first_name: z.string().nullable(),
  last_name: z.string().nullable(),
  email: z.string().nullable(),
});

async function readNames(admin: AdminClient, ids: readonly string[]): Promise<DbResult<ReadonlyMap<string, string>>> {
  const rows = await allPagesByIds("readNames", ids, (chunk) => (from, to) =>
    admin.from("user_profiles").select("user_id, first_name, last_name, email").in("user_id", [...chunk])
      .order("user_id", { ascending: true }).range(from, to),
  );
  if (!rows.ok) return rows;
  const parsed = z.array(profileRow).safeParse(rows.value);
  if (!parsed.success) {
    logFailure("readNames", { code: "unexpected_row" });
    return DB_FAILED;
  }
  return dbOk(new Map(parsed.data.map((p) => [p.user_id, [p.first_name, p.last_name].filter(Boolean).join(" ") || p.email || ""])));
}

const nameOf = (names: ReadonlyMap<string, string>, userId: string): string => names.get(userId) || `Family ${userId.slice(0, 8)}`;

function familiesOf(places: readonly CohortPlace[], start: string, names: ReadonlyMap<string, string>, now: Date): readonly FamilyRow[] {
  const shown = (p: CohortPlace): p is CohortPlace & { readonly state: FamilyRow["state"] } =>
    p.cohortStartDate === start && (p.state === "taken" || p.state === "reopened" || isLiveHold(p, now));
  return places
    .filter(shown)
    .map((p): FamilyRow => ({
      placeId: p.id,
      parentUserId: p.parentUserId,
      name: nameOf(names, p.parentUserId),
      state: p.state,
      paidBy: p.paidBy,
      isGoodwill: p.isGoodwill,
      takenAt: p.takenAt,
      reopenedAt: p.reopenedAt,
      reopenReason: p.reopenReason,
    }))
    .sort((a, b) => STATE_ORDER[a.state] - STATE_ORDER[b.state] || a.name.localeCompare(b.name));
}

function entryOf(slot: CohortSlot, places: readonly CohortPlace[], names: ReadonlyMap<string, string>, now: Date): CohortEntry {
  const counts = countsOf(places, slot.startDate, now);
  return {
    view: viewOf(slot.startDate, slot.places, counts),
    goodwillTaken: counts.goodwillTaken,
    reopened: counts.reopened,
    families: familiesOf(places, slot.startDate, names, now),
  };
}

async function readWarnings(admin: AdminClient): Promise<RawWarnings | null> {
  const called = await callRpc(admin, "cohort_warnings", {});
  if (!called.ok) return null;
  const parsed = warningsReply.safeParse(called.value);
  if (!parsed.success) logFailure("cohort_warnings", { code: "unexpected_reply" });
  return parsed.success ? parsed.data : null;
}

function warningsOf(raw: RawWarnings | null, names: ReadonlyMap<string, string>, live: readonly CohortEntry[]): WarningsFigure {
  if (raw === null) return { kind: "unavailable" };
  const list: CohortWarning[] = [
    ...raw.refunded_but_held.map((w): CohortWarning => ({
      kind: "refunded_but_held", placeId: w.place_id, parentUserId: w.parent_user_id, name: nameOf(names, w.parent_user_id), cohortStartDate: w.cohort_start_date,
    })),
    ...raw.paid_without_place.map((w): CohortWarning => ({ kind: "paid_without_place", parentUserId: w.parent_user_id, name: nameOf(names, w.parent_user_id) })),
    ...live.filter((e) => e.view.overBy > 0).map((e): CohortWarning => ({ kind: "over_capacity", cohortStartDate: e.view.start, overBy: e.view.overBy })),
  ];
  const truncated = raw.refunded_but_held.length >= WARNINGS_LIMIT || raw.paid_without_place.length >= WARNINGS_LIMIT;
  return { kind: "ok", list, truncated };
}

async function readCalls(admin: AdminClient, now: Date): Promise<CallsFigure> {
  const source = callsThisWeekSource();
  if (source === null) return { kind: "not_connected" };
  try {
    const counts = await source(admin, now);
    return counts === null ? { kind: "unavailable" } : { kind: "counts", counts: { booked: counts.booked, notBooked: counts.notBooked } };
  } catch (thrown) {
    logFailure("callsThisWeek", thrown);
    return { kind: "unavailable" };
  }
}

async function readPreBooked(admin: AdminClient, nextStart: string | null): Promise<PreBookedFigure> {
  const source = preBookedSource();
  if (source === null || nextStart === null) return { kind: "not_connected" };
  try {
    const count = await source(admin, nextStart);
    return count === null ? { kind: "unavailable" } : { kind: "count", count };
  } catch (thrown) {
    logFailure("preBooked", thrown);
    return { kind: "unavailable" };
  }
}

/** Everything /admin/cohorts shows. `{ ok: false }` when a core read failed or the proof isn't real. */
export async function loadCohortBoard(proof: AdminProof, admin: AdminClient, now: Date): Promise<DbResult<CohortBoard>> {
  if (!isAdminProof(proof)) return DB_FAILED;
  try {
    const [frame, places, rawWarnings] = await Promise.all([readFrame(admin, now), readShownPlaces(admin), readWarnings(admin)]);
    if (!frame.ok || !places.ok) return DB_FAILED;
    const ids = [...new Set([...places.value.map((p) => p.parentUserId), ...(rawWarnings?.refunded_but_held ?? []).map((w) => w.parent_user_id),
      ...(rawWarnings?.paid_without_place ?? []).map((w) => w.parent_user_id)])];
    const names = await readNames(admin, ids);
    if (!names.ok) return DB_FAILED;
    const entry = (slot: CohortSlot) => entryOf(slot, places.value, names.value, now);
    const { current: currentSlot, upcoming: upcomingSlots, past: pastSlots } = frame.value.slots;
    const current = currentSlot ? entry(currentSlot) : null;
    const upcoming = upcomingSlots.map(entry);
    const [calls, preBooked] = await Promise.all([readCalls(admin, now), readPreBooked(admin, upcoming[0]?.view.start ?? null)]);
    return dbOk({
      today: frame.value.today,
      suggestedFirst: nextMonday(frame.value.today),
      schedule: frame.value.record?.schedule ?? null,
      current,
      next: upcoming[0] ?? null,
      upcoming,
      past: pastSlots.map(entry),
      warnings: warningsOf(rawWarnings, names.value, [...(current ? [current] : []), ...upcoming]),
      calls,
      preBooked,
    });
  } catch (thrown) {
    logFailure("loadCohortBoard", thrown);
    return DB_FAILED;
  }
}
