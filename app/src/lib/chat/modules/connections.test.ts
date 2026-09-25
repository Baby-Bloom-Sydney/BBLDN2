import { describe, it, expect, beforeEach, vi } from "vitest";
import { CONNECTION_STAGE } from "@/lib/position/constants";
import type { ModuleContext } from "./types";

// We stub the server actions rather than vi.importActual-ing the real
// module — connection.ts imports Resend at top level, which throws in
// unit-test env without RESEND_API_KEY. The module only uses the two
// functions we expose; re-exports like ConnectionRequestWithDetails are
// type-only and get erased at runtime.
vi.mock("@/lib/actions/connection", () => ({
  getNannyConnectionRequests: vi.fn(),
  getParentConnectionRequests: vi.fn(),
  declineConnectionRequest: vi.fn(),
  cancelConnectionRequest: vi.fn(),
  acceptConnectionRequest: vi.fn(),
  scheduleConnectionTime: vi.fn(),
  createConnectionRequest: vi.fn(),
}));

vi.mock("@/lib/actions/position-funnel", () => ({
  reportIntroOutcome: vi.fn(),
  reportParentOutcome: vi.fn(),
  confirmPlacement: vi.fn(),
  nannyConfirmPosition: vi.fn(),
}));

import { connectionsModule } from "./connections";
import {
  getNannyConnectionRequests,
  getParentConnectionRequests,
  declineConnectionRequest,
  cancelConnectionRequest,
  acceptConnectionRequest,
  scheduleConnectionTime,
  createConnectionRequest,
} from "@/lib/actions/connection";
import {
  reportIntroOutcome,
  reportParentOutcome,
  confirmPlacement,
  nannyConfirmPosition,
} from "@/lib/actions/position-funnel";

function makeCtx(role: "nanny" | "parent" = "nanny"): ModuleContext {
  return {
    botId: "bot-1",
    userId: "u-1",
    userRole: role,
    effectiveRole: role,
    children: [],
    currentSurface: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: { from: vi.fn() } as any,
  };
}

function buildConnection(overrides: Record<string, unknown> = {}) {
  const base = {
    id: "conn-1",
    parent_id: "p-1",
    nanny_id: "n-1",
    position_id: "pos-1",
    status: "pending" as const,
    proposed_times: [],
    confirmed_time: null,
    confirmed_at: null,
    message: null,
    decline_reason: null,
    nanny_phone_shared: null,
    expires_at: null,
    created_at: "2026-04-01T00:00:00Z",
    updated_at: "2026-04-01T00:00:00Z",
    connection_stage: CONNECTION_STAGE.REQUEST_SENT,
    intro_outcome_reported_at: null,
    fill_initiated_by: null,
    trial_date: null,
    trial_reported_at: null,
    parent: {
      id: "p-1",
      user_id: "pu-1",
      first_name: "Chen",
      last_name: "Family",
      suburb: "Chelsea",
    },
    nanny: {
      id: "n-1",
      user_id: "nu-1",
      first_name: "Jessica",
      last_name: "Mahoney",
      suburb: "Clapham",
      hourly_rate_min: 30,
      profile_picture_url: null,
    },
  };
  return { ...base, ...overrides };
}

describe("connections module — role gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects admin role — tells Katie to use admin inspection tools", async () => {
    const ctx = makeCtx();
    ctx.effectiveRole = "admin";
    const r = await connectionsModule.execute("read_connection_inbox", {}, ctx);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/nanny and parent/i);
  });

  it("returns error for unknown tool", async () => {
    const r = await connectionsModule.execute("nope", {}, makeCtx());
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Unknown tool/);
  });
});

describe("connections module — read_connection_inbox", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls nanny-side server action when nanny role and returns active only", async () => {
    vi.mocked(getNannyConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.REQUEST_SENT,
        }),
        buildConnection({
          id: "c2",
          connection_stage: CONNECTION_STAGE.DECLINED,
        }),
        buildConnection({
          id: "c3",
          connection_stage: CONNECTION_STAGE.INTRO_SCHEDULED,
        }),
      ],
      error: null,
    });

    const r = await connectionsModule.execute(
      "read_connection_inbox",
      {},
      makeCtx("nanny"),
    );
    expect(r.success).toBe(true);
    expect(getNannyConnectionRequests).toHaveBeenCalled();
    expect(getParentConnectionRequests).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    // DECLINED filtered out by isTerminal, leaving 2
    expect(data.count).toBe(2);
    expect(data.connections.map((c: { id: string }) => c.id)).toEqual([
      "c1",
      "c3",
    ]);
    expect(data.connections[0].headline).toMatch(/new request/i);
  });

  it("calls parent-side server action when parent role", async () => {
    vi.mocked(getParentConnectionRequests).mockResolvedValue({
      data: [buildConnection({ id: "c1" })],
      error: null,
    });

    const r = await connectionsModule.execute(
      "read_connection_inbox",
      {},
      makeCtx("parent"),
    );
    expect(r.success).toBe(true);
    expect(getParentConnectionRequests).toHaveBeenCalled();
    expect(getNannyConnectionRequests).not.toHaveBeenCalled();
  });

  it("surfaces server action errors", async () => {
    vi.mocked(getNannyConnectionRequests).mockResolvedValue({
      data: [],
      error: "Database connection failed",
    });
    const r = await connectionsModule.execute(
      "read_connection_inbox",
      {},
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toBe("Database connection failed");
  });
});

