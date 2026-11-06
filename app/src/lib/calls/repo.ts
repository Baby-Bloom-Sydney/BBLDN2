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
 * - 04b adds `ReminderRepo` (the call-reminders cron's claims, plan B2 / §12 R3): plain service-role writes of the
 *   two reminder stamps and the `call_nudges` row, each guarded so only one run can claim a send.
 * - 04c-2 adds the Calendar tab's three plain writes (plan C5, §13): the settings update, a block added, a block
 *   removed — each followed by its `activity_logs` row (`call.settings_updated`, `call.block_added`,
 *   `call.block_removed`, already in amendment 19's CHECK). The `actions/admin/dfy.ts` pattern: the write stands, and
 *   a lost audit row is logged, never swallowed. Callers (`admin-calls.ts`) check the switch, the admin and the input.
 *
 * BB-wave1-041126/04a-core, 2026-11-04; BB-wave1-041126/04c2-build, 2026-11-06.
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
import { settingsFromRow, type CallSettingsUpdate } from "./settings";
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
  /** Every booked call, by start time. Every list read pages with `.range()` and fails closed at the row cap. */
  readBookedCalls(): Promise<CallsResult<readonly CallBooking[]>>;
  readBookingsForParents(parentUserIds: readonly string[]): Promise<CallsResult<readonly CallBooking[]>>;
  readLogEntriesForParents(parentUserIds: readonly string[]): Promise<CallsResult<readonly CallLogEntry[]>>;
  /** The newest entries; `limit` is clamped to 1–200. */
  readRecentLogEntries(limit: number): Promise<CallsResult<readonly CallLogEntry[]>>;
  /** Parents not from an invite (NULL source included, plan D7) who signed up at or after `enabledSince`. */
  readScopeParents(enabledSince: string): Promise<CallsResult<readonly ScopeParent[]>>;
  /** Her own parents row (04b: the hub card's scope check); null when she has none. */
  readScopeParent(userId: string): Promise<CallsResult<ScopeParent | null>>;
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
  /** The Calendar tab's settings change (never `enabled_since`): the row as stored after it. */
  updateSettings(update: CallSettingsUpdate, actor: CallActor): Promise<CallsResult<CallSettings>>;
  /** Add a block BAI can't take calls in; the block as stored. */
  insertBlock(block: NewCallBlock, actor: CallActor): Promise<CallsResult<CallBlock>>;
  /** Remove one block; `not_found` when there is none with that id (already removed). */
  deleteBlock(blockId: string, actor: CallActor): Promise<CallsResult<CallBlock>>;
}

/** A block from the Calendar tab, already checked by `admin-calls.ts` (London input parsed on the server). */
export interface NewCallBlock {
  readonly startsAt: string;
  readonly endsAt: string;
  readonly reason: string;
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
const NOT_FOUND = Object.freeze({ ok: false, error: "not_found" } as const);
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

/** Rows per request — below PostgREST's 1,000-row cap, so a full page always means "ask for the next one". */
const PAGE_ROWS = 500;
/** 40 pages = 20,000 rows: past that a read fails closed rather than loading without bound. */
const MAX_PAGES = 40;
/** Ids per `.in()` request, so no request URL grows without bound. */
const ID_CHUNK = 100;
const RECENT_LIMIT_MAX = 200;

type Page = (from: number, to: number) => PromiseLike<DbReply>;

/**
 * Every row of a query, page by page with `.range()`. A page longer than asked — e.g. exactly PostgREST's 1,000-row
 * cap, when a range was ignored — may have been cut short, so the whole read fails closed (review M1, M3).
 */
async function allPages(label: string, page: Page): Promise<CallsResult<readonly unknown[]>> {
  const collected: unknown[] = [];
  for (let n = 0; n < MAX_PAGES; n += 1) {
    const from = n * PAGE_ROWS;
    const { data, error } = await page(from, from + PAGE_ROWS - 1);
    if (error) {
      logFailure(label, error);
      return FAILED;
    }
    if (!Array.isArray(data) || data.length > PAGE_ROWS) {
      logFailure(label, { message: Array.isArray(data) ? `a page came back with ${data.length} rows` : "unexpected row shape" });
      return FAILED;
    }
    collected.push(...data);
    if (data.length < PAGE_ROWS) return ok(collected);
  }
  logFailure(label, { message: `more than ${MAX_PAGES * PAGE_ROWS} rows` });
  return FAILED;
}

/** `allPages` for an id list, at most `ID_CHUNK` ids to a request. */
async function allPagesByIds(label: string, ids: readonly string[], page: (chunk: string[]) => Page): Promise<CallsResult<readonly unknown[]>> {
  const collected: unknown[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = await allPages(label, page(ids.slice(i, i + ID_CHUNK)));
    if (!chunk.ok) return chunk;
    collected.push(...chunk.value);
  }
  return ok(collected);
}

/** Map the rows a paged read collected; a row that doesn't fit fails the read. */
function mapped<T>(label: string, read: CallsResult<readonly unknown[]>, map: (data: unknown) => T | null): CallsResult<T> {
  if (!read.ok) return read;
  const value = map(read.value);
  if (value === null) {
    logFailure(label, { message: "unexpected row shape" });
    return FAILED;
  }
  return ok(value);
}

const newestFirst = <T>(key: (row: T) => string) => (rows: readonly T[]): readonly T[] =>
  Object.freeze([...rows].sort((a, b) => key(b).localeCompare(key(a))));

const clampLimit = (limit: number): number =>
  Number.isFinite(limit) ? Math.min(RECENT_LIMIT_MAX, Math.max(1, Math.trunc(limit))) : 1;

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
  const read = async (label: string, page: Page) => mapped(label, await allPages(label, page), bookingsFromRows);
  return {
    readOccupyingBookings: (span) =>
      guarded("readOccupyingBookings", () =>
        read("readOccupyingBookings", (from, to) =>
          table().in("status", ["held", "booked"]).lt("starts_at", span.endsAt).gt("ends_at", span.startsAt).order("id", { ascending: true }).range(from, to),
        ),
      ),
    readBookingsStartingIn: (span, filter) =>
      guarded("readBookingsStartingIn", () =>
        read("readBookingsStartingIn", (from, to) => {
          const query = table().in("status", [...filter.statuses]).gte("starts_at", span.startsAt).lt("starts_at", span.endsAt);
          return (filter.purpose ? query.eq("purpose", filter.purpose) : query).order("id", { ascending: true }).range(from, to);
        }),
      ),
    readBookedCalls: () =>
      guarded("readBookedCalls", () =>
        read("readBookedCalls", (from, to) =>
          table().eq("status", "booked").order("starts_at", { ascending: true }).order("id", { ascending: true }).range(from, to),
        ),
      ),
    readBookingsForParents: (ids) =>
      guarded("readBookingsForParents", async () => {
        const collected = await allPagesByIds("readBookingsForParents", ids, (chunk) => (from, to) =>
          table().in("parent_user_id", chunk).order("id", { ascending: true }).range(from, to),
        );
        const bookings = mapped("readBookingsForParents", collected, bookingsFromRows);
        return bookings.ok ? ok(newestFirst((b: CallBooking) => b.createdAt)(bookings.value)) : bookings;
      }),
  };
}

function calendarQueries(db: Db): Pick<CallsRepo, "readSettings" | "readWeeklyHours" | "readBlocks"> {
  return {
    readSettings: () => guarded("readSettings", () => readSettings(db)),
    readWeeklyHours: () =>
      guarded("readWeeklyHours", async () =>
        mapped(
          "readWeeklyHours",
          await allPages("readWeeklyHours", (from, to) =>
            db().from("call_weekly_hours").select(HOURS_COLUMNS).order("weekday", { ascending: true }).order("start_minute", { ascending: true }).range(from, to),
          ),
          weeklyHoursFromRows,
        ),
      ),
    readBlocks: (span) =>
      guarded("readBlocks", async () =>
        mapped(
          "readBlocks",
          await allPages("readBlocks", (from, to) =>
            db().from("call_blocks").select(BLOCK_COLUMNS).lt("starts_at", span.endsAt).gt("ends_at", span.startsAt).order("id", { ascending: true }).range(from, to),
          ),
          blocksFromRows,
        ),
      ),
  };
}

function logQueries(db: Db): Pick<CallsRepo, "readLogEntriesForParents" | "readRecentLogEntries"> {
  const table = () => db().from("call_log_entries").select(ENTRY_COLUMNS);
  return {
    readLogEntriesForParents: (ids) =>
      guarded("readLogEntriesForParents", async () => {
        const collected = await allPagesByIds("readLogEntriesForParents", ids, (chunk) => (from, to) =>
          table().in("parent_user_id", chunk).order("id", { ascending: true }).range(from, to),
        );
        const entries = mapped("readLogEntriesForParents", collected, entriesFromRows);
        return entries.ok ? ok(newestFirst((e: CallLogEntry) => e.occurredAt)(entries.value)) : entries;
      }),
    readRecentLogEntries: (limit) =>
      guarded("readRecentLogEntries", () =>
        rows("readRecentLogEntries", table().order("occurred_at", { ascending: false }).limit(clampLimit(limit)), entriesFromRows),
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

/** One parents row, or none; a row that doesn't fit → undefined (`rows` fails it). */
const oneScopeParent = (data: unknown): { readonly parent: ScopeParent | null } | undefined => {
  const list = scopeParentsFromRows(data === null || data === undefined ? [] : [data]);
  return list === null ? undefined : { parent: list[0] ?? null };
};

function familyQueries(db: Db): Pick<CallsRepo, "readScopeParents" | "readScopeParent" | "readContacts" | "readLatestPositionId"> {
  return {
    readScopeParents: (enabledSince) =>
      guarded("readScopeParents", async () =>
        mapped(
          "readScopeParents",
          await allPages("readScopeParents", (from, to) =>
            db()
              .from("parents")
              .select(SCOPE_COLUMNS)
              .or(NOT_FROM_AN_INVITE)
              .gte("created_at", enabledSince)
              .order("created_at", { ascending: true })
              .order("user_id", { ascending: true })
              .range(from, to),
          ),
          scopeParentsFromRows,
        ),
      ),
    readScopeParent: (userId) =>
      guarded("readScopeParent", async () => {
        const read = await rows("readScopeParent", db().from("parents").select(SCOPE_COLUMNS).eq("user_id", userId).maybeSingle(), oneScopeParent);
        return read.ok ? ok(read.value.parent) : read;
      }),
    readContacts: (ids) =>
      guarded("readContacts", async () =>
        mapped(
          "readContacts",
          await allPagesByIds("readContacts", ids, (chunk) => (from, to) =>
            db().from("user_profiles").select(CONTACT_COLUMNS).in("user_id", chunk).order("user_id", { ascending: true }).range(from, to),
          ),
          contactsFromRows,
        ),
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

// ── The Calendar tab's writers (04c-2, plan C5, §13) ───────────────────────────────────────────────────────────

type SettingsKey = keyof CallSettingsUpdate;

const SETTINGS_COLUMN: Readonly<Record<SettingsKey, string>> = Object.freeze({
  slotMinutes: "slot_minutes",
  windowDays: "window_days",
  noticeMinutes: "notice_minutes",
  holdMinutes: "hold_minutes",
  parentReminderMinutes: "parent_reminder_minutes",
  adminReminderMinutes: "admin_reminder_minutes",
  overdueGraceMinutes: "overdue_grace_minutes",
  notBookedDelayMinutes: "not_booked_delay_minutes",
  callerNumber: "caller_number",
});

/** These settings as their columns: `{ slot_minutes: 45, … }`. */
function settingsColumns(settings: CallSettingsUpdate, keys: readonly SettingsKey[]): Readonly<Record<string, unknown>> {
  return Object.freeze(Object.fromEntries(keys.map((key) => [SETTINGS_COLUMN[key], settings[key] ?? null])));
}

/** The audit row after a Calendar write. The write stands either way; a lost row is logged (the dfy.ts pattern). */
async function audit(db: Db, label: string, actor: CallActor, actionType: string, details: Readonly<Record<string, unknown>>): Promise<void> {
  const { error } = (await db().from("activity_logs").insert({ user_id: actor.userId, action_type: actionType, action_details: details })) as DbReply;
  if (error) logFailure(`${label}(activity_logs)`, error);
}

/**
 * One update of the one row (its row lock serialises with the booking functions' `FOR UPDATE`), then
 * `call.settings_updated` with the changed columns before and after. "Before" is read just ahead of the update: one
 * admin edits these, so it is the value he saw.
 */
async function updateSettings(db: Db, update: CallSettingsUpdate, actor: CallActor): Promise<CallsResult<CallSettings>> {
  const keys = (Object.keys(SETTINGS_COLUMN) as SettingsKey[]).filter((key) => update[key] !== undefined);
  const before = await readSettings(db);
  if (!before.ok) return before;
  const after = await rows(
    "updateSettings",
    db().from("call_settings").update({ ...settingsColumns(update, keys), updated_by: actor.userId }).eq("id", 1).select(SETTINGS_COLUMNS).maybeSingle(),
    settingsFromRow,
  );
  if (!after.ok) return after;
  await audit(db, "updateSettings", actor, "call.settings_updated", { before: settingsColumns(before.value, keys), after: settingsColumns(after.value, keys) });
  return after;
}

const blockDetails = (block: CallBlock) => ({ block_id: block.id, starts_at: block.startsAt, ends_at: block.endsAt, reason: block.reason });

/** One stored block, or null if the row isn't one (`rows` fails it). */
const oneBlock = (data: unknown): CallBlock | null => blocksFromRows(data === null || data === undefined ? [] : [data])?.[0] ?? null;

async function insertBlock(db: Db, block: NewCallBlock, actor: CallActor): Promise<CallsResult<CallBlock>> {
  const added = await rows(
    "insertBlock",
    db()
      .from("call_blocks")
      .insert({ starts_at: block.startsAt, ends_at: block.endsAt, reason: block.reason, created_by: actor.userId })
      .select(BLOCK_COLUMNS)
      .single(),
    oneBlock,
  );
  if (!added.ok) return added;
  await audit(db, "insertBlock", actor, "call.block_added", blockDetails(added.value));
  return added;
}

async function deleteBlock(db: Db, blockId: string, actor: CallActor): Promise<CallsResult<CallBlock>> {
  const removed = await rows("deleteBlock", db().from("call_blocks").delete().eq("id", blockId).select(BLOCK_COLUMNS), blocksFromRows);
  if (!removed.ok) return removed;
  const block = removed.value[0];
  if (block === undefined) return NOT_FOUND;
  await audit(db, "deleteBlock", actor, "call.block_removed", blockDetails(block));
  return ok(block);
}

function calendarWriters(db: Db): Pick<CallsRepo, "updateSettings" | "insertBlock" | "deleteBlock"> {
  return {
    updateSettings: (update, actor) => guarded("updateSettings", () => updateSettings(db, update, actor)),
    insertBlock: (block, actor) => guarded("insertBlock", () => insertBlock(db, block, actor)),
    deleteBlock: (blockId, actor) => guarded("deleteBlock", () => deleteBlock(db, blockId, actor)),
  };
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
    ...calendarWriters(db),
    startCallBooking: (actor: CallActor) => guarded("startCallBooking", () => startCallBooking(db, now, actor)),
  });
}

// ── The call-reminders cron's claims (04b, plan B2 + §12 R3) ──────────────────────────────────────────────────

export type ReminderKind = "parent" | "admin";

/** `(after, until]`: the start times a reminder pass is due for. */
export interface ReminderWindow {
  readonly after: string;
  readonly until: string;
}

export interface ReminderRepo {
  /** Booked calls starting in `(after, until]` whose `kind` reminder hasn't been sent. */
  readUnremindedCalls(kind: ReminderKind, window: ReminderWindow): Promise<CallsResult<readonly CallBooking[]>>;
  /** Stamp the reminder before sending: true only if this run claimed it (still booked, same start, unstamped). */
  claimReminder(kind: ReminderKind, booking: Pick<CallBooking, "id" | "startsAt">, stamp: string): Promise<CallsResult<boolean>>;
  /** After a failed send: clear the stamp, only if it is still this run's. */
  releaseReminder(kind: ReminderKind, bookingId: string, stamp: string): Promise<CallsResult<true>>;
  /** Which of these parents already have a "pick a time" claim. */
  readNudgedParents(parentUserIds: readonly string[]): Promise<CallsResult<ReadonlySet<string>>>;
  /** Claim her one "pick a time" email: `INSERT … ON CONFLICT DO NOTHING RETURNING`; true only if this run inserted. */
  claimNudge(parentUserId: string, stamp: string): Promise<CallsResult<boolean>>;
  /** After a failed send: delete the claim, only if it is still this run's. */
  releaseNudge(parentUserId: string, stamp: string): Promise<CallsResult<true>>;
}

const STAMP_COLUMN: Readonly<Record<ReminderKind, string>> = Object.freeze({
  parent: "parent_reminder_sent_at",
  admin: "admin_reminder_sent_at",
});

/** A write that answers with its rows: did exactly one come back? */
async function claimed(label: string, query: PromiseLike<DbReply>): Promise<CallsResult<boolean>> {
  const { data, error } = await query;
  if (error) {
    logFailure(label, error);
    return FAILED;
  }
  return ok(Array.isArray(data) && data.length === 1);
}

async function written(label: string, query: PromiseLike<DbReply>): Promise<CallsResult<true>> {
  const { error } = await query;
  if (error) {
    logFailure(label, error);
    return FAILED;
  }
  return ok(true);
}

const nudgedIds = (rows: unknown): ReadonlySet<string> | null =>
  Array.isArray(rows) && rows.every((r) => typeof (r as { parent_user_id?: unknown })?.parent_user_id === "string")
    ? new Set(rows.map((r) => (r as { parent_user_id: string }).parent_user_id))
    : null;

function reminderStamps(db: Db): Pick<ReminderRepo, "readUnremindedCalls" | "claimReminder" | "releaseReminder"> {
  return {
    readUnremindedCalls: (kind, window) =>
      guarded("readUnremindedCalls", async () =>
        mapped(
          "readUnremindedCalls",
          await allPages("readUnremindedCalls", (from, to) =>
            db()
              .from("call_bookings")
              .select(BOOKING_COLUMNS)
              .eq("status", "booked")
              .gt("starts_at", window.after)
              .lte("starts_at", window.until)
              .is(STAMP_COLUMN[kind], null)
              .order("starts_at", { ascending: true })
              .order("id", { ascending: true })
              .range(from, to),
          ),
          bookingsFromRows,
        ),
      ),
    claimReminder: (kind, booking, stamp) =>
      guarded("claimReminder", () =>
        claimed(
          "claimReminder",
          db()
            .from("call_bookings")
            .update({ [STAMP_COLUMN[kind]]: stamp })
            .eq("id", booking.id)
            .eq("status", "booked")
            .eq("starts_at", booking.startsAt)
            .is(STAMP_COLUMN[kind], null)
            .select("id"),
        ),
      ),
    releaseReminder: (kind, bookingId, stamp) =>
      guarded("releaseReminder", () =>
        written(
          "releaseReminder",
          db()
            .from("call_bookings")
            .update({ [STAMP_COLUMN[kind]]: null })
            .eq("id", bookingId)
            .eq(STAMP_COLUMN[kind], stamp),
        ),
      ),
  };
}

function nudgeClaims(db: Db): Pick<ReminderRepo, "readNudgedParents" | "claimNudge" | "releaseNudge"> {
  return {
    readNudgedParents: (ids) =>
      guarded("readNudgedParents", async () => {
        if (ids.length === 0) return ok(new Set<string>());
        const collected = await allPagesByIds("readNudgedParents", ids, (chunk) => (from, to) =>
          db().from("call_nudges").select("parent_user_id").in("parent_user_id", chunk).order("parent_user_id", { ascending: true }).range(from, to),
        );
        return mapped("readNudgedParents", collected, nudgedIds);
      }),
    claimNudge: (parentUserId, stamp) =>
      guarded("claimNudge", () =>
        claimed(
          "claimNudge",
          db()
            .from("call_nudges")
            .upsert({ parent_user_id: parentUserId, not_booked_sent_at: stamp }, { onConflict: "parent_user_id", ignoreDuplicates: true })
            .select("parent_user_id"),
        ),
      ),
    releaseNudge: (parentUserId, stamp) =>
      guarded("releaseNudge", () =>
        written("releaseNudge", db().from("call_nudges").delete().eq("parent_user_id", parentUserId).eq("not_booked_sent_at", stamp)),
      ),
  };
}

export function createReminderRepo(options: CallsRepoOptions = {}): ReminderRepo {
  let client: SupabaseClient | null = options.client ?? null;
  const db: Db = () => {
    client ??= createAdminClient();
    return client;
  };
  return Object.freeze({ ...reminderStamps(db), ...nudgeClaims(db) });
}
