/**
 * Row and jsonb shapes for `repo.ts` (plan A6). Pure: no I/O, no client — `repo.ts` stays the only module that
 * touches the call tables.
 *
 * Every row is parsed with zod (a row that doesn't fit fails the whole read closed), and every timestamp is
 * normalised to "…Z" so callers can compare instants as strings.
 *
 * BB-wave1-041126/04a-core, 2026-11-04.
 */

import { z } from "zod";
import type {
  CallBlock,
  CallBooking,
  CallLogEntry,
  CallRefusal,
  CallsResult,
  CancelledBooking,
  ConfirmedBooking,
  HeldSlot,
  ParentContact,
  RecordedOutcome,
  ScopeParent,
} from "./types";
import { instant } from "./zod-parts";

export const SETTINGS_COLUMNS =
  "slot_minutes, window_days, notice_minutes, hold_minutes, parent_reminder_minutes, admin_reminder_minutes, " +
  "overdue_grace_minutes, not_booked_delay_minutes, caller_number, enabled_since";
export const HOURS_COLUMNS = "weekday, start_minute, end_minute";
export const BLOCK_COLUMNS = "id, starts_at, ends_at, reason";
export const BOOKING_COLUMNS =
  "id, parent_user_id, position_id, starts_at, ends_at, status, purpose, booked_by_kind, hold_expires_at, booked_at, " +
  "moved_at, moved_from_starts_at, cancelled_at, cancel_reason, closed_at, created_at";
export const ENTRY_COLUMNS =
  "id, parent_user_id, booking_id, occurred_at, recorded_by, method, source, result, outcome, note, call_back_at, justcall_call_id";
export const SCOPE_COLUMNS = "user_id, signup_source, created_at";
export const CONTACT_COLUMNS = "user_id, first_name, last_name, email, mobile_number, is_test_user";

const STATUSES = ["held", "booked", "cancelled", "done", "no_answer"] as const;
const PURPOSES = ["first_call", "cohort_prebook"] as const;
const CANCEL_REASONS = ["parent", "admin", "hold_expired", "hold_replaced"] as const;
const RESULTS = ["answered", "no_answer", "voicemail", "wrong_number"] as const;
const OUTCOMES = [
  "deposit_taken",
  "link_sent",
  "call_back_later",
  "not_going_ahead",
  "prebooked_next_cohort",
  "other",
  "stop_calling",
] as const;

const bookingRow = z
  .object({
    id: z.string(),
    parent_user_id: z.string(),
    position_id: z.string().nullable(),
    starts_at: instant,
    ends_at: instant,
    status: z.enum(STATUSES),
    purpose: z.enum(PURPOSES),
    booked_by_kind: z.enum(["parent", "admin"]),
    hold_expires_at: instant.nullable(),
    booked_at: instant.nullable(),
    moved_at: instant.nullable(),
    moved_from_starts_at: instant.nullable(),
    cancelled_at: instant.nullable(),
    cancel_reason: z.enum(CANCEL_REASONS).nullable(),
    closed_at: instant.nullable(),
    created_at: instant,
  })
  .transform(
    (r): CallBooking => ({
      id: r.id,
      parentUserId: r.parent_user_id,
      positionId: r.position_id,
      startsAt: r.starts_at,
      endsAt: r.ends_at,
      status: r.status,
      purpose: r.purpose,
      bookedByKind: r.booked_by_kind,
      holdExpiresAt: r.hold_expires_at,
      bookedAt: r.booked_at,
      movedAt: r.moved_at,
      movedFromStartsAt: r.moved_from_starts_at,
      cancelledAt: r.cancelled_at,
      cancelReason: r.cancel_reason,
      closedAt: r.closed_at,
      createdAt: r.created_at,
    }),
  );

const blockRow = z
  .object({ id: z.string(), starts_at: instant, ends_at: instant, reason: z.string() })
  .transform((r): CallBlock => ({ id: r.id, startsAt: r.starts_at, endsAt: r.ends_at, reason: r.reason }));

const entryRow = z
  .object({
    id: z.string(),
    parent_user_id: z.string(),
    booking_id: z.string().nullable(),
    occurred_at: instant,
    recorded_by: z.string().nullable(),
    method: z.enum(["phone", "justcall", "other"]),
    source: z.enum(["manual", "justcall"]),
    result: z.enum(RESULTS).nullable(),
    outcome: z.enum(OUTCOMES).nullable(),
    note: z.string().nullable(),
    call_back_at: instant.nullable(),
    justcall_call_id: z.string().nullable(),
  })
  .transform(
    (r): CallLogEntry => ({
      id: r.id,
      parentUserId: r.parent_user_id,
      bookingId: r.booking_id,
      occurredAt: r.occurred_at,
      recordedBy: r.recorded_by,
      method: r.method,
      source: r.source,
      result: r.result,
      outcome: r.outcome,
      note: r.note,
      callBackAt: r.call_back_at,
      justcallCallId: r.justcall_call_id,
    }),
  );

