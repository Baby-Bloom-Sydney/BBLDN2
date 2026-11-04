/**
 * The call repository (plan A6; brief §5; amendment 19) — **the only module that touches the call_* tables.**
 *
 * Server-only, and deliberately NOT a `"use server"` file: every async export of one becomes a remote-callable
 * action, and this module writes any parent's row with the service role (rule at `src/lib/invite/mint.ts:1-9`).
 * Callers gate it: `booking.ts`, `to-call.ts`, `counts.ts` and `who-next.ts` check `callBookingEnabled()` first.
 *
 * - Writes go only through amendment 19's functions (`.rpc()`), which lock, sweep run-out holds, enforce
 *   ownership, notice and the rate limit, and log `activity_logs` in the same transaction. The one plain write is
 *   Start call booking, which sets `enabled_since` once (`WHERE enabled_since IS NULL`; plan §12 R11). No read
 *   ever writes.
 * - Every result is a closed `CallsResult`: refusal codes from the functions, or `error` for anything else.
 *   Nothing is thrown to callers; failures are logged here with a code and message (never contact details).
 *
 * BB-wave1-041126/04a-core, 2026-11-04.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { weeklyHoursFromRows } from "./hours";
import {
  BLOCK_COLUMNS,
  BOOKING_COLUMNS,
  CONTACT_COLUMNS,
  ENTRY_COLUMNS,
  HOURS_COLUMNS,
  SCOPE_COLUMNS,
  SETTINGS_COLUMNS,
  blocksFromRows,
  bookingsFromRows,
  cancelledResult,
  confirmedResult,
  contactsFromRows,
  entriesFromRows,
  heldResult,
  idFromRow,
  parseRpcResult,
  recordedResult,
  replacedResult,
  scopeParentsFromRows,
  statusOf,
} from "./repo-map";
import { settingsFromRow } from "./settings";
import type {
  BookInput,
  BookingStatus,
  CallActor,
  CallBlock,
  CallBooking,
  CallLogEntry,
  CallPurpose,
  CallSettings,
  CallsResult,
  CancelInput,
  CancelledBooking,
  ConfirmInput,
  ConfirmedBooking,
  HeldSlot,
  HoldInput,
  OutcomeInput,
  ParentContact,
  RecordedOutcome,
  ScopeParent,
  StartedCallBooking,
  TimeSpan,
  WeeklyHoursRange,
} from "./types";

export interface CallsRepo {
  readSettings(): Promise<CallsResult<CallSettings>>;
  readWeeklyHours(): Promise<CallsResult<readonly WeeklyHoursRange[]>>;
  /** Blocks overlapping the span. */
  readBlocks(span: TimeSpan): Promise<CallsResult<readonly CallBlock[]>>;
  /** Held or booked rows overlapping the span (run-out holds included: `occupiesSlot` decides). */
  readOccupyingBookings(span: TimeSpan): Promise<CallsResult<readonly CallBooking[]>>;
  /** Rows in these statuses starting in `[span.startsAt, span.endsAt)`. */
  readBookingsStartingIn(
    span: TimeSpan,
    filter: { readonly statuses: readonly BookingStatus[]; readonly purpose?: CallPurpose },
  ): Promise<CallsResult<readonly CallBooking[]>>;
  /** Every booked call, by start time. */
  readBookedCalls(): Promise<CallsResult<readonly CallBooking[]>>;
  readBookingsForParents(parentUserIds: readonly string[]): Promise<CallsResult<readonly CallBooking[]>>;
  readLogEntriesForParents(parentUserIds: readonly string[]): Promise<CallsResult<readonly CallLogEntry[]>>;
  readRecentLogEntries(limit: number): Promise<CallsResult<readonly CallLogEntry[]>>;
  /** Parents not from an invite (NULL source included, plan D7) who signed up at or after `enabledSince`. */
  readScopeParents(enabledSince: string): Promise<CallsResult<readonly ScopeParent[]>>;
  readContacts(userIds: readonly string[]): Promise<CallsResult<readonly ParentContact[]>>;
  readLatestPositionId(parentUserId: string): Promise<CallsResult<string | null>>;
  holdSlot(input: HoldInput): Promise<CallsResult<HeldSlot>>;
  confirmHold(input: ConfirmInput): Promise<CallsResult<ConfirmedBooking>>;
  bookSlot(input: BookInput): Promise<CallsResult<ConfirmedBooking>>;
  cancelBooking(input: CancelInput): Promise<CallsResult<CancelledBooking>>;
  recordOutcome(input: OutcomeInput): Promise<CallsResult<RecordedOutcome>>;
  replaceWeeklyHours(hours: readonly WeeklyHoursRange[], actor: CallActor): Promise<CallsResult<true>>;
  /** Brief 14's "Start call booking": sets `enabled_since` once; later presses keep the first time. */
  startCallBooking(actor: CallActor): Promise<CallsResult<StartedCallBooking>>;
}

