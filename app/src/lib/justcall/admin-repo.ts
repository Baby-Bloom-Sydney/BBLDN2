/**
 * The reads 05a-2's admin needs (plan 05 §5 B2; B2's named alternative to growing 05a-1's `repo.ts`). Server-only,
 * not `"use server"`; `admin.ts` checks the switch and the `AdminProof` before calling any of these.
 *
 * - `readUnmatched(limit)`: calls with no parent, not dismissed, with a result (D7's missed and voicemail calls are
 *   shown nowhere, plan §14), newest first, at most `limit`, with the full count. A sid that already has an entry in
 *   `call_log_entries` is left out (04's writer can take a JustCall id without touching `justcall_calls`; 05a-1 §5).
 * - `readDetails(sids)`: each call's details, 100 sids to a request.
 * - `searchParents(query)`: profiles by exact E.164 mobile, or by name prefix (first or last; or first and last), at
 *   most 50, then parents only (`user_roles.role = 'parent'`; 05a-1 §0). `admin.ts` allows only letters, spaces,
 *   hyphens and apostrophes in a name, so no filter syntax reaches the query.
 * Every read is bounded and fails closed on a reply that doesn't fit; failures are logged with a code, never a number.
 *
 * BB-wave2-231126/05-build, 2026-11-26.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { FAILED, ID_CHUNK, guarded, logFailure, ok, parsed, type Db, type DbReply, type RepoResult } from "./repo";
import type { JustCallDetails, UnmatchedCall } from "./types";

export type ParentQuery =
  | { readonly kind: "mobile"; readonly e164: string }
  | { readonly kind: "name"; readonly first: string; readonly last: string | null };

export interface ParentRow {
  readonly userId: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly mobile: string | null;
}

export interface JustCallAdminRepo {
  readUnmatched(limit: number): Promise<RepoResult<{ readonly calls: readonly UnmatchedCall[]; readonly total: number }>>;
  readDetails(sids: readonly string[]): Promise<RepoResult<ReadonlyMap<string, JustCallDetails>>>;
  searchParents(query: ParentQuery): Promise<RepoResult<readonly ParentRow[]>>;
}

const PROFILE_LIMIT = 50;
const DETAIL_COLUMNS = "call_sid, direction, justcall_type, mapped_result, duration_seconds, started_at, notes, disposition";
const UNMATCHED_COLUMNS = `${DETAIL_COLUMNS}, contact_number, match_note`;

const instant = z.string().refine((v) => !Number.isNaN(Date.parse(v))).transform((v) => new Date(v).toISOString());
const detailShape = {
  call_sid: z.string(),
  direction: z.enum(["incoming", "outgoing"]),
  justcall_type: z.string().nullable(),
  mapped_result: z.enum(["answered", "no_answer"]).nullable(),
  duration_seconds: z.number().int().nonnegative().nullable(),
  started_at: instant,
  notes: z.string().nullable(),
  disposition: z.string().nullable(),
};
type DetailFields = z.infer<z.ZodObject<typeof detailShape>>;
const toDetails = (r: DetailFields): JustCallDetails => ({
  callSid: r.call_sid,
  direction: r.direction,
  justcallType: r.justcall_type,
  mappedResult: r.mapped_result,
  durationSeconds: r.duration_seconds,
  startedAt: r.started_at,
  notes: r.notes,
  disposition: r.disposition,
});
const detailRow = z.object(detailShape).transform(toDetails);
const unmatchedRow = z
  .object({ ...detailShape, contact_number: z.string().nullable(), match_note: z.enum(["none", "several"]) })
  .transform((r): UnmatchedCall => ({ ...toDetails(r), contactNumber: r.contact_number, matchNote: r.match_note }));
const entrySids = z.array(z.object({ justcall_call_id: z.string() })).transform((rows) => new Set(rows.map((r) => r.justcall_call_id)));
const profileRows = z
  .array(z.object({ user_id: z.string(), first_name: z.string(), last_name: z.string(), mobile_number: z.string().nullable() }))
  .transform((rows) => rows.map((r): ParentRow => ({ userId: r.user_id, firstName: r.first_name, lastName: r.last_name, mobile: r.mobile_number })));
const userIds = z.array(z.object({ user_id: z.string() })).transform((rows) => new Set(rows.map((r) => r.user_id)));

/** A list reply: an array no longer than asked, parsed; anything else fails closed. */
function bounded<T>(label: string, schema: z.ZodType<T>, reply: DbReply, max: number): RepoResult<T> {
  if (reply.error) return (logFailure(label, reply.error), FAILED);
  if (!Array.isArray(reply.data) || reply.data.length > max) return (logFailure(label, { message: "unexpected rows" }), FAILED);
  return parsed(label, schema, reply.data);
}

