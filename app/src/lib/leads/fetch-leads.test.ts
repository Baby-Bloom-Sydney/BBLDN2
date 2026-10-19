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

/** 5-w3fix (W3-M3, P-23): the "Contributions:" filter is hidden unless PAYOUTS_ENABLED — `?contributions=` is ignored. */
const contributionsFilterCalls = () =>
  h.calls.filter(
    (c) => c.table === "nannies" && (c.method === "not" || c.method === "is") && c.args[0] === "bonus_program_completed_at",
  );

describe("fetchLeads — contributions filter behind PAYOUTS_ENABLED", () => {
  it.each(["complete", "incomplete"])("flag off: ?contributions=%s applies no filter (unfiltered list)", async (contributions) => {
    vi.stubEnv("PAYOUTS_ENABLED", "");
    await fetchLeads(parseLeadQueryState(new URLSearchParams({ contributions })));
    expect(h.calls.some((c) => c.table === "nannies")).toBe(true);
    expect(contributionsFilterCalls()).toHaveLength(0);
  });

  it("flag on: ?contributions=complete / incomplete filter as before", async () => {
    vi.stubEnv("PAYOUTS_ENABLED", "true");
    await fetchLeads(parseLeadQueryState(new URLSearchParams({ contributions: "complete" })));
    expect(contributionsFilterCalls()).toEqual([
      { table: "nannies", method: "not", args: ["bonus_program_completed_at", "is", null] },
    ]);
    h.calls = [];
    await fetchLeads(parseLeadQueryState(new URLSearchParams({ contributions: "incomplete" })));
    expect(contributionsFilterCalls()).toEqual([
      { table: "nannies", method: "is", args: ["bonus_program_completed_at", null] },
    ]);
  });
});
