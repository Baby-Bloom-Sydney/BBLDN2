/**
 * Pre-booking the next available cohort (plan 03 §3 "Pre-book", §8 Seams, D9; brief 03 §3 parent 5; amendment 18,
 * `deposit_prebookings`). Server-only, deliberately NOT `"use server"` (`src/lib/invite/mint.ts:1-9`); no session is
 * read here — the family comes only from her `DepositParentProof`.
 *
 * - `recordPrebooking`: one open pre-booking per family (the unique index). A second press hits 23505 and gets the
 *   open one back: no second row, no second `deposit.prebooked` history row. No place is held (02 Q6).
 * - `attachPrebookingCall`: 04's booking id on HER open pre-booking only.
 * - `countOpenPrebookings`: 02's "N pre-booked calls" for one cohort. Null = couldn't be read, never a stand-in 0.
 * - `readPendingPrebookRequests`: 04's to-call list and drawer. Pending only while open, with no booking and no
 *   call logged after it was made (D9). A failed read THROWS: 04's `to-call.ts` turns a throw into its error path.
 *
 * Every read is bounded (`cohorts/db.ts`: 100 ids per `.in()`, paged). Failures are logged by code only — never a
 * message, an id list or a name.
 *
 * BB-wave2-231126/03-build, 2026-11-25.
 */

import { z } from "zod";
import { instant, uuid } from "@/lib/calls/zod-parts";
import { isLondonDate } from "@/lib/cohorts/dates";
import { allPagesByIds, logFailure, type AdminClient, type DbResult } from "@/lib/cohorts/db";
import { londonDateOf } from "@/lib/timezone";
import { isDepositParentProof, type DepositParentProof } from "./proof";

/** One open pre-booking, as the app reads it. `cohortStartDate` null = no next cohort was set up when she asked. */
export interface Prebooking {
  readonly id: string;
  readonly parentUserId: string;
  readonly cohortStartDate: string | null;
  readonly callBookingId: string | null;
  readonly createdAt: string;
}

export type RecordPrebookingResult =
  | { readonly ok: true; readonly prebooking: Prebooking; readonly created: boolean }
  | { readonly ok: false; readonly status: "invalid" | "error" };

export type AttachPrebookingCallResult =
  | { readonly ok: true }
  | { readonly ok: false; readonly status: "invalid" | "not_found" | "error" };

/** What 04 reads for a family with a pending request (structurally 04's `PrebookRequest`). */
export interface PendingPrebookRequest {
  /** The cohort's start date, or — when none was set up — the London date she pre-booked. */
  readonly londonDate: string;
}

const INVALID = Object.freeze({ ok: false, status: "invalid" } as const);
const ERROR = Object.freeze({ ok: false, status: "error" } as const);
const NOT_FOUND = Object.freeze({ ok: false, status: "not_found" } as const);
const ATTACHED = Object.freeze({ ok: true } as const);
const UNIQUE_VIOLATION = "23505";
const PREBOOKING_COLUMNS = "id, parent_user_id, cohort_start_date, call_booking_id, created_at";
const READ_FAILED = "[deposit] pending pre-book requests could not be read";

const cohortDate = z.string().refine(isLondonDate);
const prebookingRow = z.object({
  id: uuid,
  parent_user_id: uuid,
  cohort_start_date: cohortDate.nullable(),
  call_booking_id: uuid.nullable(),
  created_at: instant,
});
const pendingRow = prebookingRow.pick({ parent_user_id: true, cohort_start_date: true, created_at: true });
const entryRow = z.object({ parent_user_id: uuid, occurred_at: instant });

/** The row as a frozen `Prebooking`, only when it is hers and fits; anything else is logged and refused. */
function prebookingOf(data: unknown, parentUserId: string, label: string): Prebooking | null {
  const parsed = prebookingRow.safeParse(data);
  if (!parsed.success || parsed.data.parent_user_id !== parentUserId) {
    logFailure(label, { code: "unexpected_row" });
    return null;
  }
  const r = parsed.data;
  return Object.freeze({ id: r.id, parentUserId: r.parent_user_id, cohortStartDate: r.cohort_start_date, callBookingId: r.call_booking_id, createdAt: r.created_at });
}

const recorded = (prebooking: Prebooking, created: boolean): RecordPrebookingResult => Object.freeze({ ok: true, prebooking, created });

/** The history row for a new pre-booking. The pre-booking already stands, so a failure is reported, not thrown. */
async function logPrebooked(admin: AdminClient, prebooking: Prebooking): Promise<void> {
  const { error } = await admin.from("activity_logs").insert({
    user_id: prebooking.parentUserId,
    action_type: "deposit.prebooked",
    action_details: { prebooking_id: prebooking.id, cohort_start_date: prebooking.cohortStartDate },
  });
  if (error) logFailure("deposit.prebooked activity", error);
}

/** Her open pre-booking, after the unique index refused a second one. */
async function rereadOpen(admin: AdminClient, parentUserId: string): Promise<RecordPrebookingResult> {
  const { data, error } = await admin.from("deposit_prebookings").select(PREBOOKING_COLUMNS)
    .eq("parent_user_id", parentUserId).eq("state", "open").maybeSingle();
  if (error || data === null) {
    logFailure("deposit.prebook.reread", error ?? { code: "not_found" });
    return ERROR;
  }
  const prebooking = prebookingOf(data, parentUserId, "deposit.prebook.reread");
  return prebooking ? recorded(prebooking, false) : ERROR;
}

