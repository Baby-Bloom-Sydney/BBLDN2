/**
 * The /admin/calls row data that lives outside the call tables (plan C3, C4; brief §0.9, §3 admin 2), read in
 * batches for the families on screen — one request per table per chunk of ids, never one per row.
 *
 *   parents                  her sign-up source and time
 *   nanny_positions          the booking's own position, else her latest (a quick-match family has none)
 *   position_children        the children's ages, in display order
 *   dfy_match_notifications  nannies contacted: distinct nannies the blast notified (`notified_at` set — a later wave
 *                            waits as `pending_wave` with none, as the pipeline counts it)
 *   connection_requests      nannies replied: distinct nannies with `responded_at` set (as `admin/positions`)
 *   parent_subscriptions     the deposit (the drawer only; amendment 12's columns)
 *
 * Server-only and read-only, with the service role; not `"use server"`. Callers have checked the switch and the
 * admin proof (`dashboard.ts`, `family-panel.ts`). `repo.ts` stays the only module that touches the `call_*` tables.
 * Every read fails closed — a PostgREST error, a row that doesn't fit, or a page longer than asked → `error`,
 * logged with a code and message only (never contact details).
 *
 * BB-wave1-041126/04c1-build, 2026-11-05.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import type { DepositFacts, PositionFacts } from "./dashboard-row";
import type { CallsResult } from "./types";
import { instant } from "./zod-parts";

export interface FamilyRecord {
  readonly userId: string;
  readonly signupSource: string | null;
  readonly signedUpAt: string;
}

export interface FamilyDetails {
  /** By parent user id. */
  readonly families: ReadonlyMap<string, FamilyRecord>;
  /** By parent user id; absent when she has no position. */
  readonly positions: ReadonlyMap<string, PositionFacts>;
}

export interface DashboardReads {
  /** `preferred`: parent user id → her booking's position id, used over her latest when it is still hers. */
  readFamilyDetails(userIds: readonly string[], preferred?: ReadonlyMap<string, string>): Promise<CallsResult<FamilyDetails>>;
  readDeposit(userId: string): Promise<CallsResult<DepositFacts | null>>;
}

type Db = () => SupabaseClient;
interface DbReply {
  readonly data: unknown;
  readonly error: { readonly message: string; readonly code?: string } | null;
}
type Page = (from: number, to: number) => PromiseLike<DbReply>;

const FAILED = Object.freeze({ ok: false, error: "error" } as const);
const ok = <T>(value: T): CallsResult<T> => ({ ok: true, value });
const PAGE_ROWS = 500;
const MAX_PAGES = 40;
const ID_CHUNK = 100;

function logFailure(label: string, detail: unknown): void {
  const record = typeof detail === "object" && detail !== null ? (detail as Record<string, unknown>) : {};
  const code = typeof record.code === "string" ? record.code : undefined;
  const message = detail instanceof Error ? detail.message : typeof record.message === "string" ? record.message : String(detail);
  console.error(`[calls/dashboard-reads] ${label} failed`, { code, message });
}

/** Log why, and fail closed. */
function fail(label: string, detail: unknown): typeof FAILED {
  logFailure(label, detail);
  return FAILED;
}

/** Every row for these ids: at most `ID_CHUNK` ids to a request, page by page; a page longer than asked fails closed. */
async function rowsByIds(label: string, ids: readonly string[], page: (chunk: string[]) => Page): Promise<CallsResult<readonly unknown[]>> {
  const collected: unknown[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const read = page(ids.slice(i, i + ID_CHUNK));
    for (let n = 0; ; n += 1) {
      if (n === MAX_PAGES) return fail(label, { message: `more than ${MAX_PAGES * PAGE_ROWS} rows` });
      const { data, error } = await read(n * PAGE_ROWS, (n + 1) * PAGE_ROWS - 1);
      if (error) return fail(label, error);
      if (!Array.isArray(data) || data.length > PAGE_ROWS) return fail(label, { message: "unexpected page" });
      collected.push(...data);
      if (data.length < PAGE_ROWS) break;
    }
  }
  return ok(collected);
}

