/**
 * fetchLeadDetail — the drawer's "Positions applied" rows come from `connection_requests`
 * (5e, R-4). `interview_requests` does not exist in the London schema; it is answered with
 * the PostgREST "relation does not exist" error so a regression reads as empty, as it did live.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONNECTION_STAGE, CONNECTION_STAGE_LABELS } from "@/lib/position/constants";

const NANNY_USER = "22222222-2222-4222-8222-222222222222";
const NANNY_ROW = "33333333-3333-4333-8333-333333333333";
const PARENT_USER = "44444444-4444-4444-8444-444444444444";

const CONNECTION_ROWS = [
  {
    id: "c-1",
    position_id: "p-1",
    status: "confirmed",
    responded_at: "2026-10-02T09:00:00Z",
    connection_stage: CONNECTION_STAGE.INTRO_SCHEDULED,
    confirmed_time: "2026-10-09T10:00:00Z",
    created_at: "2026-10-01T08:00:00Z",
    parents: { user_id: PARENT_USER },
  },
  {
    id: "c-2",
    position_id: null,
    status: "pending",
    responded_at: null,
    connection_stage: CONNECTION_STAGE.REQUEST_SENT,
    confirmed_time: null,
    created_at: "2026-09-30T08:00:00Z",
    parents: { user_id: PARENT_USER },
  },
];

interface Call {
  table: string;
  ops: Array<[string, unknown[]]>;
}
const calls: Call[] = [];

function resultFor(call: Call): unknown {
  const selected = call.ops.find(([op]) => op === "select")?.[1][0];
  switch (call.table) {
    case "nannies":
      // `select("id")` lookups by user_id → the nanny row; `select("*")` → the full row.
      return { data: { id: NANNY_ROW, user_id: NANNY_USER, created_at: "2026-09-01T00:00:00Z" }, error: null };
    case "connection_requests":
      return { data: CONNECTION_ROWS, error: null };
    case "user_profiles":
      return selected === "user_id, first_name, last_name, email"
        ? { data: [{ user_id: PARENT_USER, first_name: "Pat", last_name: "Parent", email: null }], error: null }
        : { data: { first_name: "Nia", last_name: "Nanny" }, error: null };
    case "interview_requests":
      return { data: null, error: { code: "42P01", message: 'relation "interview_requests" does not exist' } };
    default:
      return { data: null, error: null };
  }
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
  createAdminClient: () => ({
    from: (table: string) => builder(table),
    auth: { admin: { getUserById: async () => ({ data: { user: null }, error: null }) } },
  }),
}));

import { fetchLeadDetail } from "./fetch-lead-detail";

beforeEach(() => {
  calls.length = 0;
});

describe("fetchLeadDetail — positions applied read from connection_requests (5e, R-4)", () => {
  it("never queries interview_requests; queries connection_requests by the nanny row id", async () => {
    await fetchLeadDetail(NANNY_USER);
    expect(calls.map((c) => c.table)).not.toContain("interview_requests");
    const conn = calls.filter((c) => c.table === "connection_requests");
    expect(conn).toHaveLength(1);
    expect(conn[0].ops).toContainEqual(["eq", ["nanny_id", NANNY_ROW]]);
  });

  it("selects only columns that exist on connection_requests", async () => {
    await fetchLeadDetail(NANNY_USER);
    const conn = calls.find((c) => c.table === "connection_requests");
    const cols = String(conn?.ops.find(([op]) => op === "select")?.[1][0]);
    expect(cols).not.toMatch(/interview_date|outcome|parent_user_id/);
    expect(cols).toMatch(/connection_stage/);
    expect(cols).toMatch(/confirmed_time/);
    expect(cols).toMatch(/parents!inner\(user_id\)/);
  });

  it("maps each connection into the drawer's row shape (stage → outcome, confirmed_time → date, parent user id)", async () => {
    const detail = await fetchLeadDetail(NANNY_USER);
    expect(detail?.interview_requests).toEqual([
      {
        id: "c-1",
        parent_id: PARENT_USER,
        position_id: "p-1",
        status: "confirmed",
        responded_at: "2026-10-02T09:00:00Z",
        interview_date: "2026-10-09T10:00:00Z",
        outcome: CONNECTION_STAGE_LABELS[CONNECTION_STAGE.INTRO_SCHEDULED],
        created_at: "2026-10-01T08:00:00Z",
      },
      {
        id: "c-2",
        parent_id: PARENT_USER,
        position_id: null,
        status: "pending",
        responded_at: null,
        interview_date: null,
        outcome: CONNECTION_STAGE_LABELS[CONNECTION_STAGE.REQUEST_SENT],
        created_at: "2026-09-30T08:00:00Z",
      },
    ]);
  });

  it("the connection's parent lands in parent_directory, so the drawer can name and link them", async () => {
    const detail = await fetchLeadDetail(NANNY_USER);
    expect(detail?.parent_directory[PARENT_USER]).toEqual({
      first_name: "Pat",
      last_name: "Parent",
      email: null,
    });
  });
});
