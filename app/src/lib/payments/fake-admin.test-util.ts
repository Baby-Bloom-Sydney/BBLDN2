/**
 * Test-only fake of the Supabase admin client for the 4c DFY specs (BB-LDN-4c-151026).
 *
 * Every chain records one `Op` (table, kind, payload, filters) and resolves from `reads[table]`
 * (select) or `{ error: writeErrors[table] ?? null }` (writes). Enough of the PostgREST builder for
 * `.select().eq().maybeSingle()`, `.select().eq().lte().is()…`, `.update().eq().is()`, `.insert()`.
 *
 * `rpc` (added for brief 04, BB-wave1-041126/04a-core, per BUILD/README § Wave 1 alignment item 4): every
 * `.rpc(fn, args)` is recorded in `rpcCalls` and resolves from `rpcResults[fn]` (default `{ data: null, error: null }`).
 * Added add-only: the existing builder, ops and results are unchanged.
 */
import type { SupabaseClient } from "@supabase/supabase-js";

export interface Op {
  table: string;
  kind: "select" | "update" | "insert" | "upsert";
  payload?: unknown;
  filters: Array<[string, string, unknown]>;
}

export interface RpcCall {
  fn: string;
  args: unknown;
}

export interface RpcResult {
  data: unknown;
  error: { message: string; code?: string } | null;
}

export interface FakeAdmin {
  client: SupabaseClient;
  ops: Op[];
  reads: Record<string, unknown>;
  writeErrors: Record<string, { message: string } | undefined>;
  rpcCalls: RpcCall[];
  rpcResults: Record<string, RpcResult | undefined>;
}

export function fakeAdmin(reads: Record<string, unknown> = {}): FakeAdmin {
  const ops: Op[] = [];
  const writeErrors: FakeAdmin["writeErrors"] = {};
  const rpcCalls: RpcCall[] = [];
  const rpcResults: FakeAdmin["rpcResults"] = {};
  const state: FakeAdmin = { client: undefined as unknown as SupabaseClient, ops, reads, writeErrors, rpcCalls, rpcResults };

  function chain(table: string, kind: Op["kind"], payload?: unknown) {
    const op: Op = { table, kind, payload, filters: [] };
    ops.push(op);
    const result = () =>
      kind === "select"
        ? { data: state.reads[table] ?? null, error: null }
        : { data: null, error: state.writeErrors[table] ?? null };
    const builder: Record<string, unknown> = {};
    for (const f of ["eq", "is", "lte", "lt", "gte", "in", "neq", "order", "limit"]) {
      builder[f] = (col: string, val: unknown) => {
        op.filters.push([f, col, val]);
        return builder;
      };
    }
    for (const f of ["or", "gt"]) {
      builder[f] = (col: string, val: unknown) => {
        op.filters.push([f, col, val]);
        return builder;
      };
    }
    builder.select = () => builder;
    builder.returns = () => builder;
    builder.maybeSingle = async () => result();
    builder.single = async () => result();
    builder.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(result()).then(resolve, reject);
    return builder;
  }

  state.client = {
    from: (table: string) => ({
      select: () => chain(table, "select"),
      update: (payload: unknown) => chain(table, "update", payload),
      insert: (payload: unknown) => chain(table, "insert", payload),
      upsert: (payload: unknown) => chain(table, "upsert", payload),
    }),
    rpc: (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return Promise.resolve(state.rpcResults[fn] ?? { data: null, error: null });
    },
  } as unknown as SupabaseClient;
  return state;
}

export const writesTo = (f: FakeAdmin, table: string) =>
  f.ops.filter((o) => o.table === table && o.kind !== "select");
