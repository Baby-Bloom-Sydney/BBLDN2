/**
 * 05's repository (plan 05 §5 A7; amendment 20) — **the only module that touches the justcall_* tables.** Plan D9: 04's
 * `src/lib/calls/repo.ts` is at its size limit and gains nothing; 05 keeps its own.
 *
 * Server-only, and deliberately NOT a `"use server"` file (every async export of one becomes a remote-callable action;
 * the rule at `src/lib/invite/mint.ts:1-9`). Callers gate it: the route checks the switch and the signature first, and
 * every write takes a `VerifiedJustCallEvent` or (05a-2) an `AdminProof` upstream.
 *
 * - The ledger: one insert per delivery (a unique violation is a redelivery → `duplicate`), then its outcome. A
 *   redelivery reads its row by the key; the replay reads one row, or every `unresolved` row and every row still in
 *   flight 10 minutes after it arrived.
 * - Parents by mobile (R7): profiles with exactly that E.164 mobile, then `user_roles.role = 'parent'` only.
 * - Writes to calls and attempts go only through amendment 20's functions (`.rpc()`), which take 19's lock, refuse with
 *   a status and log `call.outcome_recorded` in the same transaction.
 * - Lists page with `.range()` and fail closed at the row cap (04's repo pattern). Every result is closed; nothing is
 *   thrown; a failure is logged with its code and message (never a number or a body).
 *
 * BB-wave2-231126/05-build, 2026-11-26.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { CallOutcomeCode, CallResultCode } from "@/lib/calls/types";
import { createAdminClient } from "@/lib/supabase/admin";
import type { MappedCall } from "./map";
import type { ParentsByMobile } from "./match";
import type { EventOutcome } from "./types";

export type RepoResult<T, E extends string = "error"> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: E };

export interface NewEventRow {
  readonly requestId: string | null;
  readonly eventType: string;
  readonly callSid: string;
  readonly justcallId: string | null;
  readonly requestTimestamp: string;
  readonly rawBody: unknown;
}

export interface StoredEvent {
  readonly id: string;
  readonly eventType: string;
  readonly callSid: string;
  readonly justcallId: string | null;
  readonly requestId: string | null;
  readonly requestTimestamp: string;
  readonly outcome: EventOutcome | null;
}

export interface RecordCallInput extends MappedCall {
  readonly parentUserId: string | null;
  readonly matchNote: "none" | "several" | null;
}
export interface RecordedCall {
  readonly entryId: string | null;
  readonly entryCreated: boolean;
  readonly matched: boolean;
}

export interface SaveOutcomeInput {
  readonly parentUserId: string;
  readonly bookingId: string | null;
  readonly callSid: string;
  readonly result: CallResultCode | null;
  readonly outcome: CallOutcomeCode | null;
  readonly note: string | null;
  readonly callBackAt: string | null;
  readonly actorUserId: string;
}
export type SaveRefusal = "invalid" | "not_yours" | "not_found" | "booked_call_exists";
export type AttachRefusal = "invalid" | "not_found" | "not_unmatched" | "not_a_parent" | "not_yours";
export type DismissRefusal = "invalid" | "not_found" | "not_unmatched";

export interface JustCallRepo {
  insertEvent(row: NewEventRow): Promise<RepoResult<{ readonly id: string }, "error" | "duplicate">>;
  finishEvent(id: string, outcome: EventOutcome, code: string | null): Promise<RepoResult<true>>;
  readEvent(id: string): Promise<RepoResult<StoredEvent | null>>;
  /** The delivery with this de-duplication key (amendment 20's unique key). */
  readEventByKey(callSid: string, eventType: string, requestTimestamp: string): Promise<RepoResult<StoredEvent | null>>;
  /** Rows `unresolved`, and rows still in flight 10 minutes after they arrived, oldest first. */
  readUnresolvedEvents(): Promise<RepoResult<readonly StoredEvent[]>>;
  readonly parentsByMobile: ParentsByMobile;
  recordCall(input: RecordCallInput): Promise<RepoResult<RecordedCall, "error" | "invalid">>;
  saveOutcome(input: SaveOutcomeInput): Promise<RepoResult<{ readonly entryId: string; readonly completed: boolean }, "error" | SaveRefusal>>;
  attachCall(callSid: string, parentUserId: string, actorUserId: string): Promise<RepoResult<{ readonly entryId: string | null; readonly entryCreated: boolean }, "error" | AttachRefusal>>;
  dismissCall(callSid: string, actorUserId: string): Promise<RepoResult<{ readonly replay: boolean }, "error" | DismissRefusal>>;
}

