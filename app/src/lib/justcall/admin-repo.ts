/**
 * The reads 05a-2's admin needs (plan 05 §5 B2; B2's named alternative to growing 05a-1's `repo.ts`). Server-only,
 * not `"use server"`; `admin.ts` checks the switch and the `AdminProof` before calling any of these.
 *
 * - `readUnmatched(limit)`: calls with no parent, not dismissed, with a result (D7's missed and voicemail calls are
 *   shown nowhere, plan §14), newest first, at most `limit`, with the count. A sid that already has an entry in
 *   `call_log_entries` is left out (04's writer can take a JustCall id without touching `justcall_calls`; 05a-1 §5),
 *   and the read goes on to the next page so the list still fills (at most 5 pages).
 * - `readDetails(sids)`: each call's details, 100 sids to a request, at most 500 sids (more fails closed).
 * - `searchParents(query)`: profiles by exact E.164 mobile, or by name prefix (first or last; or first and last), 50
 *   to a page, keeping parents only (`user_roles.role = 'parent'`; 05a-1 §0) until 10 are found or 10 pages are read.
 *   `admin.ts` allows only letters, spaces, hyphens and apostrophes in a name, so no filter syntax reaches the query.
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

/** Profiles per page of the parent search, the pages it reads at most, and the parents it wants. */
const PROFILE_PAGE = 50;
const PROFILE_PAGES = 10;
const PARENTS_WANTED = 10;
/** Unmatched pages read at most, to fill the list past calls left out for having an entry. */
const UNMATCHED_PAGES = 5;
/** The most sids one details read takes (History is 50; one family's attempts are few). */
const DETAILS_MAX = 500;
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

type UnmatchedPage = RepoResult<{ readonly calls: readonly UnmatchedCall[]; readonly count: number | null }>;

async function unmatchedPage(db: Db, from: number, size: number): Promise<UnmatchedPage> {
  const reply = (await db()
    .from("justcall_calls")
    .select(UNMATCHED_COLUMNS, { count: "exact" })
    .is("parent_user_id", null)
    .is("dismissed_at", null)
    .not("mapped_result", "is", null)
    .order("started_at", { ascending: false })
    .order("call_sid", { ascending: true })
    .range(from, from + size - 1)) as DbReply & { readonly count?: number | null };
  const calls = bounded("readUnmatched", z.array(unmatchedRow), reply, size);
  return calls.ok ? ok({ calls: calls.value, count: reply.count ?? null }) : calls;
}

/**
 * The newest `limit` Unmatched calls, reading on (at most `UNMATCHED_PAGES` pages) when a call is left out for having an
 * entry, so the list still fills (code review M2). `total` is the full count less the calls left out among those read.
 */
function readUnmatched(db: Db): JustCallAdminRepo["readUnmatched"] {
  return (limit) =>
    guarded("readUnmatched", async () => {
      let shown: readonly UnmatchedCall[] = [];
      let excluded = 0;
      let count: number | null = null;
      for (let n = 0; n < UNMATCHED_PAGES && shown.length < limit; n += 1) {
        const page = await unmatchedPage(db, n * limit, limit);
        if (!page.ok) return page;
        count ??= page.value.count;
        const taken = await sidsWithEntries(db, page.value.calls.map((c) => c.callSid));
        if (!taken.ok) return taken;
        excluded += taken.value.size;
        shown = [...shown, ...page.value.calls.filter((c) => !taken.value.has(c.callSid))];
        if (page.value.calls.length < limit) break;
      }
      const calls = shown.slice(0, limit);
      return ok({ calls, total: Math.max(calls.length, (count ?? calls.length) - excluded) });
    });
}

function readDetails(db: Db): JustCallAdminRepo["readDetails"] {
  return (sids) =>
    guarded("readDetails", async () => {
      if (sids.length > DETAILS_MAX) return (logFailure("readDetails", { message: `more than ${DETAILS_MAX} sids` }), FAILED);
      const found = new Map<string, JustCallDetails>();
      for (let i = 0; i < sids.length; i += ID_CHUNK) {
        const chunk = sids.slice(i, i + ID_CHUNK);
        const reply = (await db().from("justcall_calls").select(DETAIL_COLUMNS).in("call_sid", chunk).limit(chunk.length)) as DbReply;
        const rows = bounded("readDetails", z.array(detailRow), reply, chunk.length);
        if (!rows.ok) return rows;
        for (const row of rows.value) found.set(row.callSid, row);
      }
      return ok(found);
    });
}

/** One page of profiles matching the query. */
function profilePage(db: Db, query: ParentQuery, from: number) {
  const table = () => db().from("user_profiles").select("user_id, first_name, last_name, mobile_number");
  const filtered =
    query.kind === "mobile"
      ? table().eq("mobile_number", query.e164)
      : query.last === null
        ? table().or(`first_name.ilike.${query.first}%,last_name.ilike.${query.first}%`)
        : table().ilike("first_name", `${query.first}%`).ilike("last_name", `${query.last}%`);
  return filtered.order("user_id", { ascending: true }).range(from, from + PROFILE_PAGE - 1);
}

/** Of these profiles, the parents (`user_roles.role = 'parent'`). */
async function parentsOf(db: Db, profiles: readonly ParentRow[]): Promise<RepoResult<readonly ParentRow[]>> {
  if (profiles.length === 0) return ok([]);
  const ids = profiles.map((p) => p.userId);
  const reply = (await db().from("user_roles").select("user_id").in("user_id", ids).eq("role", "parent").limit(ids.length)) as DbReply;
  const roles = bounded("searchParents", userIds, reply, ids.length);
  return roles.ok ? ok(profiles.filter((p) => roles.value.has(p.userId))) : roles;
}

/**
 * Profiles matching the query, page by page, keeping parents only, until `PARENTS_WANTED` are found or `PROFILE_PAGES`
 * pages are read — so a page of nannies never hides a parent (code review M1). Sorted by name.
 */
function searchParents(db: Db): JustCallAdminRepo["searchParents"] {
  return (query) =>
    guarded("searchParents", async () => {
      let parents: readonly ParentRow[] = [];
      for (let n = 0; n < PROFILE_PAGES && parents.length < PARENTS_WANTED; n += 1) {
        const page = bounded("searchParents", profileRows, (await profilePage(db, query, n * PROFILE_PAGE)) as DbReply, PROFILE_PAGE);
        if (!page.ok) return page;
        const found = await parentsOf(db, page.value);
        if (!found.ok) return found;
        parents = [...parents, ...found.value];
        if (page.value.length < PROFILE_PAGE) break;
      }
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