export interface CallsRepoOptions {
  /** Defaults to the service-role client, created on first use. */
  readonly client?: SupabaseClient;
  readonly now?: () => Date;
}

type Db = () => SupabaseClient;
interface DbReply {
  readonly data: unknown;
  readonly error: { readonly message: string; readonly code?: string } | null;
}

const FAILED = Object.freeze({ ok: false, error: "error" } as const);
const ok = <T>(value: T): CallsResult<T> => ({ ok: true, value });

/** The scope filter (plan D7): `NOT IN` alone would drop the NULL rows. */
const NOT_FROM_AN_INVITE = "signup_source.is.null,signup_source.not.in.(nanny_invite,parent_invite)";

function logFailure(label: string, detail: unknown): void {
  const record = typeof detail === "object" && detail !== null ? (detail as Record<string, unknown>) : {};
  const code = typeof record.code === "string" ? record.code : undefined;
  const message = detail instanceof Error ? detail.message : typeof record.message === "string" ? record.message : String(detail);
  console.error(`[calls/repo] ${label} failed`, { code, message });
}

async function guarded<T>(label: string, op: () => Promise<CallsResult<T>>): Promise<CallsResult<T>> {
  try {
    return await op();
  } catch (thrown) {
    logFailure(label, thrown);
    return FAILED;
  }
}

/** Await a query and map its rows; a PostgREST error or a row that doesn't fit → `error`, logged. */
async function rows<T>(label: string, query: PromiseLike<DbReply>, map: (data: unknown) => T | null | undefined): Promise<CallsResult<T>> {
  const { data, error } = await query;
  if (error) {
    logFailure(label, error);
    return FAILED;
  }
  const value = map(data);
  if (value === null || value === undefined) {
    logFailure(label, { message: "unexpected row shape" });
    return FAILED;
  }
  return ok(value);
}

async function rpc<T>(db: Db, fn: string, args: Readonly<Record<string, unknown>>, schema: z.ZodType<T>): Promise<CallsResult<T>> {
  const { data, error } = (await db().rpc(fn, args)) as DbReply;
  if (error) {
    logFailure(fn, error);
    return FAILED;
  }
  const result = parseRpcResult(data, schema);
  if (result === null) {
    logFailure(fn, { message: `unexpected result (status: ${statusOf(data)})` });
    return FAILED;
  }
  return result;
}

function readSettings(db: Db): Promise<CallsResult<CallSettings>> {
  return rows("readSettings", db().from("call_settings").select(SETTINGS_COLUMNS).eq("id", 1).maybeSingle(), settingsFromRow);
}

function bookingQueries(db: Db): Pick<
  CallsRepo,
  "readOccupyingBookings" | "readBookingsStartingIn" | "readBookedCalls" | "readBookingsForParents"
> {
  const table = () => db().from("call_bookings").select(BOOKING_COLUMNS);
  return {
    readOccupyingBookings: (span) =>
      guarded("readOccupyingBookings", () =>
        rows(
          "readOccupyingBookings",
          table().in("status", ["held", "booked"]).lt("starts_at", span.endsAt).gt("ends_at", span.startsAt),
          bookingsFromRows,
        ),
      ),
    readBookingsStartingIn: (span, filter) =>
      guarded("readBookingsStartingIn", () => {
        const query = table().in("status", [...filter.statuses]).gte("starts_at", span.startsAt).lt("starts_at", span.endsAt);
        return rows("readBookingsStartingIn", filter.purpose ? query.eq("purpose", filter.purpose) : query, bookingsFromRows);
      }),
    readBookedCalls: () =>
      guarded("readBookedCalls", () =>
        rows("readBookedCalls", table().eq("status", "booked").order("starts_at", { ascending: true }), bookingsFromRows),
      ),
    readBookingsForParents: (ids) =>
      ids.length === 0
        ? Promise.resolve(ok([]))
        : guarded("readBookingsForParents", () =>
            rows(
              "readBookingsForParents",
              table().in("parent_user_id", [...ids]).order("created_at", { ascending: false }),
              bookingsFromRows,
            ),
          ),
  };
}