export type Db = () => SupabaseClient;
export interface DbReply {
  readonly data: unknown;
  readonly error: { readonly message: string; readonly code?: string } | null;
}

export const FAILED = Object.freeze({ ok: false, error: "error" } as const);
export const ok = <T>(value: T): { readonly ok: true; readonly value: T } => ({ ok: true, value });

/** Rows per request (below PostgREST's 1,000-row cap) and the most pages read before a list fails closed. */
const PAGE_ROWS = 500;
const MAX_PAGES = 40;
export const ID_CHUNK = 100;
const MAX_ERROR_CHARS = 300;
const EVENT_COLUMNS = "id, event_type, call_sid, justcall_id, request_id, request_timestamp, outcome";

export function logFailure(label: string, detail: unknown): void {
  const record = typeof detail === "object" && detail !== null ? (detail as Record<string, unknown>) : {};
  const code = typeof record.code === "string" ? record.code : undefined;
  const message = detail instanceof Error ? detail.name : typeof record.message === "string" ? record.message : typeof detail;
  console.error(`[justcall/repo] ${label} failed`, { code, message });
}

export async function guarded<R extends RepoResult<unknown, string>>(label: string, op: () => Promise<R>): Promise<R | typeof FAILED> {
  try {
    return await op();
  } catch (thrown) {
    logFailure(label, thrown);
    return FAILED;
  }
}

type Page = (from: number, to: number) => PromiseLike<DbReply>;