describe("connections module — read_connection_by_name", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects names shorter than 2 characters", async () => {
    const r = await connectionsModule.execute(
      "read_connection_by_name",
      { counterparty_name: "J" },
      makeCtx("parent"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/at least 2/i);
  });

  it("returns no-match data when no connection matches", async () => {
    vi.mocked(getParentConnectionRequests).mockResolvedValue({
      data: [buildConnection({ id: "c1" })],
      error: null,
    });
    const r = await connectionsModule.execute(
      "read_connection_by_name",
      { counterparty_name: "NoSuchName" },
      makeCtx("parent"),
    );
    expect(r.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.match_count).toBe(0);
  });

  it("returns disambiguation list when multiple match", async () => {
    vi.mocked(getParentConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          nanny: {
            id: "n1",
            user_id: "u1",
            first_name: "Jessica",
            last_name: "Mahoney",
            suburb: "Clapham",
            hourly_rate_min: 30,
            profile_picture_url: null,
          },
        }),
        buildConnection({
          id: "c2",
          nanny: {
            id: "n2",
            user_id: "u2",
            first_name: "Jessica",
            last_name: "Thompson",
            suburb: "Camden Town",
            hourly_rate_min: 35,
            profile_picture_url: null,
          },
        }),
      ],
      error: null,
    });
    const r = await connectionsModule.execute(
      "read_connection_by_name",
      { counterparty_name: "Jessica" },
      makeCtx("parent"),
    );
    expect(r.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.match_count).toBe(2);
    expect(data.disambiguation).toHaveLength(2);
    // No tile when ambiguous — Katie has to ask first
    expect(r.tile).toBeUndefined();
  });

  it("emits a connection_request tile when exactly one match", async () => {
    vi.mocked(getParentConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          nanny: {
            id: "n1",
            user_id: "u1",
            first_name: "Jessica",
            last_name: "Mahoney",
            suburb: "Clapham",
            hourly_rate_min: 30,
            profile_picture_url: null,
          },
        }),
      ],
      error: null,
    });
    const r = await connectionsModule.execute(
      "read_connection_by_name",
      { counterparty_name: "Jessica" },
      makeCtx("parent"),
    );
    expect(r.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.match_count).toBe(1);
    expect(data.connection.counterparty_name).toBe("Jessica M.");
    expect(r.tile?.kind).toBe("connection_request");
    if (r.tile?.kind === "connection_request") {
      expect(r.tile.data.id).toBe("c1");
    }
  });
});

describe("connections module — read_upcoming_meet", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns has_upcoming=false when nothing booked", async () => {
    vi.mocked(getNannyConnectionRequests).mockResolvedValue({
      data: [buildConnection({ id: "c1", confirmed_time: null })],
      error: null,
    });
    const r = await connectionsModule.execute(
      "read_upcoming_meet",
      {},
      makeCtx("nanny"),
    );
    expect(r.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.has_upcoming).toBe(false);
    expect(r.tile).toBeUndefined();
  });

  it("picks the soonest future confirmed_time and emits a tile", async () => {
    const soon = new Date(Date.now() + 3600_000).toISOString();
    const later = new Date(Date.now() + 2 * 86400_000).toISOString();
    vi.mocked(getNannyConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "later",
          confirmed_time: later,
          connection_stage: CONNECTION_STAGE.INTRO_SCHEDULED,
        }),
        buildConnection({
          id: "soon",
          confirmed_time: soon,
          connection_stage: CONNECTION_STAGE.INTRO_SCHEDULED,
        }),
      ],
      error: null,
    });
    const r = await connectionsModule.execute(
      "read_upcoming_meet",
      {},
      makeCtx("nanny"),
    );
    expect(r.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.has_upcoming).toBe(true);
    expect(data.connection.id).toBe("soon");
    expect(r.tile?.kind).toBe("connection_request");
    if (r.tile?.kind === "connection_request") {
      expect(r.tile.data.id).toBe("soon");
    }
  });

  it("ignores past confirmed_times", async () => {
    vi.mocked(getNannyConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "past",
          confirmed_time: "2020-01-01T00:00:00Z",
        }),
      ],
      error: null,
    });
    const r = await connectionsModule.execute(
      "read_upcoming_meet",
      {},
      makeCtx("nanny"),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.has_upcoming).toBe(false);
  });
});

