/**
 * Unit 3i (BB-LDN-3i-141026) — `dropNonHiredConnections` (README P-3 + P-9; brief change 4b as amended by P-9).
 * Hired = CONFIRMED / ACTIVE, kept untouched; already-closed (hidden) stages untouched; every other row of hers is
 * dropped to the app's existing neutral expiry (held rows the parent never saw are deleted). Parents are told nothing.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { createMemoryDb, type MemoryDb } from "../../../tests/fakes/memory-supabase";
import { CONNECTION_STAGE } from "@/lib/position/constants";

const h = vi.hoisted(() => ({ db: null as unknown as MemoryDb, createInboxMessage: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => h.db.client() }));
vi.mock("@/lib/actions/connection-helpers", () => ({ createInboxMessage: h.createInboxMessage }));
vi.mock("@/lib/email/resend", () => ({ sendEmail: vi.fn() }));
vi.mock("@/lib/email/helpers", () => ({ getUserEmailInfo: vi.fn(async () => null) }));

import { dropNonHiredConnections, HIRED_CONNECTION_STAGES } from "./recheck-connections";

type Row = Record<string, unknown>;
const row = (id: string, stage: number, over: Row = {}): Row => ({
  id, nanny_id: "n1", parent_id: "p1", position_id: "pos1", connection_stage: stage, status: "pending", source: null,
  parent_phone_shared: null, updated_at: "2026-09-01T00:00:00.000Z", ...over,
});
const client = () => h.db.client() as Parameters<typeof dropNonHiredConnections>[0];
const byId = (id: string) => h.db.tables.connection_requests.find((r) => r.id === id);

beforeEach(() => {
  vi.clearAllMocks();
});

describe("dropNonHiredConnections", () => {
  it("hired is exactly CONFIRMED and ACTIVE — imported constants, OFFERED is not hired", () => {
    expect([...HIRED_CONNECTION_STAGES].sort()).toEqual([CONNECTION_STAGE.CONFIRMED, CONNECTION_STAGE.ACTIVE].sort());
    expect(HIRED_CONNECTION_STAGES).not.toContain(CONNECTION_STAGE.OFFERED);
  });

  it("keeps hired rows, expires visible open rows, deletes unseen held rows, and counts them", async () => {
    h.db = createMemoryDb({
      connection_requests: [
        row("c34", CONNECTION_STAGE.CONFIRMED, { status: "confirmed" }),
        row("c40", CONNECTION_STAGE.ACTIVE, { status: "confirmed" }),
        row("c5", CONNECTION_STAGE.NANNY_APPLIED),
        row("c21", CONNECTION_STAGE.INTRO_COMPLETE),
        row("c30", CONNECTION_STAGE.AWAITING_RESPONSE),
        row("c10", CONNECTION_STAGE.ACCEPTED, { status: "accepted" }),
        row("c9-dfy", CONNECTION_STAGE.ACCEPTED_PENDING, { source: "dfy" }),
        row("c9", CONNECTION_STAGE.ACCEPTED_PENDING),
        row("c4", CONNECTION_STAGE.NANNY_APPLIED_PENDING),
        row("c36", CONNECTION_STAGE.NOT_SELECTED, { status: "declined" }),
      ],
    });
    const r = await dropNonHiredConnections(client(), "n1");
    expect(r).toEqual({ kept: 2, dropped: 7, notDropped: 0 });
    expect(byId("c34")).toMatchObject({ connection_stage: 34, status: "confirmed" });
    expect(byId("c40")).toMatchObject({ connection_stage: 40, status: "confirmed" });
    for (const id of ["c5", "c21", "c30", "c9"]) expect(byId(id)).toMatchObject({ connection_stage: CONNECTION_STAGE.REQUEST_EXPIRED, status: "expired" });
    expect(byId("c10")).toMatchObject({ connection_stage: CONNECTION_STAGE.SCHEDULE_EXPIRED, status: "expired" });
    expect(byId("c9-dfy")).toBeUndefined();
    expect(byId("c4")).toBeUndefined();
    expect(byId("c36")).toMatchObject({ connection_stage: 36, updated_at: "2026-09-01T00:00:00.000Z" });
    expect(h.createInboxMessage).not.toHaveBeenCalled();
  });

  it("returns zero counts when she has no connections", async () => {
    h.db = createMemoryDb({ connection_requests: [] });
    expect(await dropNonHiredConnections(client(), "n1")).toEqual({ kept: 0, dropped: 0, notDropped: 0 });
  });

  it("throws when the read fails (never a silent 'nothing to drop')", async () => {
    h.db = createMemoryDb({});
    const failing = { from: () => ({ select: () => ({ eq: async () => ({ data: null, error: { message: "down" } }) }) }) };
    await expect(dropNonHiredConnections(failing as unknown as Parameters<typeof dropNonHiredConnections>[0], "n1")).rejects.toThrow(/down/);
  });

  it("counts a row that moved on between the read and the stage-guarded write as notDropped", async () => {
    h.db = createMemoryDb({ connection_requests: [row("c20", CONNECTION_STAGE.INTRO_SCHEDULED), row("c0", CONNECTION_STAGE.REQUEST_SENT)] });
    const base = h.db.client() as { from: (t: string) => Record<string, unknown> };
    let reads = 0;
    const racing = {
      from: (t: string) => {
        const b = base.from(t);
        if (t === "connection_requests" && reads++ === 0) {
          // After the read, the parent moves c20 on (a real race).
          const origThen = b.then as (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) => Promise<unknown>;
          b.then = (ok: (v: unknown) => unknown, ko?: (e: unknown) => unknown) =>
            origThen((v: unknown) => {
              Object.assign(byId("c20")!, { connection_stage: CONNECTION_STAGE.INTRO_COMPLETE });
              return ok(v);
            }, ko);
        }
        return b;
      },
    };
    const r = await dropNonHiredConnections(racing as unknown as Parameters<typeof dropNonHiredConnections>[0], "n1");
    expect(r).toEqual({ kept: 0, dropped: 1, notDropped: 1 });
    expect(byId("c20")).toMatchObject({ connection_stage: CONNECTION_STAGE.INTRO_COMPLETE, status: "pending" });
  });
});