async function allPages(label: string, page: Page): Promise<RepoResult<readonly unknown[]>> {
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

const eventRow = z
  .object({
    id: z.string(),
    event_type: z.string(),
    call_sid: z.string(),
    justcall_id: z.string().nullable(),
    request_id: z.string().nullable(),
    request_timestamp: z.string(),
    outcome: z.enum(["applied", "ignored", "unresolved"]).nullable(),
  })
  .transform(
    (r): StoredEvent => ({
      id: r.id,
      eventType: r.event_type,
      callSid: r.call_sid,
      justcallId: r.justcall_id,
      requestId: r.request_id,
      requestTimestamp: r.request_timestamp,
      outcome: r.outcome,
    }),
  );
const userIdRows = z.array(z.object({ user_id: z.string() })).transform((rows) => rows.map((r) => r.user_id));

export function parsed<T>(label: string, schema: z.ZodType<T>, data: unknown): RepoResult<T> {
  const result = schema.safeParse(data);
  if (result.success) return ok(result.data);
  logFailure(label, { message: "unexpected row shape" });
  return FAILED;
}

const insertedRow = z.object({ id: z.string() });
/** A row still in flight this long after it arrived was dropped mid-dispatch; the replay picks it up (review code M1). */
const IN_FLIGHT_STALE_MS = 10 * 60 * 1000;

function ledgerWrites(db: Db): Pick<JustCallRepo, "insertEvent" | "finishEvent"> {
  const table = () => db().from("justcall_webhook_events");
  return {
    insertEvent: (row) =>
      guarded("insertEvent", async () => {
        const { data, error } = (await table()
          .insert({
            request_id: row.requestId,
            event_type: row.eventType,
            call_sid: row.callSid,
            justcall_id: row.justcallId,
            request_timestamp: row.requestTimestamp,
            raw_body: row.rawBody,
          })
          .select("id")
          .maybeSingle()) as DbReply;
        if (error?.code === "23505") return { ok: false, error: "duplicate" } as const;
        if (error) return (logFailure("insertEvent", error), FAILED);
        return parsed("insertEvent", insertedRow, data);
      }),
    finishEvent: (id, outcome, code) =>
      guarded("finishEvent", async () => {
        const finished = outcome === "applied" || outcome === "ignored";
        const { error } = (await table()
          .update({
            outcome,
            processed_at: finished ? new Date().toISOString() : null,
            processing_error: code === null ? null : Array.from(code).slice(0, MAX_ERROR_CHARS).join(""),
          })
          .eq("id", id)) as DbReply;
        return error ? (logFailure("finishEvent", error), FAILED) : ok(true as const);
      }),
  };
}

function ledgerReads(db: Db, now: () => Date): Pick<JustCallRepo, "readEvent" | "readEventByKey" | "readUnresolvedEvents"> {
  const table = () => db().from("justcall_webhook_events").select(EVENT_COLUMNS);
  const one = async (label: string, query: PromiseLike<DbReply>): Promise<RepoResult<StoredEvent | null>> => {
    const { data, error } = await query;
    if (error) return (logFailure(label, error), FAILED);
    return data === null ? ok(null) : parsed(label, eventRow, data);
  };
  return {
    readEvent: (id) => guarded("readEvent", () => one("readEvent", table().eq("id", id).maybeSingle())),
    readEventByKey: (callSid, eventType, requestTimestamp) =>
      guarded("readEventByKey", () =>
        one("readEventByKey", table().eq("call_sid", callSid).eq("event_type", eventType).eq("request_timestamp", requestTimestamp).maybeSingle()),
      ),
    readUnresolvedEvents: () =>
      guarded("readUnresolvedEvents", async () => {
        const staleBefore = new Date(now().getTime() - IN_FLIGHT_STALE_MS).toISOString();
        const read = await allPages("readUnresolvedEvents", (from, to) =>
          table()
            .or(`outcome.eq.unresolved,and(outcome.is.null,received_at.lt."${staleBefore}")`)
            .order("received_at", { ascending: true })
            .order("id", { ascending: true })
            .range(from, to),
        );
        return read.ok ? parsed("readUnresolvedEvents", z.array(eventRow), read.value) : read;
      }),
  };
}

function parentQueries(db: Db): Pick<JustCallRepo, "parentsByMobile"> {
  const profiles = async (e164: string) =>
    allPages("parentsByMobile", (from, to) =>
      db().from("user_profiles").select("user_id").eq("mobile_number", e164).order("user_id", { ascending: true }).range(from, to),
    );
  const parentsAmong = async (ids: readonly string[]): Promise<RepoResult<readonly unknown[]>> => {
    const collected: unknown[] = [];
    for (let i = 0; i < ids.length; i += ID_CHUNK) {
      const chunk = ids.slice(i, i + ID_CHUNK);
      const read = await allPages("parentsByMobile", (from, to) =>
        db().from("user_roles").select("user_id").in("user_id", chunk).eq("role", "parent").order("user_id", { ascending: true }).range(from, to),
      );
      if (!read.ok) return read;
      collected.push(...read.value);
    }
    return ok(collected);
  };
  return {
    parentsByMobile: async (e164) => {
      const result = await guarded("parentsByMobile", async () => {
        const read = await profiles(e164);
        const ids = read.ok ? parsed("parentsByMobile", userIdRows, read.value) : read;
        if (!ids.ok || ids.value.length === 0) return ids;
        const roles = await parentsAmong(ids.value);
        return roles.ok ? parsed("parentsByMobile", userIdRows, roles.value) : roles;
      });
      return result.ok ? { ok: true, value: result.value } : { ok: false };
    },
  };
}

const statusOnly = z.object({ status: z.string() });

async function callRpc<T, E extends string>(
  db: Db,
  fn: string,
  args: Readonly<Record<string, unknown>>,
  schema: z.ZodType<T>,
  refusals: readonly E[],
): Promise<RepoResult<T, E | "error">> {
  const refusal = z.object({ status: z.enum(refusals as [E, ...E[]]) });
  return guarded(fn, async () => {
    const { data, error } = (await db().rpc(fn, args)) as DbReply;
    if (error) return (logFailure(fn, error), FAILED);
    const refused = refusal.safeParse(data);
    if (refused.success) return { ok: false, error: refused.data.status };
    const result = schema.safeParse(data);
    if (result.success) return ok(result.data);
    const status = statusOnly.safeParse(data);
    logFailure(fn, { message: `unexpected result (status: ${status.success ? status.data.status : "none"})` });
    return FAILED;
  });
}

const uuidOrNull = z.string().nullable();
const recordReply = z
  .object({ status: z.literal("applied"), entry_id: uuidOrNull, entry_created: z.boolean(), matched: z.boolean() })
  .transform((r): RecordedCall => ({ entryId: r.entry_id, entryCreated: r.entry_created, matched: r.matched }));
const saveReply = z
  .object({ status: z.literal("recorded"), entry_id: z.string(), completed: z.boolean() })
  .transform((r) => ({ entryId: r.entry_id, completed: r.completed }));
const attachReply = z
  .object({ status: z.literal("attached"), entry_id: uuidOrNull, entry_created: z.boolean() })
  .transform((r) => ({ entryId: r.entry_id, entryCreated: r.entry_created }));
const dismissReply = z
  .object({ status: z.literal("dismissed"), replay: z.boolean().optional() })
  .transform((r) => ({ replay: r.replay === true }));

function writers(db: Db): Pick<JustCallRepo, "recordCall" | "saveOutcome" | "attachCall" | "dismissCall"> {
  return {
    recordCall: (c) =>
      callRpc(db, "justcall_record_call", {
        p_sid: c.callSid, p_justcall_id: c.justcallId, p_parent: c.parentUserId, p_match_note: c.matchNote,
        p_direction: c.direction, p_type: c.type, p_mapped_result: c.mappedResult, p_duration: c.durationSeconds,
        p_started_at: c.startedAt, p_contact: c.contactNumber, p_our_number: c.justcallNumber, p_agent: c.agentEmail,
        p_disposition: c.disposition, p_notes: c.notes,
      }, recordReply, ["invalid"] as const),
    saveOutcome: (s) =>
      callRpc(db, "justcall_save_outcome", {
        p_parent: s.parentUserId, p_booking_id: s.bookingId, p_sid: s.callSid, p_result: s.result, p_outcome: s.outcome,
        p_note: s.note, p_call_back_at: s.callBackAt, p_actor: s.actorUserId,
      }, saveReply, ["invalid", "not_yours", "not_found", "booked_call_exists"] as const),
    attachCall: (callSid, parentUserId, actorUserId) =>
      callRpc(db, "justcall_attach_call", { p_sid: callSid, p_parent: parentUserId, p_actor: actorUserId }, attachReply,
        ["invalid", "not_found", "not_unmatched", "not_a_parent", "not_yours"] as const),
    dismissCall: (callSid, actorUserId) =>
      callRpc(db, "justcall_dismiss_call", { p_sid: callSid, p_actor: actorUserId }, dismissReply,
        ["invalid", "not_found", "not_unmatched"] as const),
  };
}

export interface JustCallRepoOptions {
  /** Defaults to the service-role client, created on first use. */
  readonly client?: SupabaseClient;
  readonly now?: () => Date;
}

export function createJustCallRepo(options: JustCallRepoOptions = {}): JustCallRepo {
  let client: SupabaseClient | null = options.client ?? null;
  const db: Db = () => {
    client ??= createAdminClient();
    return client;
  };
  const now = options.now ?? (() => new Date());
  return Object.freeze({ ...ledgerWrites(db), ...ledgerReads(db, now), ...parentQueries(db), ...writers(db) });
}