function calendarQueries(db: Db): Pick<CallsRepo, "readSettings" | "readWeeklyHours" | "readBlocks"> {
  return {
    readSettings: () => guarded("readSettings", () => readSettings(db)),
    readWeeklyHours: () =>
      guarded("readWeeklyHours", () =>
        rows("readWeeklyHours", db().from("call_weekly_hours").select(HOURS_COLUMNS).order("weekday", { ascending: true }), (data) =>
          weeklyHoursFromRows(data ?? []),
        ),
      ),
    readBlocks: (span) =>
      guarded("readBlocks", () =>
        rows(
          "readBlocks",
          db()
            .from("call_blocks")
            .select(BLOCK_COLUMNS)
            .lt("starts_at", span.endsAt)
            .gt("ends_at", span.startsAt)
            .order("starts_at", { ascending: true }),
          blocksFromRows,
        ),
      ),
  };
}

function logQueries(db: Db): Pick<CallsRepo, "readLogEntriesForParents" | "readRecentLogEntries"> {
  const table = () => db().from("call_log_entries").select(ENTRY_COLUMNS);
  return {
    readLogEntriesForParents: (ids) =>
      ids.length === 0
        ? Promise.resolve(ok([]))
        : guarded("readLogEntriesForParents", () =>
            rows(
              "readLogEntriesForParents",
              table().in("parent_user_id", [...ids]).order("occurred_at", { ascending: false }),
              entriesFromRows,
            ),
          ),
    readRecentLogEntries: (limit) =>
      guarded("readRecentLogEntries", () =>
        rows("readRecentLogEntries", table().order("occurred_at", { ascending: false }).limit(limit), entriesFromRows),
      ),
  };
}

/** `{ id }` for a row with an id, `{ id: null }` for no row, undefined for anything else (`rows` fails it). */
const optionalId = (data: unknown): { readonly id: string | null } | undefined => {
  const id = idFromRow(data);
  return id === undefined ? undefined : { id };
};

async function latestPositionId(db: Db, parentUserId: string): Promise<CallsResult<string | null>> {
  const parent = await rows("readLatestPositionId", db().from("parents").select("id").eq("user_id", parentUserId).maybeSingle(), optionalId);
  if (!parent.ok) return parent;
  if (parent.value.id === null) return ok(null);
  const position = await rows(
    "readLatestPositionId",
    db().from("nanny_positions").select("id").eq("parent_id", parent.value.id).order("created_at", { ascending: false }).limit(1).maybeSingle(),
    optionalId,
  );
  return position.ok ? ok(position.value.id) : position;
}

function familyQueries(db: Db): Pick<CallsRepo, "readScopeParents" | "readContacts" | "readLatestPositionId"> {
  return {
    readScopeParents: (enabledSince) =>
      guarded("readScopeParents", () =>
        rows(
          "readScopeParents",
          db()
            .from("parents")
            .select(SCOPE_COLUMNS)
            .or(NOT_FROM_AN_INVITE)
            .gte("created_at", enabledSince)
            .order("created_at", { ascending: true }),
          scopeParentsFromRows,
        ),
      ),
    readContacts: (ids) =>
      ids.length === 0
        ? Promise.resolve(ok([]))
        : guarded("readContacts", () =>
            rows("readContacts", db().from("user_profiles").select(CONTACT_COLUMNS).in("user_id", [...ids]), contactsFromRows),
          ),
    readLatestPositionId: (parentUserId) => guarded("readLatestPositionId", () => latestPositionId(db, parentUserId)),
  };
}

type Call = <T>(fn: string, args: Readonly<Record<string, unknown>>, schema: z.ZodType<T>) => Promise<CallsResult<T>>;

const caller = (db: Db): Call => (fn, args, schema) => guarded(fn, () => rpc(db, fn, args, schema));

