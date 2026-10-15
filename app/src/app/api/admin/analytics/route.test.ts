/**
 * GET /api/admin/analytics — "interviews this month" counts connection_requests that reached
 * INTRO_SCHEDULED this month (5e, R-4; the page is kept, ruling 6). `interview_requests` does
 * not exist in the London schema; it answers with the "relation does not exist" error.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CONNECTION_STAGE } from "@/lib/position/constants";

interface Call {
  table: string;
  ops: Array<[string, unknown[]]>;
}
const calls: Call[] = [];
const CONNECTION_COUNT = 7;

function resultFor(call: Call): unknown {
  if (call.table === "interview_requests") {
    return { data: null, count: null, error: { code: "42P01", message: 'relation "interview_requests" does not exist' } };
  }
  if (call.table === "connection_requests") return { data: null, count: CONNECTION_COUNT, error: null };
  return { data: [], count: 0, error: null };
}

function builder(table: string): unknown {
  const call: Call = { table, ops: [] };
  calls.push(call);
  const target: Record<string, unknown> = {};
  const proxy: unknown = new Proxy(target, {
    get(_t, prop: string) {
      if (prop === "then") return (resolve: (v: unknown) => unknown) => resolve(resultFor(call));
      return (...args: unknown[]) => {
        call.ops.push([prop, args]);
        return proxy;
      };
    },
  });
  return proxy;
}

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: (table: string) => builder(table) }),
}));

import { GET } from "./route";

beforeEach(() => {
  calls.length = 0;
  vi.useFakeTimers();
  vi.setSystemTime(new Date(2026, 9, 15, 12, 0, 0)); // 15 Oct 2026, local time
});
afterEach(() => vi.useRealTimers());

describe("GET /api/admin/analytics — interviews this month (5e, R-4)", () => {
  it("never queries interview_requests", async () => {
    await GET();
    expect(calls.map((c) => c.table)).not.toContain("interview_requests");
  });

  it("counts connection_requests at INTRO_SCHEDULED or later, scheduled since the 1st of this month", async () => {
    await GET();
    const conn = calls.filter((c) => c.table === "connection_requests");
    expect(conn).toHaveLength(1);
    expect(conn[0].ops).toContainEqual(["select", ["*", { count: "exact", head: true }]]);
    expect(conn[0].ops).toContainEqual(["gte", ["connection_stage", CONNECTION_STAGE.INTRO_SCHEDULED]]);
    expect(conn[0].ops).toContainEqual(["gte", ["confirmed_at", new Date(2026, 9, 1).toISOString()]]);
  });

  it("returns that count as interviewsThisMonth", async () => {
    const res = await GET();
    const body = (await res.json()) as { interviewsThisMonth: number };
    expect(body.interviewsThisMonth).toBe(CONNECTION_COUNT);
  });
});