async function sidsWithEntries(db: Db, sids: readonly string[]): Promise<RepoResult<ReadonlySet<string>>> {
  if (sids.length === 0) return ok(new Set<string>());
  const reply = (await db().from("call_log_entries").select("justcall_call_id").in("justcall_call_id", [...sids]).limit(sids.length)) as DbReply;
  return bounded("readUnmatched", entrySids, reply, sids.length);
}

function readUnmatched(db: Db): JustCallAdminRepo["readUnmatched"] {
  return (limit) =>
    guarded("readUnmatched", async () => {
      const reply = (await db()
        .from("justcall_calls")
        .select(UNMATCHED_COLUMNS, { count: "exact" })
        .is("parent_user_id", null)
        .is("dismissed_at", null)
        .not("mapped_result", "is", null)
        .order("started_at", { ascending: false })
        .order("call_sid", { ascending: true })
        .limit(limit)) as DbReply & { readonly count?: number | null };
      const calls = bounded("readUnmatched", z.array(unmatchedRow), reply, limit);
      if (!calls.ok) return calls;
      const taken = await sidsWithEntries(db, calls.value.map((c) => c.callSid));
      if (!taken.ok) return taken;
      const shown = calls.value.filter((c) => !taken.value.has(c.callSid));
      const total = Math.max(shown.length, (reply.count ?? calls.value.length) - taken.value.size);
      return ok({ calls: shown, total });
    });
}

function readDetails(db: Db): JustCallAdminRepo["readDetails"] {
  return (sids) =>
    guarded("readDetails", async () => {
      const found = new Map<string, JustCallDetails>();
      for (let i = 0; i < sids.length; i += ID_CHUNK) {
        const chunk = sids.slice(i, i + ID_CHUNK);
        const reply = (await db().from("justcall_calls").select(DETAIL_COLUMNS).in("call_sid", chunk).limit(chunk.length)) as DbReply;
        const rows = bounded("readDetails", z.array(detailRow), reply, chunk.length);
        if (!rows.ok) return rows;
        for (const row of rows.value) found.set(row.callSid, row);
      }
      return ok(found as ReadonlyMap<string, JustCallDetails>);
    });
}

function searchParents(db: Db): JustCallAdminRepo["searchParents"] {
  return (query) =>
    guarded("searchParents", async () => {
      const table = () => db().from("user_profiles").select("user_id, first_name, last_name, mobile_number");
      const filtered =
        query.kind === "mobile"
          ? table().eq("mobile_number", query.e164)
          : query.last === null
            ? table().or(`first_name.ilike.${query.first}%,last_name.ilike.${query.first}%`)
            : table().ilike("first_name", `${query.first}%`).ilike("last_name", `${query.last}%`);
      const profiles = bounded("searchParents", profileRows, (await filtered.order("user_id", { ascending: true }).limit(PROFILE_LIMIT)) as DbReply, PROFILE_LIMIT);
      if (!profiles.ok || profiles.value.length === 0) return profiles;
      const ids = profiles.value.map((p) => p.userId);
      const roles = bounded("searchParents", userIds, (await db().from("user_roles").select("user_id").in("user_id", ids).eq("role", "parent").limit(ids.length)) as DbReply, ids.length);
      if (!roles.ok) return roles;
      const parents = profiles.value.filter((p) => roles.value.has(p.userId));
      return ok([...parents].sort((a, b) => `${a.firstName} ${a.lastName}`.localeCompare(`${b.firstName} ${b.lastName}`)));
    });
}

export interface JustCallAdminRepoOptions {
  /** Defaults to the service-role client, created on first use. */
  readonly client?: SupabaseClient;
}

export function createJustCallAdminRepo(options: JustCallAdminRepoOptions = {}): JustCallAdminRepo {
  let client: SupabaseClient | null = options.client ?? null;
  const db: Db = () => {
    client ??= createAdminClient();
    return client;
  };
  return Object.freeze({ readUnmatched: readUnmatched(db), readDetails: readDetails(db), searchParents: searchParents(db) });
}
