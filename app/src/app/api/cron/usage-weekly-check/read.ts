/**
 * Read helpers for usage-weekly-check (4e, code review MEDIUM 2–3; BB-LDN-4e-151026).
 *
 * PostgREST caps one response at its max-rows setting (1000 on Supabase), and a long `in.(…)` list can outgrow the
 * request URL. Both fail silently or late, so every unbounded read here pages, and every id list is chunked.
 */

/** Supabase's default max-rows: a page never asks for more than the server will return. */
export const PAGE_SIZE = 1000;
/** Ids per `in.(…)` filter — keeps the request URL far below proxy limits. */
export const IN_CHUNK = 100;

export function chunk<T>(items: readonly T[], size: number = IN_CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

/** Reads every page of `page(from, to)` until a short page. Throws on a read error. */
export async function readAll<T>(page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await page(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(error.message);
    const got = data ?? [];
    rows.push(...got);
    if (got.length < PAGE_SIZE) return rows;
  }
}

/** `readAll` over chunks of ids (one paged read per chunk), concatenated. */
export async function readAllIn<T>(
  ids: readonly string[],
  page: (ids: string[], from: number, to: number) => Page<T>,
): Promise<T[]> {
  const parts: T[][] = [];
  for (const part of chunk(ids)) parts.push(await readAll((from, to) => page(part, from, to)));
  return parts.flat();
}
