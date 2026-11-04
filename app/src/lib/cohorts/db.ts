/**
 * How brief 02 talks to the database (server-only; not a `"use server"` file — `src/lib/invite/mint.ts:1-9`).
 *
 * - `callRpc`: one amendment 17 function; a PostgREST error or a throw becomes `{ ok: false }`, logged.
 * - `allPages` / `allPagesByIds`: every list read pages with `.range()` (500 a page), at most 100 ids per `.in()`,
 *   and fails closed at the row cap rather than loading without bound or showing a short list (04a review 7).
 * - Failures are logged by code or error name only: never a message, which can carry a family's details.
 *
 * BB-wave1-041126/02-build, 2026-11-04.
 */

import type { createAdminClient } from "@/lib/supabase/admin";

export type AdminClient = ReturnType<typeof createAdminClient>;

export type DbResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

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
  console.error(`[cohorts] ${label} failed`, { code: codeOf(detail) });
}

interface DbReply {
  readonly data: unknown;
  readonly error: { readonly message: string; readonly code?: string } | null;
}

/** Call one amendment 17 function. Never throws. */
export async function callRpc(admin: AdminClient, fn: string, args: Readonly<Record<string, unknown>>): Promise<DbResult<unknown>> {
  try {
    const { data, error } = (await admin.rpc(fn, args)) as DbReply;
    if (error) {
      logFailure(fn, error);
      return DB_FAILED;
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
