import { describe, it, expect, beforeEach, vi } from "vitest";
import { formatClockTime } from "@/lib/timezone";
import type { ModuleContext } from "./types";

vi.mock("@/lib/actions/babysitting", () => ({
  getNannyBabysittingJobs: vi.fn(),
  getParentBabysittingRequests: vi.fn(),
}));

import { bsrModule } from "./bsr";
import {
  getNannyBabysittingJobs,
  getParentBabysittingRequests,
} from "@/lib/actions/babysitting";

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

function buildNannyJob(overrides: Record<string, unknown> = {}) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return {
    id: "j1",
    title: "Saturday evening sitter",
    special_requirements: null,
    suburb: "Clapham",
    postcode: "SW4",
    address: null,
    hourly_rate: 45,
    estimated_total: 180,
    status: "active",
    accepted_nanny_id: null,
    created_at: "2026-04-20T00:00:00Z",
    expires_at: new Date(Date.now() + 10 * 60 * 60 * 1000).toISOString(),
    slots: [
      {
        id: "s1",
        slot_date: "2026-05-03",
        start_time: "18:00",
        end_time: "22:00",
        is_selected: false,
      },
    ],
    notification: {
      distanceKm: 3.4,
      notifiedAt: "2026-04-20T00:00:00Z",
      viewedAt: null,
      requestedAt: null,
      acceptedAt: null,
      declinedAt: null,
      notifiedFilled: false,
    },
    children: [{ age_months: 14, gender: null }],
    clashSlotIds: [],
    ...overrides,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("bsr module — role gate", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects admin on read_my_jobs", async () => {
    const ctx = makeCtx();
    ctx.effectiveRole = "admin";
    const r = await bsrModule.execute("read_my_jobs", {}, ctx);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/nanny and parent/);
  });

  it("read_my_jobs is nanny-only", async () => {
    const r = await bsrModule.execute("read_my_jobs", {}, makeCtx("parent"));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/nanny-side/);
  });

  it("read_my_requests is parent-only", async () => {
    const r = await bsrModule.execute("read_my_requests", {}, makeCtx("nanny"));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/parent-side/);
  });

  it("returns error for unknown tool", async () => {
    const r = await bsrModule.execute("nope", {}, makeCtx());
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Unknown tool/);
  });
});

describe("bsr module — read_my_jobs (nanny)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("buckets jobs by state + returns plain-English summaries", async () => {
    vi.mocked(getNannyBabysittingJobs).mockResolvedValue({
      data: [
        buildNannyJob({ id: "j-avail" }), // available
        buildNannyJob({
          id: "j-req",
          notification: {
            distanceKm: 2,
            notifiedAt: "x",
            viewedAt: null,
            requestedAt: "2026-04-21T00:00:00Z",
            acceptedAt: null,
            declinedAt: null,
            notifiedFilled: false,
          },
        }),
        buildNannyJob({
          id: "j-past",
          status: "expired",
        }),
      ],
      error: null,
      banned: false,
      banUntil: null,
    });

    const r = await bsrModule.execute("read_my_jobs", {}, makeCtx("nanny"));
    expect(r.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.count).toBe(3);
    expect(data.available_count).toBe(1);
    expect(data.requested_count).toBe(1);
    expect(data.past_count).toBe(1);
    // Empty bucket (accepted) is NOT included in buckets array — only non-empty.
    expect(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (data.buckets as any[]).find((b) => b.name === "accepted"),
    ).toBeUndefined();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(data.buckets.map((b: any) => b.name)).toEqual([
      "available",
      "requested",
      "past",
    ]);
  });

  it("returns ban_text when the nanny is suspended — never leaks column name", async () => {
    const until = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000).toISOString();
    vi.mocked(getNannyBabysittingJobs).mockResolvedValue({
      data: [],
      error: null,
      banned: true,
      banUntil: until,
    });
    const r = await bsrModule.execute("read_my_jobs", {}, makeCtx("nanny"));
    expect(r.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.banned).toBe(true);
    expect(data.ban_text).toBeTruthy();
    expect(String(data.ban_text)).not.toMatch(/bsr_banned_until/);
  });

  it("surfaces server errors verbatim", async () => {
    vi.mocked(getNannyBabysittingJobs).mockResolvedValue({
      data: [],
      error: "Database connection failed",
      banned: false,
      banUntil: null,
    });
    const r = await bsrModule.execute("read_my_jobs", {}, makeCtx("nanny"));
    expect(r.success).toBe(false);
    expect(r.error).toBe("Database connection failed");
  });
});

describe("bsr module — read_my_requests (parent)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("buckets parent requests correctly", async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    vi.mocked(getParentBabysittingRequests).mockResolvedValue({
      data: [
        {
          id: "r1",
          title: "Sat night",
          suburb: "Chelsea",
          hourly_rate: 50,
          estimated_total: 200,
          status: "active",
          expires_at: null,
          children: [{ age_months: 24, gender: null }],
          slots: [],
        },
        {
          id: "r2",
          title: "Paid one",
          suburb: "Clapham",
          hourly_rate: 45,
          estimated_total: 180,
          status: "pending_payment",
          expires_at: null,
          children: [],
          slots: [],
        },
        {
          id: "r3",
          title: "Past",
          suburb: "Clapham",
          hourly_rate: 40,
          estimated_total: 160,
          status: "completed",
          expires_at: null,
          children: [],
          slots: [],
        },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ] as any,
      error: null,
    });

    const r = await bsrModule.execute(
      "read_my_requests",
      {},
      makeCtx("parent"),
    );
    expect(r.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.count).toBe(3);
    expect(data.pending_payment_count).toBe(1);
    expect(data.awaiting_count).toBe(1);
    expect(data.past_count).toBe(1);
    expect(data.booked_count).toBe(0);
  });
});

describe("bsr module — read_job_detail", () => {
  beforeEach(() => vi.clearAllMocks());

  it("nanny: returns detail for their own invitation + emits bsr_job tile", async () => {
    vi.mocked(getNannyBabysittingJobs).mockResolvedValue({
      data: [buildNannyJob({ id: "j1" })],
      error: null,
      banned: false,
      banUntil: null,
    });
    const r = await bsrModule.execute(
      "read_job_detail",
      { job_id: "j1" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.id).toBe("j1");
    expect(data.distance).toMatch(/3\.4 km/);
    // Retargeted by LDN2 unit 2k (W-12): this pinned `6pm to 10pm`, the
    // hand-rolled 12-hour label Katie spoke for a slot. One clock (12.03).
    expect(data.slots[0]).toContain(
      `${formatClockTime("18:00")} to ${formatClockTime("22:00")}`,
    );
    expect(data.slots[0]).not.toMatch(/[ap]m/i);
    expect(r.tile?.kind).toBe("bsr_job");
    if (r.tile?.kind === "bsr_job") {
      expect(r.tile.data.id).toBe("j1");
    }
  });

  it("nanny: rejects id not in their invitations (ownership gate)", async () => {
    vi.mocked(getNannyBabysittingJobs).mockResolvedValue({
      data: [buildNannyJob({ id: "j1" })],
      error: null,
      banned: false,
      banUntil: null,
    });
    const r = await bsrModule.execute(
      "read_job_detail",
      { job_id: "other" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/No babysitting job found/);
  });

  it("rejects missing job_id", async () => {
    const r = await bsrModule.execute("read_job_detail", {}, makeCtx("nanny"));
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/job_id/);
  });
});
