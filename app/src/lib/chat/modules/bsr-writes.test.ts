import { describe, it, expect, beforeEach, vi } from "vitest";
import type { ModuleContext } from "./types";

vi.mock("@/lib/actions/babysitting", () => ({
  getNannyBabysittingJobs: vi.fn(),
  getParentBabysittingRequests: vi.fn(),
  requestBabysittingJob: vi.fn(),
  declineBabysittingRequest: vi.fn(),
  nannyCancelBabysittingRequest: vi.fn(),
  parentAcceptNanny: vi.fn(),
  parentDeclineNanny: vi.fn(),
  cancelBabysittingRequest: vi.fn(),
}));

import { bsrModule } from "./bsr";
import {
  getNannyBabysittingJobs,
  getParentBabysittingRequests,
  requestBabysittingJob,
  declineBabysittingRequest,
  nannyCancelBabysittingRequest,
  parentAcceptNanny,
  parentDeclineNanny,
  cancelBabysittingRequest,
} from "@/lib/actions/babysitting";

function makeCtx(role: "nanny" | "parent" = "nanny"): ModuleContext {
  return {
    botId: "b",
    userId: "u",
    userRole: role,
    effectiveRole: role,
    children: [],
    currentSurface: null,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    supabase: { from: vi.fn() } as any,
  };
}