describe("connections module — read_action_required", () => {
  beforeEach(() => vi.clearAllMocks());

  it("returns only connections where the CURRENT user has the next move", async () => {
    vi.mocked(getNannyConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "needsMe",
          connection_stage: CONNECTION_STAGE.REQUEST_SENT, // nanny must respond
        }),
        buildConnection({
          id: "waitingOnParent",
          connection_stage: CONNECTION_STAGE.ACCEPTED, // parent picks time
        }),
      ],
      error: null,
    });
    const r = await connectionsModule.execute(
      "read_action_required",
      {},
      makeCtx("nanny"),
    );
    expect(r.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.count).toBe(1);
    expect(data.connections[0].id).toBe("needsMe");
    expect(data.connections[0].next_step).toBeTruthy();
  });
});

describe("connections module — propose_decline_connection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects parent role — only nanny can decline", async () => {
    vi.mocked(getParentConnectionRequests).mockResolvedValue({
      data: [buildConnection({ id: "c1" })],
      error: null,
    });
    const r = await connectionsModule.execute(
      "propose_decline_connection",
      { connection_id: "c1" },
      makeCtx("parent"),
    );
    expect(r.success).toBe(false);
    expect(r.error?.toLowerCase()).toContain("only nannies");
  });

  it("rejects missing connection_id", async () => {
    const r = await connectionsModule.execute(
      "propose_decline_connection",
      {},
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/connection_id/);
  });

  it("rejects when connection is not in user's list (wrong id)", async () => {
    vi.mocked(getNannyConnectionRequests).mockResolvedValue({
      data: [buildConnection({ id: "c1" })],
      error: null,
    });
    const r = await connectionsModule.execute(
      "propose_decline_connection",
      { connection_id: "does-not-exist" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/No connection found/);
  });

  it("rejects when stage is no longer pending", async () => {
    vi.mocked(getNannyConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.INTRO_SCHEDULED,
        }),
      ],
      error: null,
    });
    const r = await connectionsModule.execute(
      "propose_decline_connection",
      { connection_id: "c1" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/no longer.+pending|use cancel/i);
  });

  it("returns a preview + does NOT hit the server action", async () => {
    vi.mocked(getNannyConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.REQUEST_SENT,
        }),
      ],
      error: null,
    });
    const r = await connectionsModule.execute(
      "propose_decline_connection",
      { connection_id: "c1" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(true);
    expect(declineConnectionRequest).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.action).toBe("decline");
    expect(data.email_side_effect).toBe(true);
    expect(data.preview.toLowerCase()).toContain("decline");
    expect(data.preview.toLowerCase()).toContain("neutral notification");
    // Reason is kept private — propose must flag that it's not shared.
    expect(data.preview.toLowerCase()).toContain("never share");
  });
});

describe("connections module — apply_decline_connection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hits the server action when inputs valid", async () => {
    vi.mocked(getNannyConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.REQUEST_SENT,
        }),
      ],
      error: null,
    });
    vi.mocked(declineConnectionRequest).mockResolvedValue({
      success: true,
      error: null,
    });

    const r = await connectionsModule.execute(
      "apply_decline_connection",
      { connection_id: "c1", reason: "private note" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(true);
    expect(declineConnectionRequest).toHaveBeenCalledWith("c1", "private note");
    expect(r.tile?.kind).toBe("connection_request");
    if (r.tile?.kind === "connection_request") {
      expect(r.tile.data.id).toBe("c1");
    }
  });

  it("surfaces server-action error verbatim on failure (stage shifted)", async () => {
    vi.mocked(getNannyConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.REQUEST_SENT,
        }),
      ],
      error: null,
    });
    vi.mocked(declineConnectionRequest).mockResolvedValue({
      success: false,
      error: "This request is no longer pending.",
    });
    const r = await connectionsModule.execute(
      "apply_decline_connection",
      { connection_id: "c1" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toBe("This request is no longer pending.");
  });

  it("blocks when the counterparty join is missing rather than narrating a fake name", async () => {
    // Data-integrity guard: enriched connection has no parent/nanny join.
    // Previously: module would narrate "decline the connection request from
    // Unknown" which reads as a real name. Now: surface the incomplete-data
    // error so the user refreshes rather than acting on bad data.
    vi.mocked(getNannyConnectionRequests).mockResolvedValue({
      data: [
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        {
          ...buildConnection({
            id: "c1",
            connection_stage: CONNECTION_STAGE.REQUEST_SENT,
          }),
          parent: undefined,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any,
      ],
      error: null,
    });
    const r = await connectionsModule.execute(
      "apply_decline_connection",
      { connection_id: "c1" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(declineConnectionRequest).not.toHaveBeenCalled();
    expect(r.error).toMatch(/other party's details|refresh/i);
  });

  it("re-validates stage at apply time — rejects if stage shifted since propose", async () => {
    // Simulates the race where the connection auto-advanced between the
    // propose turn and the apply turn. Apply must re-check rather than
    // trusting the propose step.
    vi.mocked(getNannyConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.INTRO_SCHEDULED,
        }),
      ],
      error: null,
    });
    const r = await connectionsModule.execute(
      "apply_decline_connection",
      { connection_id: "c1" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(declineConnectionRequest).not.toHaveBeenCalled();
    expect(r.error).toMatch(/no longer in the pending stage/i);
  });

  it("is parent-gated — parent calling apply_decline returns error", async () => {
    vi.mocked(getParentConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.REQUEST_SENT,
        }),
      ],
      error: null,
    });
    const r = await connectionsModule.execute(
      "apply_decline_connection",
      { connection_id: "c1" },
      makeCtx("parent"),
    );
    expect(r.success).toBe(false);
    expect(declineConnectionRequest).not.toHaveBeenCalled();
  });
});

