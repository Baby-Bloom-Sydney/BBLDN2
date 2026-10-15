/**
 * Test-only fake of the Supabase admin client for the usage-weekly-check spec (BB-LDN-4e-151026).
 * Records every chain as an `Op`; a select resolves from `reads[table]` — an array (sliced by `.range()`)
 * or a function of the op (for head counts). Writes resolve `{ error: writeErrors[table] ?? null }`.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface Op {
  table: string;
  kind: "select" | "insert";
  payload?: unknown;
  head: boolean;
  filters: Array<[string, ...unknown[]]>;
}

type Read = unknown[] | ((op: Op) => { data?: unknown; count?: number });

export interface Fake {
  client: SupabaseClient;
  ops: Op[];
  reads: Record<string, Read>;
  writeErrors: Record<string, { message: string } | undefined>;
}

export function fakeAdmin(reads: Record<string, Read>): Fake {
  const fake: Fake = { client: undefined as unknown as SupabaseClient, ops: [], reads, writeErrors: {} };
  const chain = (table: string, kind: Op["kind"], payload?: unknown, head = false) => {
    const op: Op = { table, kind, payload, head, filters: [] };
    fake.ops.push(op);
    let range: [number, number] | null = null;
    const result = () => {
      if (kind !== "select") return { data: null, error: fake.writeErrors[table] ?? null };
      const r = fake.reads[table] ?? [];
      if (typeof r === "function") {
        const v = r(op);
        return { data: v.data ?? null, count: v.count ?? null, error: null };
      }
      return { data: range ? r.slice(range[0], range[1] + 1) : r, count: r.length, error: null };
    };
    const b: Record<string, unknown> = {};
    for (const f of ["eq", "neq", "gte", "in", "or", "order"]) {
      b[f] = (...args: unknown[]) => {
        op.filters.push([f, ...args]);
        return b;
      };
    }
    b.range = (from: number, to: number) => {
      range = [from, to];
      op.filters.push(["range", from, to]);
      return b;
    };
    b.returns = () => b;
    b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise.resolve(result()).then(ok, ko);
    return b;
  };
  fake.client = {
    from: (table: string) => ({
      select: (_cols?: string, opts?: { head?: boolean }) => chain(table, "select", undefined, Boolean(opts?.head)),
      insert: (payload: unknown) => chain(table, "insert", payload),
    }),
  } as unknown as SupabaseClient;
  return fake;
}

export const writesTo = (f: Fake, table: string) => f.ops.filter((o) => o.table === table && o.kind !== "select");
