/**
 * The cohort readers (plan 02 §8; brief §5 "Read places left", "Find the current, next and next available").
 * Server-only, not `"use server"`. Numbers only — no family's details leave this file — so 03, 04 and the family
 * panel can call them without an admin proof. Every read is bounded (`db.ts`); a failed or malformed read fails
 * the whole answer, so a caller never shows a wrong number (brief §0.12's rule, applied to every count).
 *
 * BB-wave1-041126/02-build, 2026-11-04.
 */

import { z } from "zod";
import { cohortsEnabled } from "@/lib/features/flags";
import { londonToday } from "@/lib/timezone";
import { UPCOMING_COUNT } from "./constants";
import { isLondonDate } from "./dates";
import { allPages, allPagesByIds, dbOk, DB_FAILED, logFailure, type AdminClient, type DbResult } from "./db";
import { cohortSlots, countsOf, isOnSchedule, nextAvailable, viewOf, type CohortSlots } from "./rules";
import type { CohortPlace, CohortSchedule, CohortSlot, CohortView, CurrentCohortSummary, StoredCohort } from "./types";

const londonDate = z.string().refine(isLondonDate);
const scheduleRow = z.object({
  first_start_date: londonDate,
  repeat_weeks: z.number().int().min(1),
  default_places: z.number().int().min(0),
  created_at: z.string().min(1),
});
const storedRow = z.object({ start_date: londonDate, places: z.number().int().min(0) });
const placeRow = z.object({
  id: z.string().min(1),
  cohort_start_date: londonDate,
  parent_user_id: z.string().min(1),
  state: z.enum(["held", "hold_released", "taken", "reopened"]),
  is_goodwill: z.boolean(),
  hold_expires_at: z.string().nullable(),
  paid_by: z.enum(["card", "bank_transfer"]).nullable(),
  taken_at: z.string().nullable(),
  reopened_at: z.string().nullable(),
  reopen_reason: z.string().nullable(),
});
export const PLACE_COLUMNS = "id, cohort_start_date, parent_user_id, state, is_goodwill, hold_expires_at, paid_by, taken_at, reopened_at, reopen_reason";

export interface ScheduleRecord {
  readonly schedule: CohortSchedule;
  /** When the schedule was first saved: "paid but no place" counts deposits from here (plan §11.5). */
  readonly createdAt: string;
}

/** Map every row or fail the read: a row that doesn't fit is never silently dropped. */
function mapRows<S extends z.ZodType, T>(label: string, rows: DbResult<readonly unknown[]>, schema: S, map: (v: z.infer<S>) => T): DbResult<readonly T[]> {
  if (!rows.ok) return rows;
  const parsed = z.array(schema).safeParse(rows.value);
  if (!parsed.success) {
    logFailure(label, { code: "unexpected_row" });
    return DB_FAILED;
  }
  return dbOk(parsed.data.map(map));
}

export async function readSchedule(admin: AdminClient): Promise<DbResult<ScheduleRecord | null>> {
  const { data, error } = await admin.from("cohort_schedule").select("first_start_date, repeat_weeks, default_places, created_at").eq("id", true).maybeSingle();
  if (error) {
    logFailure("readSchedule", error);
    return DB_FAILED;
  }
  if (data === null) return dbOk(null);
  const row = scheduleRow.safeParse(data);
  if (!row.success) {
    logFailure("readSchedule", { code: "unexpected_row" });
    return DB_FAILED;
  }
  const r = row.data;
  return dbOk({ schedule: { firstStartDate: r.first_start_date, repeatWeeks: r.repeat_weeks, defaultPlaces: r.default_places }, createdAt: r.created_at });
}

export async function readStoredCohorts(admin: AdminClient): Promise<DbResult<readonly StoredCohort[]>> {
  const rows = await allPages("readStoredCohorts", (from, to) =>
    admin.from("cohorts").select("start_date, places").order("start_date", { ascending: true }).range(from, to),
  );
  return mapRows("readStoredCohorts", rows, storedRow, (r) => ({ startDate: r.start_date, places: r.places }));
}

const toPlace = (r: z.infer<typeof placeRow>): CohortPlace => ({
  id: r.id,
  cohortStartDate: r.cohort_start_date,
  parentUserId: r.parent_user_id,
  state: r.state,
  isGoodwill: r.is_goodwill,
  holdExpiresAt: r.hold_expires_at,
  paidBy: r.paid_by,
  takenAt: r.taken_at,
  reopenedAt: r.reopened_at,
  reopenReason: r.reopen_reason,
});