describe("connections module — propose_cancel_connection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("previews cancel for a parent-side active connection", async () => {
    vi.mocked(getParentConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.ACCEPTED,
          nanny: {
            id: "n1",
            user_id: "u1",
            first_name: "Jessica",
            last_name: "Mahoney",
            suburb: "Clapham",
            hourly_rate_min: 30,
            profile_picture_url: null,
          },
        }),
      ],
      error: null,
    });
    const r = await connectionsModule.execute(
      "propose_cancel_connection",
      { connection_id: "c1" },
      makeCtx("parent"),
    );
    expect(r.success).toBe(true);
    expect(cancelConnectionRequest).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.action).toBe("cancel");
    expect(data.email_side_effect).toBe(false);
    expect(data.preview.toLowerCase()).toContain("cancel");
    expect(data.preview).toContain("Jessica M.");
  });

  it("rejects cancel on a terminal stage", async () => {
    vi.mocked(getNannyConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.DECLINED,
        }),
      ],
      error: null,
    });
    const r = await connectionsModule.execute(
      "propose_cancel_connection",
      { connection_id: "c1" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/already closed/i);
  });

  it("rejects cancel when status is already 'cancelled'", async () => {
    vi.mocked(getNannyConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          status: "cancelled" as const,
          connection_stage: CONNECTION_STAGE.CANCELLED_BY_PARENT,
        }),
      ],
      error: null,
    });
    const r = await connectionsModule.execute(
      "propose_cancel_connection",
      { connection_id: "c1" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/already.+cancelled/i);
  });
});

describe("connections module — apply_cancel_connection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("hits the server action + emits live tile on success", async () => {
    vi.mocked(getNannyConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.ACCEPTED,
        }),
      ],
      error: null,
    });
    vi.mocked(cancelConnectionRequest).mockResolvedValue({
      success: true,
      error: null,
    });
    const r = await connectionsModule.execute(
      "apply_cancel_connection",
      { connection_id: "c1" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(true);
    expect(cancelConnectionRequest).toHaveBeenCalledWith("c1");
    expect(r.tile?.kind).toBe("connection_request");
  });

  it("surfaces server-action permission error verbatim", async () => {
    vi.mocked(getParentConnectionRequests).mockResolvedValue({
      data: [buildConnection({ id: "c1" })],
      error: null,
    });
    vi.mocked(cancelConnectionRequest).mockResolvedValue({
      success: false,
      error: "You do not have permission to cancel this request.",
    });
    const r = await connectionsModule.execute(
      "apply_cancel_connection",
      { connection_id: "c1" },
      makeCtx("parent"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toBe("You do not have permission to cancel this request.");
  });
});

// ────────────────────────────────────────────────────────────────────────
// 4B.3 — accept connection (slot collection)
// ────────────────────────────────────────────────────────────────────────

const VALID_SLOTS = [
  "2026-05-01_morning",
  "2026-05-02_midday",
  "2026-05-03_afternoon",
  "2026-05-04_evening",
  "2026-05-05_morning",
];