/** Parse every row; one that doesn't fit fails the read. */
function parsed<T>(label: string, read: CallsResult<readonly unknown[]>, schema: z.ZodType<T>): CallsResult<readonly T[]> {
  if (!read.ok) return read;
  const rows = z.array(schema).safeParse(read.value);
  if (!rows.success) return fail(label, { message: "unexpected row shape" });
  return ok(rows.data);
}

const parentRow = z.object({ id: z.string(), user_id: z.string(), signup_source: z.string().nullable(), created_at: instant });
const positionRow = z.object({
  id: z.string(),
  parent_id: z.string(),
  suburb: z.string().nullable(),
  hours_per_week: z.number().nullable(),
  days_required: z.array(z.string()).nullable(),
  start_date: z.string().nullable(),
  created_at: instant,
});
const childRow = z.object({ position_id: z.string(), age_months: z.number(), display_order: z.number() });
const nannyRow = z.object({ position_id: z.string(), nanny_id: z.string() });
const depositRow = z.object({ status: z.string(), deposit_paid_at: instant.nullable(), deposit_refunded_at: instant.nullable() });

type ParentRow = z.infer<typeof parentRow>;
type PositionRow = z.infer<typeof positionRow>;

function readParents(db: Db, userIds: readonly string[]) {
  return rowsByIds("parents", userIds, (chunk) => (from, to) =>
    db().from("parents").select("id, user_id, signup_source, created_at").in("user_id", chunk).order("user_id", { ascending: true }).range(from, to),
  ).then((r) => parsed("parents", r, parentRow));
}

function readPositions(db: Db, parentIds: readonly string[]) {
  return rowsByIds("nanny_positions", parentIds, (chunk) => (from, to) =>
    db()
      .from("nanny_positions")
      .select("id, parent_id, suburb, hours_per_week, days_required, start_date, created_at")
      .in("parent_id", chunk)
      .order("created_at", { ascending: false })
      .order("id", { ascending: true })
      .range(from, to),
  ).then((r) => parsed("nanny_positions", r, positionRow));
}

/** `onlyWhereSet`: count a row only once this column is set (a reply's `responded_at`; a notification's `notified_at`). */
function readByPosition<T>(db: Db, table: string, columns: string, ids: readonly string[], schema: z.ZodType<T>, onlyWhereSet?: string) {
  return rowsByIds(table, ids, (chunk) => (from, to) => {
    const query = db().from(table).select(columns).in("position_id", chunk);
    const filtered = onlyWhereSet ? query.not(onlyWhereSet, "is", null) : query;
    return filtered.order("position_id", { ascending: true }).order(table === "position_children" ? "display_order" : "id", { ascending: true }).range(from, to);
  }).then((r) => parsed(table, r, schema));
}

/** Per parent: her booking's position if it is one of hers, else her latest (rows come newest first). */
function chosenPositions(parents: readonly ParentRow[], positions: readonly PositionRow[], preferred: ReadonlyMap<string, string>): Map<string, PositionRow> {
  const chosen = new Map<string, PositionRow>();
  for (const parent of parents) {
    const hers = positions.filter((p) => p.parent_id === parent.id);
    const wanted = preferred.get(parent.user_id);
    const pick = hers.find((p) => p.id === wanted) ?? hers[0];
    if (pick !== undefined) chosen.set(parent.user_id, pick);
  }
  return chosen;
}

type NannyRows = readonly z.infer<typeof nannyRow>[];

const distinctNannies = (rows: NannyRows | null, positionId: string): number | null =>
  rows === null ? null : new Set(rows.filter((r) => r.position_id === positionId).map((r) => r.nanny_id)).size;

interface PositionExtras {
  readonly children: readonly z.infer<typeof childRow>[];
  /** Null when the counts couldn't be read: the rows still show, without them (review round 2 M10). */
  readonly notified: NannyRows | null;
  readonly replied: NannyRows | null;
}