/** The taken places and holds of some cohorts (what the counts need). */
export async function readCountedPlaces(admin: AdminClient, starts: readonly string[]): Promise<DbResult<readonly CohortPlace[]>> {
  const rows = await allPagesByIds("readCountedPlaces", starts, (chunk) => (from, to) =>
    admin.from("cohort_places").select(PLACE_COLUMNS).in("cohort_start_date", [...chunk]).in("state", ["held", "taken"])
      .order("id", { ascending: true }).range(from, to),
  );
  return mapRows("readCountedPlaces", rows, placeRow, toPlace);
}

/** Every place except released holds (the admin board: taken, re-opened and holds). */
export async function readShownPlaces(admin: AdminClient): Promise<DbResult<readonly CohortPlace[]>> {
  const rows = await allPages("readShownPlaces", (from, to) =>
    admin.from("cohort_places").select(PLACE_COLUMNS).neq("state", "hold_released")
      .order("cohort_start_date", { ascending: true }).order("id", { ascending: true }).range(from, to),
  );
  return mapRows("readShownPlaces", rows, placeRow, toPlace);
}

export interface CohortFrame {
  readonly today: string;
  readonly record: ScheduleRecord | null;
  readonly stored: readonly StoredCohort[];
  readonly slots: CohortSlots;
}

/** The schedule, the stored rows and the merged list around London's today. */
export async function readFrame(admin: AdminClient, now: Date, count: number = UPCOMING_COUNT): Promise<DbResult<CohortFrame>> {
  const [record, stored] = await Promise.all([readSchedule(admin), readStoredCohorts(admin)]);
  if (!record.ok || !stored.ok) return DB_FAILED;
  const today = londonToday(now);
  return dbOk({ today, record: record.value, stored: stored.value, slots: cohortSlots(record.value?.schedule ?? null, stored.value, today, count) });
}

const viewFor = (slot: CohortSlot, places: readonly CohortPlace[], now: Date): CohortView =>
  viewOf(slot.startDate, slot.places, countsOf(places, slot.startDate, now));

export interface FoundCohorts {
  readonly current: CohortView | null;
  readonly next: CohortView | null;
  readonly nextAvailable: CohortView | null;
  readonly upcoming: readonly CohortView[];
}

/** Current, next and next available, with their counts (what 03's deposit page and mark-paid decide with). */
export async function findCohorts(admin: AdminClient, now: Date): Promise<DbResult<FoundCohorts>> {
  try {
    const frame = await readFrame(admin, now);
    if (!frame.ok) return frame;
    const { current, upcoming } = frame.value.slots;
    const shown = [...(current ? [current] : []), ...upcoming];
    const places = await readCountedPlaces(admin, shown.map((s) => s.startDate));
    if (!places.ok) return places;
    const upcomingViews = upcoming.map((s) => viewFor(s, places.value, now));
    return dbOk({
      current: current ? viewFor(current, places.value, now) : null,
      next: upcomingViews[0] ?? null,
      nextAvailable: nextAvailable(upcomingViews),
      upcoming: upcomingViews,
    });
  } catch (thrown) {
    logFailure("findCohorts", thrown);
    return DB_FAILED;
  }
}

/** One cohort's places left; null when the date isn't a cohort (neither stored nor on the schedule). */
export async function readPlacesLeft(admin: AdminClient, startDate: string, now: Date): Promise<DbResult<CohortView | null>> {
  if (!isLondonDate(startDate)) return dbOk(null);
  try {
    const frame = await readFrame(admin, now, 0);
    if (!frame.ok) return frame;
    const stored = frame.value.stored.find((c) => c.startDate === startDate);
    const schedule = frame.value.record?.schedule ?? null;
    if (!stored && (schedule === null || !isOnSchedule(schedule, startDate))) return dbOk(null);
    const places = await readCountedPlaces(admin, [startDate]);
    if (!places.ok) return places;
    const slot = { startDate, places: stored?.places ?? schedule?.defaultPlaces ?? 0, stored: Boolean(stored) };
    return dbOk(viewFor(slot, places.value, now));
  } catch (thrown) {
    logFailure("readPlacesLeft", thrown);
    return DB_FAILED;
  }
}

/** The current cohort for 04's call page and the family panel (plan R13). Reads nothing while the switch is off. */
export async function readCurrentCohortSummary(admin: AdminClient, now: Date): Promise<CurrentCohortSummary> {
  if (!cohortsEnabled()) return { kind: "off" };
  try {
    const frame = await readFrame(admin, now, 1);
    if (!frame.ok) return { kind: "error" };
    const { current, upcoming } = frame.value.slots;
    if (current === null) {
      return frame.value.record === null || upcoming.length === 0 ? { kind: "not_set_up" } : { kind: "first_ahead", first: upcoming[0].startDate };
    }
    const places = await readCountedPlaces(admin, [current.startDate]);
    return places.ok ? { kind: "current", view: viewFor(current, places.value, now) } : { kind: "error" };
  } catch (thrown) {
    logFailure("readCurrentCohortSummary", thrown);
    return { kind: "error" };
  }
}