describe("connections module — propose_accept_connection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects parent role", async () => {
    vi.mocked(getParentConnectionRequests).mockResolvedValue({
      data: [buildConnection({ id: "c1" })],
      error: null,
    });
    const r = await connectionsModule.execute(
      "propose_accept_connection",
      { connection_id: "c1", slots: VALID_SLOTS },
      makeCtx("parent"),
    );
    expect(r.success).toBe(false);
    expect(r.error?.toLowerCase()).toContain("only nannies");
  });

  it("rejects fewer than 5 slots", async () => {
    vi.mocked(getNannyConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.REQUEST_SENT,
        }),
      ],
      error: null,
    });
    const r = await connectionsModule.execute(
      "propose_accept_connection",
      { connection_id: "c1", slots: ["2026-05-01_morning"] },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/at least 5/);
  });

  it("dedupes identical slots before counting — 5× same slot is not 5 unique", async () => {
    // Silent-trust-boundary guard: an LLM that sends the same slot 5
    // times shouldn't sneak past the ≥5-unique-slot rule.
    vi.mocked(getNannyConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.REQUEST_SENT,
        }),
      ],
      error: null,
    });
    const r = await connectionsModule.execute(
      "propose_accept_connection",
      {
        connection_id: "c1",
        slots: [
          "2026-05-01_morning",
          "2026-05-01_morning",
          "2026-05-01_morning",
          "2026-05-01_morning",
          "2026-05-01_morning",
        ],
      },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/5 unique slots/);
  });

  it("rejects malformed slot strings", async () => {
    vi.mocked(getNannyConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.REQUEST_SENT,
        }),
      ],
      error: null,
    });
    const r = await connectionsModule.execute(
      "propose_accept_connection",
      {
        connection_id: "c1",
        slots: ["2026-05-01", "2026-05-02_brunch", "bad"],
      },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Invalid slot/);
  });

  it("rejects slots missing a bracket", async () => {
    vi.mocked(getNannyConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.REQUEST_SENT,
        }),
      ],
      error: null,
    });
    const allMorning = [
      "2026-05-01_morning",
      "2026-05-02_morning",
      "2026-05-03_morning",
      "2026-05-04_morning",
      "2026-05-05_morning",
    ];
    const r = await connectionsModule.execute(
      "propose_accept_connection",
      { connection_id: "c1", slots: allMorning },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Missing: midday.*afternoon.*evening/);
  });

  it("rejects slots on fewer than 3 days", async () => {
    vi.mocked(getNannyConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.REQUEST_SENT,
        }),
      ],
      error: null,
    });
    const twoDays = [
      "2026-05-01_morning",
      "2026-05-01_midday",
      "2026-05-01_afternoon",
      "2026-05-01_evening",
      "2026-05-02_morning",
    ];
    const r = await connectionsModule.execute(
      "propose_accept_connection",
      { connection_id: "c1", slots: twoDays },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/at least 3 different days/);
  });

  it("returns preview with slots grouped by day + does not hit server", async () => {
    vi.mocked(getNannyConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.REQUEST_SENT,
        }),
      ],
      error: null,
    });
    const r = await connectionsModule.execute(
      "propose_accept_connection",
      { connection_id: "c1", slots: VALID_SLOTS },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(true);
    expect(acceptConnectionRequest).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.slot_count).toBe(5);
    expect(data.bracket_count).toBe(4);
    expect(data.day_count).toBe(5);
    expect(Array.isArray(data.slots_by_day)).toBe(true);
    expect(data.preview).toContain("5 availability slot");
  });
});

describe("connections module — apply_accept_connection", () => {
  beforeEach(() => vi.clearAllMocks());

  it("calls the server action when inputs valid", async () => {
    vi.mocked(getNannyConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.REQUEST_SENT,
        }),
      ],
      error: null,
    });
    vi.mocked(acceptConnectionRequest).mockResolvedValue({
      success: true,
      error: null,
    });
    const r = await connectionsModule.execute(
      "apply_accept_connection",
      { connection_id: "c1", slots: VALID_SLOTS },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(true);
    expect(acceptConnectionRequest).toHaveBeenCalledWith("c1", VALID_SLOTS);
    expect(r.tile?.kind).toBe("connection_request");
  });

  it("surfaces server verification-gate error verbatim", async () => {
    vi.mocked(getNannyConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.REQUEST_SENT,
        }),
      ],
      error: null,
    });
    vi.mocked(acceptConnectionRequest).mockResolvedValue({
      success: false,
      error: "Please complete verification to accept connections.",
    });
    const r = await connectionsModule.execute(
      "apply_accept_connection",
      { connection_id: "c1", slots: VALID_SLOTS },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toBe("Please complete verification to accept connections.");
  });
});

// ────────────────────────────────────────────────────────────────────────
// 4B.4 — schedule meet time (parent only)
// ────────────────────────────────────────────────────────────────────────