function factsOf(userId: string, p: PositionRow, extras: PositionExtras): PositionFacts {
  return {
    id: p.id,
    parentUserId: userId,
    area: p.suburb,
    hoursPerWeek: p.hours_per_week,
    daysRequired: p.days_required ?? [],
    startDate: p.start_date,
    createdAt: p.created_at,
    childAgesMonths: extras.children
      .filter((c) => c.position_id === p.id)
      .sort((a, b) => a.display_order - b.display_order)
      .map((c) => c.age_months),
    nanniesContacted: distinctNannies(extras.notified, p.id),
    nanniesReplied: distinctNannies(extras.replied, p.id),
  };
}

/**
 * The children, and the nanny counts, read together. The children are part of the row (a failure fails the read);
 * the counts degrade: if either can't be read the rows show "—" for them, so staff still see who to call (M10).
 */
async function positionExtras(db: Db, ids: readonly string[]): Promise<CallsResult<PositionExtras>> {
  const [children, notified, replied] = await Promise.all([
    readByPosition(db, "position_children", "position_id, age_months, display_order", ids, childRow),
    // Later waves are inserted up front as `pending_wave` with no `notified_at` (matching.ts): not contacted yet (H2).
    readByPosition(db, "dfy_match_notifications", "position_id, nanny_id", ids, nannyRow, "notified_at"),
    readByPosition(db, "connection_requests", "position_id, nanny_id", ids, nannyRow, "responded_at"),
  ]);
  if (!children.ok) return children;
  const counted = notified.ok && replied.ok;
  return ok({ children: children.value, notified: counted ? notified.value : null, replied: counted ? replied.value : null });
}

async function familyDetails(db: Db, userIds: readonly string[], preferred: ReadonlyMap<string, string>): Promise<CallsResult<FamilyDetails>> {
  if (userIds.length === 0) return ok({ families: new Map(), positions: new Map() });
  const parents = await readParents(db, [...new Set(userIds)]);
  if (!parents.ok) return parents;
  const families = new Map(parents.value.map((p): [string, FamilyRecord] => [p.user_id, { userId: p.user_id, signupSource: p.signup_source, signedUpAt: p.created_at }]));
  const positions = await readPositions(db, parents.value.map((p) => p.id));
  if (!positions.ok) return positions;
  const chosen = chosenPositions(parents.value, positions.value, preferred);
  const extras = await positionExtras(db, [...chosen.values()].map((p) => p.id));
  if (!extras.ok) return extras;
  const facts = [...chosen].map(([userId, p]): [string, PositionFacts] => [userId, factsOf(userId, p, extras.value)]);
  return ok({ families, positions: new Map(facts) });
}

async function deposit(db: Db, userId: string): Promise<CallsResult<DepositFacts | null>> {
  const { data, error } = (await db()
    .from("parent_subscriptions")
    .select("status, deposit_paid_at, deposit_refunded_at")
    .eq("parent_user_id", userId)
    .maybeSingle()) as DbReply;
  if (error) return fail("parent_subscriptions", error);
  if (data === null || data === undefined) return ok(null);
  const row = depositRow.safeParse(data);
  if (!row.success) return fail("parent_subscriptions", { message: "unexpected row shape" });
  return ok({ status: row.data.status, depositPaidAt: row.data.deposit_paid_at, depositRefundedAt: row.data.deposit_refunded_at });
}

async function guarded<T>(label: string, op: () => Promise<CallsResult<T>>): Promise<CallsResult<T>> {
  try {
    return await op();
  } catch (thrown) {
    logFailure(label, thrown);
    return FAILED;
  }
}

export function createDashboardReads(options: { readonly client?: SupabaseClient } = {}): DashboardReads {
  let client: SupabaseClient | null = options.client ?? null;
  const db: Db = () => {
    client ??= createAdminClient();
    return client;
  };
  return Object.freeze({
    readFamilyDetails: (userIds: readonly string[], preferred: ReadonlyMap<string, string> = new Map()) =>
      guarded("readFamilyDetails", () => familyDetails(db, userIds, preferred)),
    readDeposit: (userId: string) => guarded("readDeposit", () => deposit(db, userId)),
  });
}
