/**
 * How the invoice modules talk to the database (server-only; not a `"use server"` file — `src/lib/invite/mint.ts`'s
 * rule: every async export of one would be callable from the browser).
 *
 * - `callRpc`: one amendment 21 function; a PostgREST error or a throw becomes `DB_FAILED`, logged.
 * - `allPages` / `allPagesByIds`: every list read pages with `.range()` (500 a page), at most 100 ids per `.in()`,
 *   and fails closed at the row cap rather than loading without bound or showing a short list (04a review 7).
 * - `serviceClient`, `parseRows`, `readOne`: the shared halves of every store and family read (06a code review 5).
 * - **Failures are logged by error code or name only** — never a message or `details`: a Postgres CHECK failure
 *   says "Failing row contains (…)" with the row's digits and emails (plan 06 step 6, §9 surface 2).
 *
 * The shape of `src/lib/cohorts/db.ts` (brief 02), kept in this feature's own folder (brief §8: one self-contained
 * feature) with its own log prefix.
 *
 * BB-wave1-041126/06a-build, 2026-11-04.
 */

import type { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { FAILED, invoiceOk, type InvoiceResult } from "./types";

export type AdminClient = ReturnType<typeof createAdminClient>;

/** A failure keeps the database's error code (never its message), so a lock timeout (55P03) can read as `busy`. */
export type DbResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly code?: string };

export const DB_FAILED = Object.freeze({ ok: false } as const);
export const dbOk = <T>(value: T): DbResult<T> => ({ ok: true, value });

/** Rows per request — below PostgREST's 1,000-row cap, so a full page always means "ask for the next one". */
export const PAGE_ROWS = 500;
/** 40 pages = 20,000 rows: past that a read fails closed. */
export const MAX_PAGES = 40;
/** Ids per `.in()` request. */
export const ID_CHUNK = 100;

function codeOf(detail: unknown): string {
  if (detail instanceof Error) return detail.name;
  if (typeof detail === "object" && detail !== null && typeof (detail as { code?: unknown }).code === "string") {
    return (detail as { code: string }).code;
  }
  return "unknown";
}

export function logFailure(label: string, detail: unknown): void {
  console.error(`[invoices] ${label} failed`, { code: codeOf(detail) });
}

interface DbReply {
  readonly data: unknown;
  readonly error: { readonly message: string; readonly code?: string } | null;
}

/** Call one amendment 21 function. Never throws. */
export async function callRpc(admin: AdminClient, fn: string, args: Readonly<Record<string, unknown>>): Promise<DbResult<unknown>> {
  try {
    const { data, error } = (await admin.rpc(fn, args)) as DbReply;
    if (error) {
      logFailure(fn, error);
      return error.code ? { ok: false, code: error.code } : DB_FAILED;
    }
    return dbOk(data);
  } catch (thrown) {
    logFailure(fn, thrown);
    return DB_FAILED;
  }
}

export type Page = (from: number, to: number) => PromiseLike<DbReply>;

/** Every row of a query, page by page. A page longer than asked may have been cut short, so the read fails closed. */
export async function allPages(label: string, page: Page): Promise<DbResult<readonly unknown[]>> {
  try {
    const collected: unknown[] = [];
    for (let n = 0; n < MAX_PAGES; n += 1) {
      const from = n * PAGE_ROWS;
      const { data, error } = await page(from, from + PAGE_ROWS - 1);
      if (error) {
        logFailure(label, error);
        return DB_FAILED;
      }
      if (!Array.isArray(data) || data.length > PAGE_ROWS) {
        logFailure(label, { code: "unexpected_rows" });
        return DB_FAILED;
      }
      collected.push(...data);
      if (data.length < PAGE_ROWS) return dbOk(collected);
    }
    logFailure(label, { code: "row_cap" });
    return DB_FAILED;
  } catch (thrown) {
    logFailure(label, thrown);
    return DB_FAILED;
  }
}

/** `allPages` for an id list, at most `ID_CHUNK` ids to a request. */
export async function allPagesByIds(
  label: string,
  ids: readonly string[],
  page: (chunk: readonly string[]) => Page,
): Promise<DbResult<readonly unknown[]>> {
  const collected: unknown[] = [];
  for (let i = 0; i < ids.length; i += ID_CHUNK) {
    const chunk = await allPages(label, page(ids.slice(i, i + ID_CHUNK)));
    if (!chunk.ok) return chunk;
    collected.push(...chunk.value);
  }
  return dbOk(collected);
}

/** The service-role client, made only after a caller's gate (a missing key is logged, not thrown). */
export function serviceClient(): AdminClient | null {
  try {
    return createAdminClient();
  } catch (thrown) {
    logFailure("createAdminClient", thrown);
    return null;
  }
}

/** Parse every row or fail the read: a row that doesn't fit is never silently dropped (the 02 rule). */
export function parseRows<S extends z.ZodType>(label: string, rows: DbResult<readonly unknown[]>, schema: S): InvoiceResult<readonly z.output<S>[]> {
  if (!rows.ok) return FAILED;
  const parsed = schema.array().safeParse(rows.value);
  if (parsed.success) return invoiceOk(parsed.data);
  logFailure(label, { code: "unexpected_row" });
  return FAILED;
}

type SingleQuery = () => PromiseLike<DbReply>;

/** One row by its filters (`maybeSingle`): null when there's none, `error` when the read fails or doesn't fit. */
export async function readOne<S extends z.ZodType>(label: string, query: SingleQuery, schema: S): Promise<InvoiceResult<z.output<S> | null>> {
  try {
    const { data, error } = await query();
    if (error) {
      logFailure(label, error);
      return FAILED;
    }
    if (data === null) return invoiceOk(null);
    const row = schema.safeParse(data);
    if (row.success) return invoiceOk(row.data);
    logFailure(label, { code: "unexpected_row" });
    return FAILED;
  } catch (thrown) {
    logFailure(label, thrown);
    return FAILED;
  }
}