describe("connections module — propose_schedule_meet", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects nanny role", async () => {
    vi.mocked(getNannyConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.ACCEPTED,
          status: "accepted" as const,
          proposed_times: ["2026-05-10_morning"],
        }),
      ],
      error: null,
    });
    const r = await connectionsModule.execute(
      "propose_schedule_meet",
      { connection_id: "c1", date: "2026-05-10", hour: 9, minute: 0 },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Only parents/);
  });

  it("rejects connection not in ACCEPTED stage", async () => {
    vi.mocked(getParentConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.REQUEST_SENT,
        }),
      ],
      error: null,
    });
    const r = await connectionsModule.execute(
      "propose_schedule_meet",
      { connection_id: "c1", date: "2026-05-10", hour: 9, minute: 0 },
      makeCtx("parent"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/nanny needs to accept/);
  });

  it("rejects slot outside nanny's proposed_times", async () => {
    vi.mocked(getParentConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.ACCEPTED,
          status: "accepted" as const,
          proposed_times: ["2026-05-11_morning"],
        }),
      ],
      error: null,
    });
    const r = await connectionsModule.execute(
      "propose_schedule_meet",
      { connection_id: "c1", date: "2026-05-10", hour: 9, minute: 0 },
      makeCtx("parent"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/offered slots/i);
  });

  it("rejects hour outside 8am-8pm window", async () => {
    vi.mocked(getParentConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.ACCEPTED,
          status: "accepted" as const,
          proposed_times: ["2026-05-10_morning"],
        }),
      ],
      error: null,
    });
    const r = await connectionsModule.execute(
      "propose_schedule_meet",
      { connection_id: "c1", date: "2026-05-10", hour: 7, minute: 0 },
      makeCtx("parent"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/outside.+window/i);
  });

  it("returns preview + calls server action on apply", async () => {
    vi.mocked(getParentConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.ACCEPTED,
          status: "accepted" as const,
          proposed_times: ["2026-05-10_morning"],
          nanny: {
            id: "n1",
            user_id: "u1",
            first_name: "Jessica",
            last_name: "Mahoney",
            suburb: "Clapham",
            hourly_rate_min: 30,
            profile_picture_url: null,
          },
        }),
      ],
      error: null,
    });

    const propose = await connectionsModule.execute(
      "propose_schedule_meet",
      { connection_id: "c1", date: "2026-05-10", hour: 9, minute: 30 },
      makeCtx("parent"),
    );
    expect(propose.success).toBe(true);
    expect(scheduleConnectionTime).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const pdata = propose.data as any;
    expect(pdata.preview).toContain("Jessica M.");
    expect(pdata.preview.toLowerCase()).toContain(
      "phone number will be shared",
    );

    vi.mocked(scheduleConnectionTime).mockResolvedValue({
      success: true,
      error: null,
    });
    const apply = await connectionsModule.execute(
      "apply_schedule_meet",
      { connection_id: "c1", date: "2026-05-10", hour: 9, minute: 30 },
      makeCtx("parent"),
    );
    expect(apply.success).toBe(true);
    expect(scheduleConnectionTime).toHaveBeenCalledWith(
      "c1",
      "2026-05-10",
      9,
      30,
    );
    expect(apply.tile?.kind).toBe("connection_request");
  });
});

// ────────────────────────────────────────────────────────────────────────
// 4B.5 — outcome reporting (both sides)
// ────────────────────────────────────────────────────────────────────────