const scopeRow = z
  .object({ user_id: z.string(), signup_source: z.string().nullable(), created_at: instant })
  .transform((r): ScopeParent => ({ userId: r.user_id, signupSource: r.signup_source, signedUpAt: r.created_at }));

const contactRow = z
  .object({
    user_id: z.string(),
    first_name: z.string(),
    last_name: z.string(),
    email: z.string(),
    mobile_number: z.string().nullable(),
    is_test_user: z.boolean(),
  })
  .transform(
    (r): ParentContact => ({
      userId: r.user_id,
      firstName: r.first_name,
      lastName: r.last_name,
      email: r.email,
      mobile: r.mobile_number,
      isTestUser: r.is_test_user,
    }),
  );

const idRow = z.object({ id: z.string() });

/** Rows → a frozen list, or null when any row doesn't fit (the read then fails closed). */
function listOf<T>(schema: z.ZodType<T>): (rows: unknown) => readonly T[] | null {
  return (rows) => {
    const parsed = z.array(schema).safeParse(rows ?? []);
    return parsed.success ? Object.freeze(parsed.data) : null;
  };
}

export const bookingsFromRows = listOf(bookingRow);
export const blocksFromRows = listOf(blockRow);
export const entriesFromRows = listOf(entryRow);
export const scopeParentsFromRows = listOf(scopeRow);
export const contactsFromRows = listOf(contactRow);

/** `{ id }` or no row → the id or null; anything else → undefined (unexpected). */
export function idFromRow(row: unknown): string | null | undefined {
  if (row === null || row === undefined) return null;
  const parsed = idRow.safeParse(row);
  return parsed.success ? parsed.data.id : undefined;
}

// ── the writers' jsonb results ──

const REFUSALS: ReadonlySet<string> = new Set<CallRefusal>([
  "taken",
  "too_soon",
  "hold_expired",
  "not_yours",
  "not_found",
  "rate_limited",
  "invalid",
  "overlap",
  "booked_call_exists",
]);

export const heldResult = z
  .object({ status: z.literal("held"), booking_id: z.string(), hold_expires_at: instant })
  .transform((r): HeldSlot => ({ bookingId: r.booking_id, holdExpiresAt: r.hold_expires_at }));

export const confirmedResult = z
  .discriminatedUnion("status", [
    z.object({ status: z.literal("booked"), booking_id: z.string(), starts_at: instant, replay: z.boolean().optional() }),
    z.object({ status: z.literal("moved"), booking_id: z.string(), starts_at: instant, from: instant }),
  ])
  .transform(
    (r): ConfirmedBooking =>
      r.status === "moved"
        ? { kind: "moved", bookingId: r.booking_id, startsAt: r.starts_at, fromStartsAt: r.from }
        : { kind: "booked", bookingId: r.booking_id, startsAt: r.starts_at, replay: r.replay === true },
  );

export const cancelledResult = z
  .object({ status: z.literal("cancelled"), booking_id: z.string(), starts_at: instant })
  .transform((r): CancelledBooking => ({ bookingId: r.booking_id, startsAt: r.starts_at }));

export const recordedResult = z
  .object({ status: z.literal("recorded"), entry_id: z.string(), replay: z.boolean().optional() })
  .transform((r): RecordedOutcome => ({ entryId: r.entry_id, replay: r.replay === true }));

export const replacedResult = z.object({ status: z.literal("replaced") }).transform((): true => true);

/**
 * A writer's jsonb → its value, or one of the closed refusal codes. Null means the result was not one this
 * function returns (a different ok status, a missing field, a non-object): the caller logs it and answers `error`.
 */
export function parseRpcResult<T>(data: unknown, schema: z.ZodType<T>): CallsResult<T> | null {
  if (typeof data !== "object" || data === null) return null;
  const status = (data as { readonly status?: unknown }).status;
  if (typeof status !== "string") return null;
  if (REFUSALS.has(status)) return { ok: false, error: status as CallRefusal };
  const parsed = schema.safeParse(data);
  return parsed.success ? { ok: true, value: parsed.data } : null;
}

/** For a log line: the status a writer returned, never the rest of its payload. */
export function statusOf(data: unknown): string {
  if (typeof data !== "object" || data === null) return typeof data;
  const status = (data as { readonly status?: unknown }).status;
  return typeof status === "string" ? status : "no status";
}