function bookingWriters(call: Call): Pick<CallsRepo, "holdSlot" | "confirmHold" | "bookSlot" | "cancelBooking"> {
  return {
    holdSlot: (i) =>
      call(
        "call_hold_slot",
        { p_parent: i.parentUserId, p_starts: i.startsAt, p_ends: i.endsAt, p_purpose: i.purpose, p_position: i.positionId, p_actor: i.actor.userId, p_actor_kind: i.actor.kind },
        heldResult,
      ),
    confirmHold: (i) =>
      call(
        "call_confirm_hold",
        { p_parent: i.parentUserId, p_hold_id: i.holdId, p_idempotency_key: i.idempotencyKey, p_actor: i.actor.userId, p_actor_kind: i.actor.kind },
        confirmedResult,
      ),
    bookSlot: (i) =>
      call(
        "call_book_slot",
        {
          p_parent: i.parentUserId,
          p_starts: i.startsAt,
          p_ends: i.endsAt,
          p_purpose: i.purpose,
          p_position: i.positionId,
          p_idempotency_key: i.idempotencyKey,
          p_actor: i.actor.userId,
          p_actor_kind: i.actor.kind,
        },
        confirmedResult,
      ),
    cancelBooking: (i) =>
      call("call_cancel_booking", { p_parent: i.parentUserId, p_booking_id: i.bookingId, p_actor: i.actor.userId, p_actor_kind: i.actor.kind }, cancelledResult),
  };
}

function logAndHoursWriters(call: Call): Pick<CallsRepo, "recordOutcome" | "replaceWeeklyHours"> {
  return {
    recordOutcome: (i) =>
      call(
        "call_record_outcome",
        {
          p_parent: i.parentUserId,
          p_booking_id: i.bookingId,
          p_result: i.result,
          p_outcome: i.outcome,
          p_note: i.note,
          p_call_back_at: i.callBackAt,
          p_method: i.method,
          p_source: i.source,
          p_actor: i.actor.userId,
          p_justcall_call_id: i.justcallCallId,
        },
        recordedResult,
      ),
    replaceWeeklyHours: (hours, actor) =>
      call(
        "call_replace_weekly_hours",
        { p_hours: hours.map((h) => ({ weekday: h.weekday, start_minute: h.startMinute, end_minute: h.endMinute })), p_actor: actor.userId },
        replacedResult,
      ),
  };
}

async function startCallBooking(db: Db, now: () => Date, actor: CallActor): Promise<CallsResult<StartedCallBooking>> {
  const before = await readSettings(db);
  if (!before.ok) return before;
  if (before.value.enabledSince !== null) return ok({ enabledSince: before.value.enabledSince, startedNow: false });
  const stamp = now().toISOString();
  const { error } = (await db()
    .from("call_settings")
    .update({ enabled_since: stamp, updated_by: actor.userId })
    .eq("id", 1)
    .is("enabled_since", null)) as DbReply;
  if (error) {
    logFailure("startCallBooking", error);
    return FAILED;
  }
  const after = await readSettings(db);
  if (!after.ok) return after;
  if (after.value.enabledSince === null) {
    logFailure("startCallBooking", { message: "enabled_since still empty after the update" });
    return FAILED;
  }
  const startedNow = after.value.enabledSince === stamp;
  if (startedNow) await logStarted(db, actor, stamp);
  return ok({ enabledSince: after.value.enabledSince, startedNow });
}

async function logStarted(db: Db, actor: CallActor, stamp: string): Promise<void> {
  const { error } = (await db()
    .from("activity_logs")
    .insert({
      user_id: actor.userId,
      action_type: "call.settings_updated",
      action_details: { enabled_since: stamp, started_call_booking: true },
    })) as DbReply;
  if (error) logFailure("startCallBooking(activity_logs)", error);
}

export function createCallsRepo(options: CallsRepoOptions = {}): CallsRepo {
  let client: SupabaseClient | null = options.client ?? null;
  const db: Db = () => {
    client ??= createAdminClient();
    return client;
  };
  const now = options.now ?? (() => new Date());
  return Object.freeze({
    ...calendarQueries(db),
    ...bookingQueries(db),
    ...logQueries(db),
    ...familyQueries(db),
    ...bookingWriters(caller(db)),
    ...logAndHoursWriters(caller(db)),
    startCallBooking: (actor: CallActor) => guarded("startCallBooking", () => startCallBooking(db, now, actor)),
  });
}