describe("connections module — propose_report_outcome", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects invalid outcome for parent role ('incomplete' is nanny-only)", async () => {
    vi.mocked(getParentConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.INTRO_COMPLETE,
        }),
      ],
      error: null,
    });
    const r = await connectionsModule.execute(
      "propose_report_outcome",
      { connection_id: "c1", outcome: "incomplete" },
      makeCtx("parent"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Invalid outcome.+parent/);
  });

  it("rejects outcome reporting from pre-meet stage", async () => {
    vi.mocked(getNannyConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.ACCEPTED,
        }),
      ],
      error: null,
    });
    const r = await connectionsModule.execute(
      "propose_report_outcome",
      { connection_id: "c1", outcome: "hired" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/isn't at a stage/);
  });

  it("rejects malformed date", async () => {
    vi.mocked(getNannyConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.INTRO_COMPLETE,
        }),
      ],
      error: null,
    });
    const r = await connectionsModule.execute(
      "propose_report_outcome",
      { connection_id: "c1", outcome: "hired", date: "tomorrow" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/YYYY-MM-DD format/);
  });

  it("flags email side effect only for hired / parent-trial", async () => {
    vi.mocked(getNannyConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.INTRO_COMPLETE,
        }),
      ],
      error: null,
    });
    const hired = await connectionsModule.execute(
      "propose_report_outcome",
      { connection_id: "c1", outcome: "hired", date: "2026-06-01" },
      makeCtx("nanny"),
    );
    expect(hired.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((hired.data as any).email_side_effect).toBe(true);

    const awaiting = await connectionsModule.execute(
      "propose_report_outcome",
      { connection_id: "c1", outcome: "awaiting" },
      makeCtx("nanny"),
    );
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((awaiting.data as any).email_side_effect).toBe(false);
  });

  it("routes apply to reportIntroOutcome for nanny, reportParentOutcome for parent", async () => {
    vi.mocked(getNannyConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.INTRO_COMPLETE,
        }),
      ],
      error: null,
    });
    vi.mocked(reportIntroOutcome).mockResolvedValue({
      success: true,
      error: null,
    });
    await connectionsModule.execute(
      "apply_report_outcome",
      { connection_id: "c1", outcome: "hired", date: "2026-06-01" },
      makeCtx("nanny"),
    );
    expect(reportIntroOutcome).toHaveBeenCalledWith(
      "c1",
      "hired",
      "2026-06-01",
    );
    expect(reportParentOutcome).not.toHaveBeenCalled();

    vi.mocked(getParentConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c2",
          connection_stage: CONNECTION_STAGE.INTRO_COMPLETE,
        }),
      ],
      error: null,
    });
    vi.mocked(reportParentOutcome).mockResolvedValue({
      success: true,
      error: null,
    });
    await connectionsModule.execute(
      "apply_report_outcome",
      { connection_id: "c2", outcome: "not_hired" },
      makeCtx("parent"),
    );
    expect(reportParentOutcome).toHaveBeenCalledWith(
      "c2",
      "not_hired",
      undefined,
    );
  });

  it("surfaces server-action error verbatim on apply failure", async () => {
    vi.mocked(getNannyConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.INTRO_COMPLETE,
        }),
      ],
      error: null,
    });
    vi.mocked(reportIntroOutcome).mockResolvedValue({
      success: false,
      error: "Position has been closed — outcome not logged.",
    });
    const r = await connectionsModule.execute(
      "apply_report_outcome",
      { connection_id: "c1", outcome: "not_hired" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toBe("Position has been closed — outcome not logged.");
    // No tile emitted on failure.
    expect(r.tile).toBeUndefined();
  });

  it("flags date_missing + rewrites next_call when trial has no date", async () => {
    vi.mocked(getNannyConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.INTRO_COMPLETE,
        }),
      ],
      error: null,
    });
    const r = await connectionsModule.execute(
      "propose_report_outcome",
      { connection_id: "c1", outcome: "trial" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.date_missing).toBe(true);
    expect(String(data.next_call).toLowerCase()).toMatch(
      /trial date|ask them/i,
    );
  });
});

// ────────────────────────────────────────────────────────────────────────
// 4B.6 — placement confirmation (Path A parent / Path B nanny)
// ────────────────────────────────────────────────────────────────────────

describe("connections module — propose_confirm_placement", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects when stage != OFFERED", async () => {
    vi.mocked(getParentConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.INTRO_COMPLETE,
          fill_initiated_by: "nanny",
        }),
      ],
      error: null,
    });
    const r = await connectionsModule.execute(
      "propose_confirm_placement",
      { connection_id: "c1" },
      makeCtx("parent"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/offered/i);
  });

  it("Path A: parent can confirm when fill_initiated_by=nanny", async () => {
    vi.mocked(getParentConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.OFFERED,
          fill_initiated_by: "nanny",
          nanny: {
            id: "n1",
            user_id: "u1",
            first_name: "Jessica",
            last_name: "Mahoney",
            suburb: "Clapham",
            hourly_rate_min: 30,
            profile_picture_url: null,
          },
        }),
      ],
      error: null,
    });
    const r = await connectionsModule.execute(
      "propose_confirm_placement",
      { connection_id: "c1", start_week: "2026-06-01" },
      makeCtx("parent"),
    );
    expect(r.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.role).toBe("parent");
    expect(data.preview).toContain("Jessica M.");
    expect(data.preview).toContain("2026-06-01");
    expect(data.preview.toLowerCase()).toContain("hire-confirmation pdf");
  });

  it("Path A violation: parent confirming when fill_initiated_by=parent is rejected", async () => {
    vi.mocked(getParentConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.OFFERED,
          fill_initiated_by: "parent",
        }),
      ],
      error: null,
    });
    const r = await connectionsModule.execute(
      "propose_confirm_placement",
      { connection_id: "c1" },
      makeCtx("parent"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Path A|waiting on the nanny/i);
  });

  it("Path B: nanny confirming calls nannyConfirmPosition", async () => {
    vi.mocked(getNannyConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.OFFERED,
          fill_initiated_by: "parent",
        }),
      ],
      error: null,
    });
    vi.mocked(nannyConfirmPosition).mockResolvedValue({
      success: true,
      error: null,
    });
    const r = await connectionsModule.execute(
      "apply_confirm_placement",
      { connection_id: "c1" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(true);
    expect(nannyConfirmPosition).toHaveBeenCalledWith("c1");
    expect(confirmPlacement).not.toHaveBeenCalled();
  });

  it("Path A apply routes to confirmPlacement with startWeek", async () => {
    vi.mocked(getParentConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          connection_stage: CONNECTION_STAGE.OFFERED,
          fill_initiated_by: "nanny",
        }),
      ],
      error: null,
    });
    vi.mocked(confirmPlacement).mockResolvedValue({
      success: true,
      error: null,
    });
    const r = await connectionsModule.execute(
      "apply_confirm_placement",
      { connection_id: "c1", start_week: "2026-06-01" },
      makeCtx("parent"),
    );
    expect(r.success).toBe(true);
    expect(confirmPlacement).toHaveBeenCalledWith("c1", "2026-06-01");
    expect(nannyConfirmPosition).not.toHaveBeenCalled();
  });
});