function buildNannyJob(overrides: Record<string, unknown> = {}) {
  return {
    id: "j1",
    title: null,
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
      distanceKm: 3,
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

function buildParentRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "r1",
    title: "Saturday sitter",
    suburb: "Chelsea",
    hourly_rate: 50,
    estimated_total: 200,
    status: "active",
    expires_at: null,
    children: [{ age_months: 18, gender: null }],
    slots: [],
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Nanny writes
// ─────────────────────────────────────────────────────────────────────────

describe("bsr module — request_job (single-turn)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects parent role", async () => {
    const r = await bsrModule.execute(
      "request_job",
      { job_id: "j1" },
      makeCtx("parent"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/nanny-side/);
  });

  it("rejects when nanny is banned — surfaces ban text", async () => {
    const until = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
    vi.mocked(getNannyBabysittingJobs).mockResolvedValue({
      data: [],
      error: null,
      banned: true,
      banUntil: until,
    });
    const r = await bsrModule.execute(
      "request_job",
      { job_id: "j1" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/3-cancellation/);
  });

  it("rejects when job isn't in Available bucket", async () => {
    vi.mocked(getNannyBabysittingJobs).mockResolvedValue({
      data: [
        buildNannyJob({
          id: "j1",
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
      ],
      error: null,
      banned: false,
      banUntil: null,
    });
    const r = await bsrModule.execute(
      "request_job",
      { job_id: "j1" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Available bucket/);
  });

  it("rejects when clash_warning is true", async () => {
    vi.mocked(getNannyBabysittingJobs).mockResolvedValue({
      data: [buildNannyJob({ id: "j1", clashSlotIds: ["x"] })],
      error: null,
      banned: false,
      banUntil: null,
    });
    const r = await bsrModule.execute(
      "request_job",
      { job_id: "j1" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/clash/);
  });

  it("calls server when pre-checks pass", async () => {
    vi.mocked(getNannyBabysittingJobs).mockResolvedValue({
      data: [buildNannyJob({ id: "j1" })],
      error: null,
      banned: false,
      banUntil: null,
    });
    vi.mocked(requestBabysittingJob).mockResolvedValue({
      success: true,
      error: null,
    });
    const r = await bsrModule.execute(
      "request_job",
      { job_id: "j1" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(true);
    expect(requestBabysittingJob).toHaveBeenCalledWith("j1");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(String((r.data as any).message).toLowerCase()).toContain(
      "phone will be shared",
    );
  });

  it("surfaces server error verbatim", async () => {
    vi.mocked(getNannyBabysittingJobs).mockResolvedValue({
      data: [buildNannyJob({ id: "j1" })],
      error: null,
      banned: false,
      banUntil: null,
    });
    vi.mocked(requestBabysittingJob).mockResolvedValue({
      success: false,
      error: "This job is no longer available",
    });
    const r = await bsrModule.execute(
      "request_job",
      { job_id: "j1" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toBe("This job is no longer available");
  });
});

describe("bsr module — decline / withdraw (two-turn terminal)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("propose_decline_job rejects non-declinable stages", async () => {
    vi.mocked(getNannyBabysittingJobs).mockResolvedValue({
      data: [
        buildNannyJob({
          id: "j1",
          notification: {
            distanceKm: 2,
            notifiedAt: "x",
            viewedAt: null,
            requestedAt: null,
            acceptedAt: "2026-04-25T00:00:00Z",
            declinedAt: null,
            notifiedFilled: false,
          },
        }),
      ],
      error: null,
      banned: false,
      banUntil: null,
    });
    const r = await bsrModule.execute(
      "propose_decline_job",
      { job_id: "j1" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/declinable/);
  });

  it("propose_decline_job for Available → decline preview", async () => {
    vi.mocked(getNannyBabysittingJobs).mockResolvedValue({
      data: [buildNannyJob({ id: "j1" })],
      error: null,
      banned: false,
      banUntil: null,
    });
    const r = await bsrModule.execute(
      "propose_decline_job",
      { job_id: "j1" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.action).toBe("decline_job");
    expect(String(data.preview)).toContain("DECLINE");
    expect(declineBabysittingRequest).not.toHaveBeenCalled();
  });

  it("propose_withdraw_request for Requested → withdraw preview", async () => {
    vi.mocked(getNannyBabysittingJobs).mockResolvedValue({
      data: [
        buildNannyJob({
          id: "j1",
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
      ],
      error: null,
      banned: false,
      banUntil: null,
    });
    const r = await bsrModule.execute(
      "propose_withdraw_request",
      { job_id: "j1" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.action).toBe("withdraw_request");
    expect(String(data.preview)).toContain("WITHDRAW");
  });

  it("apply_decline_job calls server + emits no tile", async () => {
    vi.mocked(getNannyBabysittingJobs).mockResolvedValue({
      data: [buildNannyJob({ id: "j1" })],
      error: null,
      banned: false,
      banUntil: null,
    });
    vi.mocked(declineBabysittingRequest).mockResolvedValue({
      success: true,
      error: null,
    });
    const r = await bsrModule.execute(
      "apply_decline_job",
      { job_id: "j1" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(true);
    expect(declineBabysittingRequest).toHaveBeenCalledWith("j1");
  });
});

describe("bsr module — nanny_cancel_accepted (mandatory 2-turn + ban disclosure)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects non-accepted jobs", async () => {
    vi.mocked(getNannyBabysittingJobs).mockResolvedValue({
      data: [buildNannyJob({ id: "j1" })], // Available not Accepted
      error: null,
      banned: false,
      banUntil: null,
    });
    const r = await bsrModule.execute(
      "propose_nanny_cancel_accepted",
      { job_id: "j1" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/Accepted bucket/);
  });

  it("propose includes the 3-cancellation ban disclosure verbatim", async () => {
    vi.mocked(getNannyBabysittingJobs).mockResolvedValue({
      data: [
        buildNannyJob({
          id: "j1",
          notification: {
            distanceKm: 2,
            notifiedAt: "x",
            viewedAt: null,
            requestedAt: null,
            acceptedAt: "2026-04-25T00:00:00Z",
            declinedAt: null,
            notifiedFilled: false,
          },
        }),
      ],
      error: null,
      banned: false,
      banUntil: null,
    });
    const r = await bsrModule.execute(
      "propose_nanny_cancel_accepted",
      { job_id: "j1" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(String(data.preview)).toMatch(
      /3 cancellations? in a rolling 12-month/,
    );
    expect(String(data.ban_disclosure)).toMatch(/3-month suspension/);
    expect(nannyCancelBabysittingRequest).not.toHaveBeenCalled();
  });

  it("apply with banned: true in response narrates the suspension", async () => {
    vi.mocked(getNannyBabysittingJobs).mockResolvedValue({
      data: [
        buildNannyJob({
          id: "j1",
          notification: {
            distanceKm: 2,
            notifiedAt: "x",
            viewedAt: null,
            requestedAt: null,
            acceptedAt: "2026-04-25T00:00:00Z",
            declinedAt: null,
            notifiedFilled: false,
          },
        }),
      ],
      error: null,
      banned: false,
      banUntil: null,
    });
    vi.mocked(nannyCancelBabysittingRequest).mockResolvedValue({
      success: true,
      error: null,
      cancellationCount: 3,
      banned: true,
    });
    const r = await bsrModule.execute(
      "apply_nanny_cancel_accepted",
      { job_id: "j1" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.banned).toBe(true);
    expect(String(data.message).toLowerCase()).toContain("3-month suspension");
  });
});

// ─────────────────────────────────────────────────────────────────────────
// Parent writes
// ─────────────────────────────────────────────────────────────────────────

describe("bsr module — accept_nanny (mandatory 2-turn + phone reveal)", () => {
  beforeEach(() => vi.clearAllMocks());

  it("rejects nanny role", async () => {
    const r = await bsrModule.execute(
      "propose_accept_nanny",
      { job_id: "r1", nanny_id: "n1" },
      makeCtx("nanny"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/parent-side/);
  });

  it("rejects missing nanny_id", async () => {
    vi.mocked(getParentBabysittingRequests).mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: [buildParentRow({ id: "r1", status: "active" })] as any,
      error: null,
    });
    const r = await bsrModule.execute(
      "propose_accept_nanny",
      { job_id: "r1" },
      makeCtx("parent"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/nanny_id/);
  });

  it("rejects when request isn't accepting nannies", async () => {
    vi.mocked(getParentBabysittingRequests).mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: [buildParentRow({ id: "r1", status: "completed" })] as any,
      error: null,
    });
    const r = await bsrModule.execute(
      "propose_accept_nanny",
      { job_id: "r1", nanny_id: "n1" },
      makeCtx("parent"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/accepting new nannies/);
  });

  it("propose restates phone-share + auto-release consequences", async () => {
    vi.mocked(getParentBabysittingRequests).mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: [buildParentRow({ id: "r1", status: "active" })] as any,
      error: null,
    });
    const r = await bsrModule.execute(
      "propose_accept_nanny",
      { job_id: "r1", nanny_id: "n1" },
      makeCtx("parent"),
    );
    expect(r.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(String(data.preview).toLowerCase()).toContain(
      "phone number will be shared",
    );
    expect(String(data.preview).toLowerCase()).toContain("released");
    expect(parentAcceptNanny).not.toHaveBeenCalled();
  });

  it("apply surfaces nanny phone from server response", async () => {
    vi.mocked(getParentBabysittingRequests).mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: [buildParentRow({ id: "r1", status: "active" })] as any,
      error: null,
    });
    vi.mocked(parentAcceptNanny).mockResolvedValue({
      success: true,
      error: null,
      nannyFirstName: "Jessica",
      nannyPhone: "07700 900123",
    });
    const r = await bsrModule.execute(
      "apply_accept_nanny",
      { job_id: "r1", nanny_id: "n1" },
      makeCtx("parent"),
    );
    expect(r.success).toBe(true);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data = r.data as any;
    expect(data.nanny_first_name).toBe("Jessica");
    expect(data.nanny_phone).toBe("07700 900123");
    expect(String(data.message)).toContain("07700 900123");
  });
});

describe("bsr module — decline_nanny (single-turn) + cancel_request", () => {
  beforeEach(() => vi.clearAllMocks());

  it("decline_nanny calls server when stage is active", async () => {
    vi.mocked(getParentBabysittingRequests).mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: [buildParentRow({ id: "r1", status: "active" })] as any,
      error: null,
    });
    vi.mocked(parentDeclineNanny).mockResolvedValue({
      success: true,
      error: null,
    });
    const r = await bsrModule.execute(
      "decline_nanny",
      { job_id: "r1", nanny_id: "n1" },
      makeCtx("parent"),
    );
    expect(r.success).toBe(true);
    expect(parentDeclineNanny).toHaveBeenCalledWith("r1", "n1");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect(String((r.data as any).message).toLowerCase()).toContain("silent");
  });

  it("propose_cancel_request rejects past requests", async () => {
    vi.mocked(getParentBabysittingRequests).mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: [buildParentRow({ id: "r1", status: "completed" })] as any,
      error: null,
    });
    const r = await bsrModule.execute(
      "propose_cancel_request",
      { job_id: "r1" },
      makeCtx("parent"),
    );
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/already closed/);
  });

  it("apply_cancel_request calls server + narrates closure", async () => {
    vi.mocked(getParentBabysittingRequests).mockResolvedValue({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      data: [buildParentRow({ id: "r1", status: "active" })] as any,
      error: null,
    });
    vi.mocked(cancelBabysittingRequest).mockResolvedValue({
      success: true,
      error: null,
    });
    const r = await bsrModule.execute(
      "apply_cancel_request",
      { job_id: "r1" },
      makeCtx("parent"),
    );
    expect(r.success).toBe(true);
    expect(cancelBabysittingRequest).toHaveBeenCalledWith("r1");
  });
});
