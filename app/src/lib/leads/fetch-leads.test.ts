/**
 * fetchLeads — the `abn` filter is hidden unless PAYOUTS_ENABLED (4-w5fix, W5-M2; P-23).
 * `/admin/leads?abn=has` returns the unfiltered list while payouts are hidden.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({ calls: [] as Array<{ table: string; method: string; args: unknown[] }> }));

/** Records every builder call; any query resolves to an empty page. */
function recorder(table: string): unknown {
  const target: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(target, {
    get(_t, prop: string) {
      if (prop === "then") {
        return (resolve: (v: unknown) => unknown) => resolve({ data: [], count: 0, error: null });
      }
      return (...args: unknown[]) => {
        h.calls.push({ table, method: prop, args });
        return proxy;
      };
    },
  });
  return proxy;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => recorder(table) }),
}));

import { fetchLeads } from "./fetch-leads";
import { parseLeadQueryState } from "./query-builder";

const abnFilterCalls = () =>
  h.calls.filter((c) => c.table === "nannies" && (c.method === "not" || c.method === "is") && c.args[0] === "abn");

beforeEach(() => {
  h.calls = [];
});
afterEach(() => vi.unstubAllEnvs());

describe("fetchLeads — abn filter behind PAYOUTS_ENABLED", () => {
  it.each(["has", "missing"])("flag off: ?abn=%s applies no abn filter (unfiltered list)", async (abn) => {
    vi.stubEnv("PAYOUTS_ENABLED", "");
    await fetchLeads(parseLeadQueryState(new URLSearchParams({ abn })));
    expect(h.calls.some((c) => c.table === "nannies")).toBe(true);
    expect(abnFilterCalls()).toHaveLength(0);
  });

  it("flag on: ?abn=has filters on abn as before", async () => {
    vi.stubEnv("PAYOUTS_ENABLED", "true");
    await fetchLeads(parseLeadQueryState(new URLSearchParams({ abn: "has" })));
    expect(abnFilterCalls()).toEqual([{ table: "nannies", method: "not", args: ["abn", "is", null] }]);
  });
});