// ────────────────────────────────────────────────────────────────────────
// 4B.7 — send new connection request (parent)
// ────────────────────────────────────────────────────────────────────────

describe("connections module — propose_send_connection_request", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects nanny role", async () => {
    const r = await connectionsModule.execute(
      "propose_send_connection_request",
      { nanny_id: "n-abc" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Only parents/);
  });

  it("rejects missing nanny_id", async () => {
    const r = await connectionsModule.execute(
      "propose_send_connection_request",
      {},
      makeCtx("parent"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/nanny_id/);
  });

  it("rejects oversized message", async () => {
    vi.mocked(getParentConnectionRequests).mockResolvedValue({
      data: [],
      error: null,
    });
    const r = await connectionsModule.execute(
      "propose_send_connection_request",
      { nanny_id: "n-abc", message: "x".repeat(1001) },
      makeCtx("parent"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/under 1000/);
  });

  it("rejects when parent already has 5 pending", async () => {
    vi.mocked(getParentConnectionRequests).mockResolvedValue({
      data: Array.from({ length: 5 }, (_, i) =>
        buildConnection({
          id: `c${i}`,
          status: "pending" as const,
          nanny_id: `other-${i}`,
          connection_stage: CONNECTION_STAGE.REQUEST_SENT,
        }),
      ),
      error: null,
    });
    const r = await connectionsModule.execute(
      "propose_send_connection_request",
      { nanny_id: "n-new" },
      makeCtx("parent"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/5 open connection requests/);
  });

  it("rejects when parent already has an active connection with this nanny", async () => {
    vi.mocked(getParentConnectionRequests).mockResolvedValue({
      data: [
        buildConnection({
          id: "c1",
          nanny_id: "n-same",
          status: "accepted" as const,
        }),
      ],
      error: null,
    });
    const r = await connectionsModule.execute(
      "propose_send_connection_request",
      { nanny_id: "n-same" },
      makeCtx("parent"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/active connection with this nanny/);
  });

  it("returns preview when pre-checks pass", async () => {
    vi.mocked(getParentConnectionRequests).mockResolvedValue({
      data: [],
      error: null,
    });
    const r = await connectionsModule.execute(
      "propose_send_connection_request",
      { nanny_id: "n-new", message: "Hi!" },
      makeCtx("parent"),
    );
    expect(r.success).toBe(true);
    expect(createConnectionRequest).not.toHaveBeenCalled();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.preview.toLowerCase()).toContain("3 days");
    expect(data.has_message).toBe(true);
  });

  it("apply calls server action and emits tile on success", async () => {
    vi.mocked(getParentConnectionRequests).mockResolvedValue({
      data: [],
      error: null,
    });
    vi.mocked(createConnectionRequest).mockResolvedValue({
      success: true,
      error: null,
      requestId: "new-c1",
    });
    const r = await connectionsModule.execute(
      "apply_send_connection_request",
      { nanny_id: "n-new", message: "Hi!" },
      makeCtx("parent"),
    );
    expect(r.success).toBe(true);
    expect(createConnectionRequest).toHaveBeenCalledWith("n-new", "Hi!");
    expect(r.tile?.kind).toBe("connection_request");
    if (r.tile?.kind === "connection_request") {
      expect(r.tile.data.id).toBe("new-c1");
    }
  });
});

describe("read_connection_inbox.isPrefulfilled", () => {
  const tool = connectionsModule.tools.find(
    (t) => t.name === "read_connection_inbox",
  )!;

  it("returns true when connection_inbox slot is present", () => {
    expect(
      tool.isPrefulfilled?.(
        {},
        {
          as_of: "2026-05-09T00:00:00Z",
          connection_inbox: { pending_count: 3 },
        },
      ),
    ).toBe(true);
  });

  it("returns false when connection_inbox slot is absent (typical case post-amendment)", () => {
    expect(tool.isPrefulfilled?.({}, { as_of: "2026-05-09T00:00:00Z" })).toBe(
      false,
    );
    expect(tool.isPrefulfilled?.({}, undefined)).toBe(false);
  });

  it("returns true when pending_count is 0 (zero is still fulfilled — answer is `0 pending`)", () => {
    expect(
      tool.isPrefulfilled?.(
        {},
        {
          as_of: "2026-05-09T00:00:00Z",
          connection_inbox: { pending_count: 0 },
        },
      ),
    ).toBe(true);
  });
});