/** Record "Pre-book next available cohort" for the family her proof names (one open per family). */
export async function recordPrebooking(
  admin: AdminClient,
  proof: DepositParentProof,
  cohortStartDate: string | null,
): Promise<RecordPrebookingResult> {
  if (!isDepositParentProof(proof)) return INVALID;
  if (cohortStartDate !== null && !isLondonDate(cohortStartDate)) return INVALID;
  const parentUserId = proof.parentUserId;
  try {
    const { data, error } = await admin.from("deposit_prebookings")
      .insert({ parent_user_id: parentUserId, cohort_start_date: cohortStartDate }).select(PREBOOKING_COLUMNS).single();
    if (error?.code === UNIQUE_VIOLATION) return await rereadOpen(admin, parentUserId);
    if (error) {
      logFailure("deposit.prebook.insert", error);
      return ERROR;
    }
    const prebooking = prebookingOf(data, parentUserId, "deposit.prebook.insert");
    if (prebooking === null) return ERROR;
    await logPrebooked(admin, prebooking);
    return recorded(prebooking, true);
  } catch (thrown) {
    logFailure("deposit.prebook", thrown);
    return ERROR;
  }
}

const attachInput = z.object({ prebookingId: uuid, callBookingId: uuid });

/** Store 04's booking id on her open pre-booking. Another family's, or a converted one, matches nothing. */
export async function attachPrebookingCall(
  admin: AdminClient,
  proof: DepositParentProof,
  ids: { readonly prebookingId: string; readonly callBookingId: string },
): Promise<AttachPrebookingCallResult> {
  if (!isDepositParentProof(proof)) return INVALID;
  const input = attachInput.safeParse(ids);
  if (!input.success) return INVALID;
  try {
    const { data, error } = await admin.from("deposit_prebookings").update({ call_booking_id: input.data.callBookingId })
      .eq("id", input.data.prebookingId).eq("parent_user_id", proof.parentUserId).eq("state", "open").select("id");
    if (error || !Array.isArray(data)) {
      logFailure("deposit.prebook.attach", error ?? { code: "unexpected_reply" });
      return ERROR;
    }
    return data.length === 0 ? NOT_FOUND : ATTACHED;
  } catch (thrown) {
    logFailure("deposit.prebook.attach", thrown);
    return ERROR;
  }
}

/** Open pre-bookings for one cohort (its London start date). Null = couldn't be read — never a stand-in 0. */
export async function countOpenPrebookings(admin: AdminClient, cohortStartDate: string): Promise<number | null> {
  if (!isLondonDate(cohortStartDate)) return null;
  try {
    const { count, error } = await admin.from("deposit_prebookings").select("id", { count: "exact", head: true })
      .eq("cohort_start_date", cohortStartDate).eq("state", "open");
    if (error || typeof count !== "number" || !Number.isInteger(count) || count < 0) {
      logFailure("deposit.prebook.count", error ?? { code: "no_count" });
      return null;
    }
    return count;
  } catch (thrown) {
    logFailure("deposit.prebook.count", thrown);
    return null;
  }
}

/** Every row of a bounded read, parsed; anything else throws (04's error path). */
function rowsOrThrow<S extends z.ZodType>(rows: DbResult<readonly unknown[]>, schema: S, label: string): readonly z.infer<S>[] {
  if (!rows.ok) throw new Error(READ_FAILED);
  const parsed = z.array(schema).safeParse(rows.value);
  if (!parsed.success) {
    logFailure(label, { code: "unexpected_row" });
    throw new Error(READ_FAILED);
  }
  return parsed.data;
}

type PendingRow = z.infer<typeof pendingRow>;

/** The families (of these) with a call logged after their pre-booking was made. */
async function calledAfter(admin: AdminClient, prebookings: readonly PendingRow[]): Promise<ReadonlySet<string>> {
  const since = prebookings.map((p) => p.created_at).reduce((a, b) => (b < a ? b : a));
  const rows = await allPagesByIds("deposit.prebook.calls", prebookings.map((p) => p.parent_user_id), (chunk) => (from, to) =>
    admin.from("call_log_entries").select("parent_user_id, occurred_at").in("parent_user_id", [...chunk])
      .gt("occurred_at", since).order("id", { ascending: true }).range(from, to),
  );
  const entries = rowsOrThrow(rows, entryRow, "deposit.prebook.calls");
  const madeAt = new Map(prebookings.map((p) => [p.parent_user_id, p.created_at]));
  return new Set(entries.filter((e) => e.occurred_at > (madeAt.get(e.parent_user_id) ?? e.occurred_at)).map((e) => e.parent_user_id));
}

/** 04's pending pre-book requests for these families (D9). Throws when they can't be read. */
export async function readPendingPrebookRequests(
  admin: AdminClient,
  parentUserIds: readonly string[],
): Promise<ReadonlyMap<string, PendingPrebookRequest>> {
  if (parentUserIds.length === 0) return new Map();
  const rows = await allPagesByIds("deposit.prebook.pending", parentUserIds, (chunk) => (from, to) =>
    admin.from("deposit_prebookings").select("parent_user_id, cohort_start_date, created_at").in("parent_user_id", [...chunk])
      .eq("state", "open").is("call_booking_id", null).order("id", { ascending: true }).range(from, to),
  );
  const prebookings = rowsOrThrow(rows, pendingRow, "deposit.prebook.pending");
  if (prebookings.length === 0) return new Map();
  const called = await calledAfter(admin, prebookings);
  return new Map(
    prebookings
      .filter((p) => !called.has(p.parent_user_id))
      .map((p) => [p.parent_user_id, Object.freeze({ londonDate: p.cohort_start_date ?? londonDateOf(p.created_at) })] as const),
  );
}
